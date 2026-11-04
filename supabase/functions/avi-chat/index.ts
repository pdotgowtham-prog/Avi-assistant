import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { rankMemories } from "./memory-retrieval.mjs";
import { buildExtractionPrompt, parseMemoryCandidates } from "./memory-extraction.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bearerToken(req: Request) {
  const header = req.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function retrieveAccountMemories(req: Request, message: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  let apiKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!apiKey) {
    try {
      const namedKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
      apiKey = namedKeys.default || Object.values(namedKeys).find((value) => typeof value === "string") || "";
    } catch {
      apiKey = "";
    }
  }
  const accessToken = bearerToken(req);
  if (!supabaseUrl || !apiKey || !accessToken) {
    return { status: "unavailable", memories: [] as string[] };
  }

  // Verify the user's session with Supabase Auth; never trust a user ID in the request body.
  const authResponse = await fetch(new URL("/auth/v1/user", supabaseUrl), {
    headers: { apikey: apiKey, Authorization: "Bearer " + accessToken },
  });
  if (!authResponse.ok) {
    return { status: "unavailable", memories: [] as string[] };
  }
  const user = await authResponse.json();
  if (!user || typeof user.id !== "string") {
    return { status: "unavailable", memories: [] as string[] };
  }

  // The user's JWT is forwarded unchanged so Postgres RLS limits rows to auth.uid().
  // There is deliberately no user_id filter supplied by the browser.
  const memoriesUrl = new URL("/rest/v1/avi_personal_memories", supabaseUrl);
  memoriesUrl.searchParams.set("select", "memory,created_at,updated_at,deleted_at,expires_at");
  memoriesUrl.searchParams.set("deleted_at", "is.null");
  memoriesUrl.searchParams.set("or", "(expires_at.is.null,expires_at.gt." + encodeURIComponent(new Date().toISOString()) + ")");
  memoriesUrl.searchParams.set("order", "updated_at.desc");
  memoriesUrl.searchParams.set("limit", "50");
  const memoryResponse = await fetch(memoriesUrl, {
    headers: { apikey: apiKey, Authorization: "Bearer " + accessToken },
  });
  if (!memoryResponse.ok) {
    throw new Error("Account memory retrieval failed with status " + memoryResponse.status);
  }
  const rows = await memoryResponse.json();
  return {
    status: "available",
    memories: rankMemories(Array.isArray(rows) ? rows : [], message, { limit: 8, maxChars: 6000 }),
  };
}

