const ALLOWED_CATEGORIES = new Set(["work","family","preferences","finance","travel","personal","hobbies","goals"]);
const SENSITIVE_TERMS = /\b(health|medical|diagnosis|medication|pregnan\w*|religion|caste|politic\w*|sexual|password|otp|bank account|aadhaar|pan number)\b/i;

export function buildExtractionPrompt(userMessages) {
  const messages = (Array.isArray(userMessages) ? userMessages : [])
    .filter(value => typeof value === "string")
    .map(value => value.trim().slice(0, 2500))
    .filter(Boolean)
    .slice(-8);
  return [
    "Extract only clear, useful facts the user explicitly stated about themselves, their stable preferences, ongoing work, family relationships, plans, hobbies or goals.",
    "Do not infer facts, turn questions into facts, or extract assistant statements.",
    "Do not extract sensitive personal data, health/medical details, pregnancy, religion, caste, political views, sexual life, credentials, account numbers or government IDs. Do not store third-party private details.",
    "Ignore transient one-off events unless the user clearly says they are an ongoing plan or preference.",
    "Return JSON only: {\"memories\":[{\"memory\":\"one concise first-person fact\",\"category\":\"work|family|preferences|finance|travel|personal|hobbies|goals\",\"confidence\":0.0,\"importance\":1,\"memory_type\":\"long_term|temporary\"}]}",
    "Only include confidence >= 0.85. Importance is 1-5. Use temporary only for clearly time-limited plans; otherwise long_term. Maximum 4 items. If nothing qualifies return {\"memories\":[]}.",
    "USER MESSAGES:",
    ...messages.map((message, index) => (index + 1) + ". " + message),
  ].join("\n");
}

export function parseMemoryCandidates(raw) {
  let parsed;
  try {
    const text = String(raw || "").trim().replace(/^\uFEFF/, "");
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!parsed || !Array.isArray(parsed.memories)) return [];
  const seen = new Set();
  const output = [];
  for (const item of parsed.memories.slice(0, 8)) {
    if (!item || typeof item.memory !== "string") continue;
    const memory = item.memory.trim().replace(/\s+/g, " ");
    const category = String(item.category || "").toLowerCase();
    const confidence = Number(item.confidence);
    const importance = Math.round(Number(item.importance));
    const memory_type = item.memory_type === "temporary" ? "temporary" : "long_term";
    if (memory.length < 8 || memory.length > 500 || SENSITIVE_TERMS.test(memory)) continue;
    if (!ALLOWED_CATEGORIES.has(category) || !Number.isFinite(confidence) || confidence < 0.85 || confidence > 1) continue;
    if (!Number.isInteger(importance) || importance < 1 || importance > 5) continue;
    const key = memory.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push({ memory, category, confidence, importance, memory_type });
    if (output.length === 4) break;
  }
  return output;
}
