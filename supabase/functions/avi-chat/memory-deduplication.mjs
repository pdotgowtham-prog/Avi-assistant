const STOP_WORDS = new Set(["a","an","and","are","as","at","be","been","being","by","for","from","have","i","in","is","it","me","my","of","on","or","our","the","to","was","we","with"]);

function tokens(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]+/g)?.filter(token => token.length > 1 && !STOP_WORDS.has(token)) || [];
}

/** Conservative detector: returns review candidates only; it never mutates memories. */
export function findPotentialMemoryDuplicates(candidate, existingMemories, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.78;
  const candidateTokens = [...new Set(tokens(candidate))];
  if (candidateTokens.length < 3 || !Array.isArray(existingMemories)) return [];
  const results = [];
  for (const entry of existingMemories) {
    const memory = typeof entry === "string" ? entry : entry?.memory;
    if (typeof memory !== "string" || !memory.trim()) continue;
    const existingTokens = [...new Set(tokens(memory))];
    if (existingTokens.length < 3) continue;
    const existingSet = new Set(existingTokens);
    const intersection = candidateTokens.filter(token => existingSet.has(token)).length;
    const union = new Set([...candidateTokens, ...existingTokens]).size;
    const jaccard = union ? intersection / union : 0;
    const containment = intersection / Math.min(candidateTokens.length, existingTokens.length);
    const score = Math.max(jaccard, containment * 0.92);
    if (score >= threshold) results.push({ memory, id: typeof entry === "object" ? entry.id || null : null, score: Number(score.toFixed(3)), reason: jaccard >= threshold ? "high token overlap" : "one statement closely contains the other" });
  }
  return results.sort((a, b) => b.score - a.score);
}
