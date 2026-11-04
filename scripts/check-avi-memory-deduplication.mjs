import assert from "node:assert/strict";
import { findPotentialMemoryDuplicates } from "../supabase/functions/avi-chat/memory-deduplication.mjs";
const existing = [
 { id: "1", memory: "I prefer simple practical explanations for technical topics." },
 { id: "2", memory: "I work as a QA automation engineer using Java and Selenium." },
 { id: "3", memory: "My favorite holiday destination is the mountains." }
];
const near = findPotentialMemoryDuplicates("I prefer simple and practical explanations for technical topics.", existing);
assert.equal(near.length, 1, "A close paraphrase should be flagged for review");
assert.equal(near[0].id, "1");
assert.ok(near[0].score >= 0.78);
assert.equal(findPotentialMemoryDuplicates("I enjoy cooking spicy food on weekends.", existing).length, 0, "Unrelated facts must not be treated as duplicates");
assert.equal(findPotentialMemoryDuplicates("I like tea", existing).length, 0, "Short generic statements must not trigger a duplicate warning");
assert.equal(findPotentialMemoryDuplicates("A clear and useful sentence", null).length, 0);
console.log("AVI Phase 4D deduplication checks passed.");
