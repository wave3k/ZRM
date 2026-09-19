import { pipeline, env } from "@xenova/transformers";
import path from "path";
import { fileURLToPath } from "url";
import { EMBEDDING_MODEL } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

env.allowLocalModels = false;
env.useBrowserCache = false;
env.cacheDir = path.resolve(__dirname, "..", "..", ".models");

const MODEL_ID = EMBEDDING_MODEL;
const USES_PREFIXES = /e5/i.test(MODEL_ID);

let extractorPromise = null;
let cachedPipeline = null;

async function getExtractor() {
  if (cachedPipeline) return cachedPipeline;
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_ID).then((pipe) => {
      cachedPipeline = pipe;
      return pipe;
    });
  }
  return extractorPromise;
}

export function isEmbeddingAvailable() {
  return cachedPipeline !== null;
}

export async function warmupEmbeddings() {
  return getExtractor();
}

async function run(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, {
    pooling: "mean",
    normalize: true,
  });
  return new Float32Array(output.data);
}

export async function embedPassage(text) {
  const input = USES_PREFIXES ? `passage: ${text}` : text;
  return run(input);
}

export async function embedQuery(text) {
  const input = USES_PREFIXES ? `query: ${text}` : text;
  return run(input);
}

export async function embedBatch(texts, onEach) {
  const vectors = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(await embedPassage(texts[i]));
    if (onEach) onEach(i + 1, texts.length);
  }
  return vectors;
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}
