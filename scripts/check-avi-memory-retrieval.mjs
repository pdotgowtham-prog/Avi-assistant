import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { rankMemories } from "../supabase/functions/avi-chat/memory-retrieval.mjs";

const memories = [
  { memory: "My wife's name is Meena.", updated_at: "2026-11-01T00:00:00Z" },
  { memory: "I work as a QA Automation Engineer.", updated_at: "2026-10-30T00:00:00Z" },
  { memory: "My favourite colour is blue.", updated_at: "2026-10-29T00:00:00Z" },
  { memory: "I am planning a trip to Dharmasthala.", updated_at: "2026-10-28T00:00:00Z" },
  { memory: "Deleted secret memory", deleted_at: "2026-11-02T00:00:00Z" },
];

const family = rankMemories(memories, "What is my wife's name?", { now: Date.parse("2026-11-04T00:00:00Z") });
assert.equal(family[0], "My wife's name is Meena.", "Family query should rank the relevant memory first");
assert.ok(!family.some(item => item.includes("Deleted")), "Tombstoned rows must never be returned");

const work = rankMemories(memories, "What is my job?", { now: Date.parse("2026-11-04T00:00:00Z") });
assert.equal(work[0], "I work as a QA Automation Engineer.", "Work query should rank work memory first");

const preference = rankMemories(memories, "What is my favourite colour?", { now: Date.parse("2026-11-04T00:00:00Z") });
assert.equal(preference[0], "My favourite colour is blue.", "Preference query should rank preference memory first");

const bounded = rankMemories(
  Array.from({ length: 20 }, (_, i) => ({ memory: "Important personal detail " + i })),
  "personal detail",
  { limit: 5, maxChars: 1000 },
);
assert.ok(bounded.length <= 5, "Result count must respect the configured limit");
assert.ok(bounded.join("").length <= 1000, "Result text must respect the context character budget");

const html = readFileSync("index.html", "utf8");
const edge = readFileSync("supabase/functions/avi-chat/index.ts", "utf8");
assert.match(html, /Authorization:\s*["']Bearer ["']\s*\+\s*sessionData\.session\.access_token/,
  "Browser must send the current authenticated session JWT");
assert.match(html, /body:\s*JSON\.stringify\(\{\s*message:\s*text,\s*history:/,
  "Browser request must not include its local saved-memory list");
assert.doesNotMatch(html, /history:\s*conversationHistory\.slice\(-12\),\s*memory:\s*personalMemory/,
  "Client-supplied memories must not be sent to the model endpoint");
assert.match(edge, /auth\/v1\/user/,
  "Backend must verify the user with Supabase Auth");
assert.match(edge, /Authorization:\s*["']Bearer ["']\s*\+\s*accessToken/,
  "Backend must forward the verified user token to the RLS-protected Data API");
assert.match(edge, /deleted_at/,
  "Backend must exclude tombstoned memories");
assert.match(edge, /rankMemories\(/,
  "Backend must rank memories before building model context");
assert.match(edge, /memoryResult\.status === ["']available["']/,
  "Backend must distinguish an empty result from retrieval failure");
assert.doesNotMatch(edge, /body\.user_id|body\?\.user_id/,
  "Backend must not trust a user ID supplied in the request body");

console.log("AVI Phase 4B checks passed: relevance ranking, category matching, tombstones, context bounds, authenticated retrieval and client-memory removal.");
