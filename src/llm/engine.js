import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SYSTEM_PROMPT } from "./system.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, "..", "..", ".models");

export const MODELS = {
  fast: {
    id: "fast",
    label: "Rapide (0.5B)",
    file: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    sizeMb: 469,
  },
  quality: {
    id: "quality",
    label: "Qualité (1.5B)",
    file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
    sizeMb: 1066,
  },
};

const THREADS = 4;
const CONTEXT_SIZE = 1536;

let llamaInstance = null;
let loadedModel = null;
let loadedModelId = null;
let loadedContext = null;
let loadedSession = null;
let LlamaChatSessionClass = null;
let loadingPromise = null;

function modelPath(modelId) {
  const entry = MODELS[modelId] || MODELS.fast;
  return path.join(MODELS_DIR, entry.file);
}

export function availableModels() {
  return Object.values(MODELS).map((m) => ({
    ...m,
    downloaded: fs.existsSync(modelPath(m.id)),
  }));
}

export function isModelDownloaded(modelId) {
  return fs.existsSync(modelPath(modelId));
}

export function isReady() {
  return loadedModel !== null && loadedSession !== null;
}

export function currentModel() {
  return loadedModelId;
}

async function loadLlama() {
  if (llamaInstance) return llamaInstance;
  const mod = await import("node-llama-cpp");
  LlamaChatSessionClass = mod.LlamaChatSession;
  llamaInstance = await mod.getLlama({ gpu: false });
  return llamaInstance;
}

export async function loadModel(modelId = "fast") {
  if (!isModelDownloaded(modelId)) {
    throw new Error(
      `Modèle '${modelId}' non téléchargé. Lance : npm run model:download`,
    );
  }

  if (loadedModel && loadedModelId === modelId && loadedSession) {
    return loadedSession;
  }

  if (loadingPromise) await loadingPromise;

  loadingPromise = (async () => {
    if (loadedSession) {
      try {
        await loadedContext.dispose();
      } catch {}
      try {
        await loadedModel.dispose();
      } catch {}
      loadedSession = null;
      loadedContext = null;
      loadedModel = null;
    }

    const llama = await loadLlama();
    loadedModel = await llama.loadModel({ modelPath: modelPath(modelId) });
    loadedContext = await loadedModel.createContext({
      contextSize: CONTEXT_SIZE,
      threads: THREADS,
    });
    loadedSession = new LlamaChatSessionClass({
      contextSequence: loadedContext.getSequence(),
      systemPrompt: SYSTEM_PROMPT,
    });
    loadedModelId = modelId;
    return loadedSession;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

export async function unload() {
  if (loadedSession) {
    try {
      await loadedContext.dispose();
    } catch {}
    try {
      await loadedModel.dispose();
    } catch {}
  }
  loadedSession = null;
  loadedContext = null;
  loadedModel = null;
  loadedModelId = null;
}

export async function chatStream({
  question,
  contextText,
  history,
  onToken,
  maxTokens = 220,
  temperature = 0.6,
}) {
  const session = await loadModel(loadedModelId || "fast");

  const items = [];
  for (const msg of (history || []).slice(-4)) {
    const role = msg.role === "assistant" ? "model" : "user";
    const text = String(msg.content || "").slice(0, 500);
    if (text) items.push({ type: role, text });
  }
  await session.setChatHistory(items);

  const parts = [];
  if (contextText) {
    parts.push(
      `Extraits de mes documents :\n\n${contextText}\n\n---\n\nQuestion : ${question}`,
    );
  } else {
    parts.push(question);
  }

  let text = "";
  await session.prompt(parts.join("\n"), {
    maxTokens,
    temperature,
    onTextChunk(chunk) {
      text += chunk;
      if (onToken) onToken(chunk);
    },
  });
  return text;
}