async function extractAndSaveMemories(req: Request, userMessages: string[], apiKey: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  let publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!publishableKey) {
    try {
      const namedKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
      publishableKey = namedKeys.default || Object.values(namedKeys).find((value) => typeof value === "string") || "";
    } catch { publishableKey = ""; }
  }
  const accessToken = bearerToken(req);
  if (!supabaseUrl || !publishableKey || !accessToken) return 0;

  const authResponse = await fetch(new URL("/auth/v1/user", supabaseUrl), {
    headers: { apikey: publishableKey, Authorization: "Bearer " + accessToken },
  });
  if (!authResponse.ok) return 0;
  const user = await authResponse.json();
  if (!user || typeof user.id !== "string") return 0;

  const extractionResponse = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildExtractionPrompt(userMessages) }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
      }),
    },
  );
  if (!extractionResponse.ok) throw new Error("Memory extraction model request failed");
  const extractionData = await extractionResponse.json();
  const raw = extractionData.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("") || "";
  const candidates = parseMemoryCandidates(raw);
  let saved = 0;
  for (const candidate of candidates) {
    const saveResponse = await fetch(new URL("/rest/v1/rpc/avi_upsert_extracted_memory", supabaseUrl), {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_memory: candidate.memory,
        p_category: candidate.category,
        p_confidence: candidate.confidence,
        p_importance: candidate.importance,
        p_memory_type: candidate.memory_type,
      }),
    });
    if (!saveResponse.ok) {
      console.error("AVI automatic memory save failed:", saveResponse.status);
      continue;
    }
    const result = await saveResponse.json();
    if (result?.status === "created" || result?.status === "refreshed") saved += 1;
  }
  return saved;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Only POST requests are supported." }, 405);

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return jsonResponse({ error: "Avi's AI service is not configured." }, 503);

    const body = await req.json();
    const message = body?.message;
    if (typeof message !== "string" || !message.trim() || message.length > 12000) {
      return jsonResponse({ error: "Please enter a message of up to 12,000 characters." }, 400);
    }

    const history = Array.isArray(body.history) ? body.history : [];
    let memoryResult = { status: "unavailable", memories: [] as string[] };
    try {
      memoryResult = await retrieveAccountMemories(req, message.trim());
    } catch (error) {
      console.error("AVI memory retrieval failed:", error);
      memoryResult = { status: "unavailable", memories: [] };
    }

    const currentTimeIST = new Intl.DateTimeFormat("en-IN", {
      dateStyle: "full", timeStyle: "long", timeZone: "Asia/Kolkata",
    }).format(new Date());

    let memoryInstruction = "";
    if (memoryResult.status === "available" && memoryResult.memories.length) {
      memoryInstruction = "Relevant saved memories retrieved securely from the signed-in user's account. Use them only when relevant and do not invent additional memories: " + JSON.stringify(memoryResult.memories);
    } else if (memoryResult.status === "available") {
      memoryInstruction = "No relevant saved memories were found for this message. Do not claim to remember a personal fact unless it appears in the conversation history.";
    } else {
      memoryInstruction = "Saved account memories could not be retrieved for this request. Do not claim that no memories exist and do not guess personal facts; answer from the conversation history and explain the memory lookup was temporarily unavailable if the user asks about remembered details.";
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "You are Avi, a friendly and helpful personal AI assistant. Give clear, natural, useful answers. Be honest about your capabilities. Keep replies concise by default: usually 1–3 short sentences, answer the direct question first, and avoid lengthy explanations or repeating the question. Give more detail only when the user asks or when safety or accuracy requires it. LIVE CURRENT DATE AND TIME: " + currentTimeIST + " (India Standard Time, Asia/Kolkata). When asked for the current time, date, day, or time-sensitive greeting, use this exact live timestamp. Never use a remembered date, training data date, UTC time, or a date from conversation history as the current time. " + memoryInstruction,
            }],
          },
          contents: [
            ...history.slice(-12).filter((item: { role?: string; text?: string }) =>
              (item.role === "user" || item.role === "model") && typeof item.text === "string"
            ).map((item: { role: string; text: string }) => ({
              role: item.role,
              parts: [{ text: item.text.slice(0, 4000) }],
            })),
            { role: "user", parts: [{ text: message.trim() }] },
          ],
        }),
      },
    );

    const result = await response.json();
    if (!response.ok) {
      console.error("Gemini API error:", result);
      return jsonResponse({ error: "Avi could not get an AI response. Please try again." }, 502);
    }

    const reply = result.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? "")
      .join("");
    if (!reply) return jsonResponse({ error: "Avi received an empty AI response. Please try again." }, 502);

    let memorySavedCount = 0;
    try {
      const userMessages = [
        ...history.slice(-7).filter((item: { role?: string; text?: string }) =>
          item.role === "user" && typeof item.text === "string"
        ).map((item: { text: string }) => item.text),
        message.trim(),
      ];
      memorySavedCount = await extractAndSaveMemories(req, userMessages, apiKey);
    } catch (error) {
      // Memory extraction is best-effort; it must never prevent a successful chat reply.
      console.error("AVI automatic memory extraction failed:", error);
    }

    return jsonResponse({ reply, memoryRetrieval: memoryResult.status, memorySavedCount });
  } catch (error) {
    console.error("Avi function error:", error);
    return jsonResponse({ error: "Something went wrong while Avi was responding. Please try again." }, 500);
  }
});
