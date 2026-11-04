const NEGATION = new Set(["not","no","never","dont","doesnt","didnt","cannot","cant","wont","isnt","arent"]); 
const STOP = new Set(["a","an","and","are","as","at","be","been","being","by","do","does","did","for","from","have","i","in","is","it","me","my","of","on","or","our","the","to","was","we","with"]);
function words(value) {
  return String(value || "").toLowerCase().replace(/\b(don\x27t)\b/g,"dont").replace(/\b(doesn\x27t)\b/g,"doesnt").replace(/\b(didn\x27t)\b/g,"didnt").replace(/\b(can\x27t)\b/g,"cant").replace(/\b(won\x27t)\b/g,"wont").replace(/\b(isn\x27t)\b/g,"isnt").replace(/\b(aren\x27t)\b/g,"arent").match(/[a-z0-9]+/g) || [];
}
function signature(value) {
  const all = words(value);
  const negated = all.some(word => NEGATION.has(word));
  const facts = all.filter(word => !NEGATION.has(word) && !STOP.has(word));
  return { negated, facts: [...new Set(facts)].sort() };
}
/** Flags only near-identical claims with opposite explicit polarity. No inference or mutation. */
export function findPotentialMemoryConflicts(candidate, existingMemories) {
  if (typeof candidate !== "string" || !Array.isArray(existingMemories)) return [];
  const current = signature(candidate);
  if (current.facts.length < 2) return [];
  const key = current.facts.join("|");
  return existingMemories.flatMap(entry => {
    const memory = typeof entry === "string" ? entry : entry?.memory;
    if (typeof memory !== "string") return [];
    const prior = signature(memory);
    if (prior.facts.length < 2 || prior.negated === current.negated || prior.facts.join("|") !== key) return [];
    return [{ memory, id: typeof entry === "object" ? entry.id || null : null, reason: "same key terms with opposite explicit negation" }];
  });
}
