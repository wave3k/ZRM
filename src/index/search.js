import { search as bm25Search } from "./bm25.js";
import { semanticSearch } from "./semantic.js";

function normalize(results, key) {
  if (results.length === 0) return;
  const max = results[0].score;
  if (max <= 0) return;
  for (const r of results) r[key] = r.score / max;
}

export async function hybridSearch(index, queryTerms, query, topK = 6) {
  const hasVectors = Array.isArray(index.vectors) && index.vectors.length > 0;

  if (!hasVectors) {
    return bm25Search(index, queryTerms, topK);
  }

  const [keyword, semantic] = await Promise.all([
    Promise.resolve(bm25Search(index, queryTerms, topK * 2)),
    semanticSearch(index, query, topK * 2),
  ]);

  normalize(keyword, "norm");
  normalize(semantic, "norm");

  const bestKeyword = keyword.length > 0 ? keyword[0].score : 0;

  let keywordWeight;
  let semanticWeight;
  if (bestKeyword >= 3) {
    keywordWeight = 0.7;
    semanticWeight = 0.3;
  } else if (bestKeyword >= 1.5) {
    keywordWeight = 0.55;
    semanticWeight = 0.45;
  } else {
    keywordWeight = 0.35;
    semanticWeight = 0.65;
  }

  const merged = new Map();

  for (const r of semantic) {
    merged.set(r.doc.id, {
      doc: r.doc,
      semanticScore: r.norm,
      keywordScore: 0,
      score: semanticWeight * r.norm,
    });
  }

  for (const r of keyword) {
    const existing = merged.get(r.doc.id);
    if (existing) {
      existing.keywordScore = r.norm;
      existing.score =
        semanticWeight * existing.semanticScore + keywordWeight * r.norm;
    } else {
      merged.set(r.doc.id, {
        doc: r.doc,
        semanticScore: 0,
        keywordScore: r.norm,
        score: keywordWeight * r.norm,
      });
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
