import { embedQuery, cosineSimilarity } from "./embeddings.js";

export async function semanticSearch(index, query, topK = 6) {
  if (!index.vectors || index.vectors.length === 0) return [];

  const queryVector = await embedQuery(query);
  const results = [];

  for (let i = 0; i < index.docs.length; i++) {
    const vector = index.vectors[i];
    if (!vector) continue;
    const score = cosineSimilarity(queryVector, vector);
    results.push({ doc: index.docs[i], score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

export function serializeVector(vector) {
  const buffer = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
  return buffer.toString("base64");
}

export function deserializeVector(base64) {
  const buffer = Buffer.from(base64, "base64");
  return new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
}
