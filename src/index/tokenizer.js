const STOPWORDS = new Set([
  "le", "la", "les", "un", "une", "des", "de", "du", "au", "aux", "et", "ou",
  "mais", "donc", "or", "ni", "car", "que", "qui", "quoi", "dont", "ou",
  "a", "as", "ai", "son", "sa", "ses", "ce", "cet", "cette", "ces", "mon",
  "ma", "mes", "ton", "ta", "tes", "il", "elle", "ils", "elles", "je", "tu",
  "nous", "vous", "on", "est", "sont", "ete", "etre", "avoir", "fait", "faire",
  "pour", "par", "sur", "sous", "dans", "avec", "sans", "chez", "vers", "en",
  "y", "a", "the", "of", "and", "or", "to", "in", "is", "are", "was", "were",
  "be", "been", "for", "on", "with", "as", "at", "by", "it", "this", "that",
  "these", "those", "an", "a", "i", "you", "he", "she", "we", "they", "do",
  "does", "did", "not", "no", "yes", "can", "could", "should", "would",
]);

function stripAccents(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeWord(word) {
  const lower = stripAccents(word.toLowerCase());
  if (lower.length > 5 && lower.endsWith("s")) {
    return lower.slice(0, -1);
  }
  return lower;
}

export function tokenize(text) {
  const raw = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const tokens = [];
  for (const w of raw) {
    const norm = normalizeWord(w);
    if (norm.length < 2) continue;
    if (STOPWORDS.has(norm)) continue;
    tokens.push(norm);
  }
  return tokens;
}

export function extractQueryTerms(query) {
  const tokens = tokenize(query);
  const seen = new Set();
  const out = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
