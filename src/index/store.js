import fs from "fs";
import { INDEX_DIR, INDEX_FILE } from "../config.js";
import { buildIndex } from "./bm25.js";
import { serializeVector, deserializeVector } from "./semantic.js";
import { embedBatch } from "./embeddings.js";

function serialize(index) {
  return {
    builtAt: index.builtAt,
    N: index.N,
    avgdl: index.avgdl,
    idf: Array.from(index.idf.entries()),
    hasVectors: Array.isArray(index.vectors) && index.vectors.length > 0,
    vectors: (index.vectors || []).map((v) => (v ? serializeVector(v) : null)),
    docs: index.docs.map((d) => ({
      id: d.id,
      source: d.source,
      kind: d.kind,
      text: d.text,
      length: d.length,
      tf: Array.from(d.tf.entries()),
    })),
  };
}

export function saveIndex(index) {
  fs.mkdirSync(INDEX_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(serialize(index)), "utf8");
}

export function loadIndex() {
  if (!fs.existsSync(INDEX_FILE)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
    const docs = raw.docs.map((d) => ({
      ...d,
      tf: new Map(d.tf),
    }));
    const vectors = (raw.vectors || []).map((v) =>
      v ? deserializeVector(v) : null,
    );
    return {
      docs,
      idf: new Map(raw.idf),
      avgdl: raw.avgdl,
      N: raw.N,
      builtAt: raw.builtAt,
      vectors,
    };
  } catch {
    return null;
  }
}

export async function rebuildAndSave(chunks, { embeddings = false } = {}) {
  const index = buildIndex(chunks);

  if (embeddings) {
    const texts = index.docs.map((d) => d.text);
    index.vectors = await embedBatch(texts);
  }

  saveIndex(index);
  return index;
}

export function indexStats(index) {
  const sources = new Map();
  for (const doc of index.docs) {
    sources.set(doc.source, (sources.get(doc.source) || 0) + 1);
  }
  const byKind = new Map();
  for (const doc of index.docs) {
    byKind.set(doc.kind, (byKind.get(doc.kind) || 0) + 1);
  }
  return {
    chunks: index.docs.length,
    documents: sources.size,
    terms: index.idf.size,
    byKind: Object.fromEntries(byKind),
    builtAt: index.builtAt,
    semantic: Array.isArray(index.vectors) && index.vectors.length > 0,
    sources: Array.from(sources.entries()).sort((a, b) => b[1] - a[1]),
  };
}
