import assert from "node:assert/strict";
import { findPotentialMemoryConflicts } from "../supabase/functions/avi-chat/memory-conflicts.mjs";
const memories = [
 {id:"1",memory:"I like tea"},
 {id:"2",memory:"I prefer simple practical explanations"},
 {id:"3",memory:"I work in Bangalore"}
];
const opposite = findPotentialMemoryConflicts("I do not like tea", memories);
assert.equal(opposite.length, 1, "Explicit opposite polarity should be flagged");
assert.equal(opposite[0].id, "1");
assert.equal(findPotentialMemoryConflicts("I like coffee", memories).length, 0, "Different subjects must not conflict");
assert.equal(findPotentialMemoryConflicts("I prefer clear simple explanations", memories).length, 0, "Different claims must not be treated as contradictions");
assert.equal(findPotentialMemoryConflicts("I like tea", memories).length, 0, "Same-polarity statements are not conflicts");
assert.equal(findPotentialMemoryConflicts("I do not like tea", null).length, 0);
console.log("AVI Phase 4D conflict candidate checks passed.");
