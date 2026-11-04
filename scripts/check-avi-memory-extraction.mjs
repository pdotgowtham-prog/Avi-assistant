import assert from "node:assert/strict";
import { buildExtractionPrompt, parseMemoryCandidates } from "../supabase/functions/avi-chat/memory-extraction.mjs";

const prompt = buildExtractionPrompt(["I work as a QA engineer.", "What is the weather today?"]);
assert.match(prompt, /Do not infer facts/);
assert.match(prompt, /Do not extract sensitive personal data/);

const parsed = parseMemoryCandidates(JSON.stringify({ memories: [
  { memory: "I work as a QA Automation Engineer.", category: "work", confidence: 0.96, importance: 4, memory_type: "long_term" },
  { memory: "My favorite color is blue.", category: "preferences", confidence: 0.92, importance: 2, memory_type: "long_term" },
  { memory: "I am pregnant.", category: "family", confidence: 0.99, importance: 5, memory_type: "long_term" },
  { memory: "I might travel next month.", category: "travel", confidence: 0.7, importance: 2, memory_type: "temporary" },
  { memory: "I work as a QA Automation Engineer.", category: "work", confidence: 0.96, importance: 4, memory_type: "long_term" }
] }));
assert.equal(parsed.length, 2, "Only safe, confident, unique candidates should pass");
assert.equal(parsed[0].category, "work");
assert.equal(parseMemoryCandidates("not json").length, 0);
assert.equal(parseMemoryCandidates(JSON.stringify({ memories: [{ memory: "My password is abc12345", category: "personal", confidence: 0.99, importance: 5 }] })).length, 0);
console.log("AVI Phase 4C extraction checks passed: conservative extraction, confidence thresholds, sensitive-data filtering and deduplication.");
