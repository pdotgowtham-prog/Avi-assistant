const STOP_WORDS = new Set([
  "the","and","for","with","that","this","what","when","where","which","who","whom",
  "how","are","was","were","is","am","do","does","did","can","could","would","should",
  "tell","me","about","my","mine","your","you","avi","please","remember","saved",
  "memory","memories","have","has","had","from","into","onto","then","than","there",
  "their","they","them","his","her","hers","him","our","ours","its","it's","a","an",
  "of","to","in","on","at","by","as","be","it","i"
]);

const CATEGORY_TERMS = {
  work: ["work","job","career","project","interview","resume","office","client","team","company","salary"],
  family: ["wife","husband","mother","father","brother","sister","family","wedding","baby","child","parent"],
  preferences: ["prefer","favorite","favourite","like","dislike","usually","always","enjoy"],
  finance: ["money","budget","loan","investment","expense","income","bank","savings","salary","emi"],
  travel: ["travel","trip","visit","journey","hotel","flight","vacation","holiday"],
  health: ["health","doctor","medicine","pregnancy","scan","fitness","symptom","hospital"],
  personal: ["name","birthday","born","live","location","home","address","age"]
};

const IMPORTANT_TERMS = new Set([
  "prefer","favorite","favourite","goal","important","always","never","wife","husband",
  "mother","father","brother","sister","family","birthday","career","project","allergy"
]);

function tokenize(value) {
  return String(value || "").toLowerCase().match(/[a-z0-9]+/g)?.filter(token => token.length > 2 && !STOP_WORDS.has(token)) || [];
}

function categoriesFor(value) {
  const tokens = new Set(tokenize(value));
  return Object.entries(CATEGORY_TERMS)
    .filter(([, terms]) => terms.some(term => tokens.has(term)))
    .map(([category]) => category);
}

function importanceScore(memory) {
  const tokens = new Set(tokenize(memory));
  let score = 0;
  for (const term of IMPORTANT_TERMS) if (tokens.has(term)) score += 0.35;
  return Math.min(score, 1.4);
}

/**
 * Rank only the active memory rows supplied by the authenticated backend query.
 * No user identifier or client-supplied memory list is accepted here.
 */
export function rankMemories(memories, query, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 8, 12));
  const maxChars = Math.max(500, Math.min(Number(options.maxChars) || 6000, 8000));
  const queryTokens = new Set(tokenize(query));
  const queryCategories = new Set(categoriesFor(query));
  const now = Number(options.now) || Date.now();

  const ranked = (Array.isArray(memories) ? memories : [])
    .filter(item => item && typeof item.memory === "string" && item.memory.trim() && !item.deleted_at)
    .map(item => {
      const memoryTokens = new Set(tokenize(item.memory));
      let overlap = 0;
      for (const token of queryTokens) if (memoryTokens.has(token)) overlap += 1;
      const memoryCategories = categoriesFor(item.memory);
      const categoryMatch = memoryCategories.some(category => queryCategories.has(category));
      const phraseMatch = query && item.memory.toLowerCase().includes(String(query).trim().toLowerCase());
      const updated = Date.parse(item.updated_at || item.created_at || "") || 0;
      const ageDays = updated ? Math.max(0, (now - updated) / 86400000) : 365;
      const recency = Math.max(0, 1 - ageDays / 365);
      const relevance = overlap * 2 + (categoryMatch ? 2.5 : 0) + (phraseMatch ? 5 : 0);
      const importance = importanceScore(item.memory);
      return { item, score: relevance + importance + recency * 0.35, overlap, categoryMatch };
    })
    .filter(entry => queryTokens.size === 0 || entry.overlap > 0 || entry.categoryMatch || entry.score >= 1.4)
    .sort((a, b) => b.score - a.score || (Date.parse(b.item.updated_at || b.item.created_at || "") || 0) - (Date.parse(a.item.updated_at || a.item.created_at || "") || 0));

  const selected = [];
  let used = 0;
  for (const entry of ranked) {
    if (selected.length >= limit) break;
    const value = entry.item.memory.trim();
    if (used + value.length > maxChars) continue;
    selected.push(value);
    used += value.length;
  }
  return selected;
}

export { categoriesFor, tokenize };
