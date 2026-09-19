import { BM25_K1, BM25_B } from "../config.js";
import { tokenize } from "./tokenizer.js";

export function buildIndex(chunks) {
  const docs = [];
  const df = new Map();
  let totalLength = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const tokens = tokenize(chunk.text);
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);

    for (const term of tf.keys()) {
      df.set(term, (df.get(term) || 0) + 1);
    }

    totalLength += tokens.length;
    docs.push({
      id: i,
      source: chunk.source,
      kind: chunk.kind,
      text: chunk.text,
      length: tokens.length,
      tf,
    });
  }

  const avgdl = docs.length > 0 ? totalLength / docs.length : 0;
  const N = docs.length;
  const idf = new Map();
  for (const [term, freq] of df.entries()) {
    const value = Math.log(1 + (N - freq + 0.5) / (freq + 0.5));
    idf.set(term, value);
  }

  return { docs, idf, avgdl, N, builtAt: new Date().toISOString() };
}

export function search(index, queryTerms, topK) {
  const { docs, idf, avgdl } = index;
  const scores = new Float64Array(docs.length);

  for (const term of queryTerms) {
    const idfValue = idf.get(term);
    if (idfValue === undefined) continue;
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const freq = doc.tf.get(term);
      if (!freq) continue;
      const norm = 1 - BM25_B + BM25_B * (doc.length / (avgdl || 1));
      const score = idfValue * ((freq * (BM25_K1 + 1)) / (freq + BM25_K1 * norm));
      scores[i] += score;
    }
  }

  const results = [];
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > 0) results.push({ doc: docs[i], score: scores[i] });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}
