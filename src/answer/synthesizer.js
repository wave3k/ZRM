import yocto from "yoctocolors";
import { extractQueryTerms } from "../index/tokenizer.js";

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text, terms, ansi) {
  if (!ansi || terms.length === 0) return text;
  let result = text;
  for (const term of terms) {
    if (term.length < 3) continue;
    const regex = new RegExp(`(\\b\\p{L}*${escapeRegex(term)}\\p{L}*\\b)`, "giu");
    result = result.replace(regex, (m) => yocto.bgYellow(yocto.black(m)));
  }
  return result;
}

function centerOnMatch(flat, terms, maxLength) {
  if (flat.length <= maxLength) return flat;

  let bestIndex = -1;
  let bestHits = 0;
  const lower = flat.toLowerCase();

  for (const term of terms) {
    if (term.length < 3) continue;
    const root = term.slice(0, 4);
    const idx = lower.indexOf(root);
    if (idx === -1) continue;
    let hits = 0;
    for (const t of terms) {
      if (t.length >= 3 && lower.includes(t.slice(0, 4))) hits++;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestIndex = idx;
    }
  }

  if (bestIndex === -1) {
    return flat.slice(0, maxLength).replace(/\s+\S*$/, "") + "…";
  }

  const half = Math.floor(maxLength / 2);
  let start = Math.max(0, bestIndex - half);
  let end = Math.min(flat.length, start + maxLength);
  if (end - start < maxLength) start = Math.max(0, end - maxLength);

  const prefix = start > 0 ? "… " : "";
  const suffix = end < flat.length ? " …" : "";
  return prefix + flat.slice(start, end).trim() + suffix;
}

function cleanSnippet(text, terms, maxLength = 420) {
  const flat = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" · ")
    .replace(/\s{2,}/g, " ");
  return centerOnMatch(flat, terms, maxLength);
}

export function synthesize(query, results, options = {}) {
  const { ansi = true } = options;
  const terms = extractQueryTerms(query);

  if (results.length === 0) {
    return {
      answer:
        "Je n'ai trouvé aucun passage pertinent dans mes données. Reformule la question ou ajoute des documents dans le dossier 'data/'.",
      citations: [],
    };
  }

  const topScore = results[0].score;
  const cutoff = Math.max(topScore * 0.5, 0.2);
  const selected = results.filter((r) => r.score >= cutoff).slice(0, 3);

  const picks = [];
  const seen = new Set();
  for (const { doc, score } of selected) {
    const snippet = cleanSnippet(doc.text, terms);
    const key = snippet.toLowerCase().slice(0, 50);
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push({ text: snippet, source: doc.source, score });
    if (picks.length >= 3) break;
  }

  const body = picks
    .map((p) => `• ${highlight(p.text, terms, ansi)}`)
    .join("\n");

  const citationSet = new Map();
  for (const p of picks) {
    citationSet.set(p.source, (citationSet.get(p.source) || 0) + 1);
  }
  const citations = Array.from(citationSet.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => `${source} (${count} passage${count > 1 ? "s" : ""})`);

  return { answer: body, citations, terms };
}
