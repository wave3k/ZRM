import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.resolve(__dirname, "..", "..", "zrm.config.json");

const DEFAULTS = {
  provider: "auto",
  remote: {
    url: "http://127.0.0.1:11434",
    apiKey: "",
    model: "qwen2.5:3b",
    kind: "ollama",
  },
  local: {
    model: "fast",
  },
};

function readFileConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function loadConfig() {
  const file = readFileConfig();
  const env = {};

  if (process.env.ZRM_PROVIDER) env.provider = process.env.ZRM_PROVIDER;
  if (process.env.ZRM_REMOTE_URL || process.env.ZRM_REMOTE_KEY || process.env.ZRM_REMOTE_MODEL) {
    env.remote = {
      url: process.env.ZRM_REMOTE_URL || undefined,
      apiKey: process.env.ZRM_REMOTE_KEY || undefined,
      model: process.env.ZRM_REMOTE_MODEL || undefined,
    };
  }

  return {
    provider: env.provider || file.provider || DEFAULTS.provider,
    remote: {
      ...DEFAULTS.remote,
      ...(file.remote || {}),
      ...(env.remote || {}),
    },
    local: {
      ...DEFAULTS.local,
      ...(file.local || {}),
    },
  };
}

export function saveConfig(patch) {
  const current = readFileConfig();
  const merged = {
    ...current,
    ...patch,
    remote: { ...(current.remote || {}), ...(patch.remote || {}) },
    local: { ...(current.local || {}), ...(patch.local || {}) },
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf8");
  return loadConfig();
}

export function configPath() {
  return CONFIG_FILE;
}

function normalizeBase(url) {
  return String(url || "").replace(/\/+$/, "");
}

export function remoteEndpoint(config) {
  return normalizeBase(config.remote.url);
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(config) {
  const headers = { "Content-Type": "application/json" };
  if (config.remote.apiKey) {
    headers.Authorization = `Bearer ${config.remote.apiKey}`;
  }
  return headers;
}

export async function listRemoteModels(config) {
  const base = remoteEndpoint(config);

  const ollama = await fetchJson(`${base}/api/tags`, { headers: authHeaders(config) }, 8000);
  if (ollama.ok && Array.isArray(ollama.data?.models)) {
    return {
      kind: "ollama",
      models: ollama.data.models.map((m) => ({
        id: m.name,
        label: m.name,
        sizeMb: Math.round((m.size || 0) / (1024 * 1024)),
        provider: "remote",
      })),
    };
  }

  const openai = await fetchJson(`${base}/v1/models`, { headers: authHeaders(config) }, 8000);
  if (openai.ok && Array.isArray(openai.data?.data)) {
    return {
      kind: "openai",
      models: openai.data.data.map((m) => ({
        id: m.id,
        label: m.id,
        provider: "remote",
      })),
    };
  }

  return { kind: null, models: [] };
}

export async function testRemote(config) {
  const start = Date.now();
  try {
    const base = remoteEndpoint(config);
    const health = await fetchJson(`${base}/api/tags`, { headers: authHeaders(config) }, 8000);
    if (health.ok) {
      const list = await listRemoteModels(config);
      return {
        ok: true,
        kind: list.kind || "ollama",
        models: list.models.length,
        latencyMs: Date.now() - start,
      };
    }

    const v1 = await fetchJson(`${base}/v1/models`, { headers: authHeaders(config) }, 8000);
    if (v1.ok) {
      const list = await listRemoteModels(config);
      return {
        ok: true,
        kind: list.kind || "openai",
        models: list.models.length,
        latencyMs: Date.now() - start,
      };
    }

    return {
      ok: false,
      error: `Aucune API détectée sur ${base} (essaie /api/tags puis /v1/models).`,
    };
  } catch (error) {
    const message =
      error.name === "AbortError"
        ? "Délai dépassé — le serveur est-il démarré et le tunnel SSH ouvert ?"
        : error.message;
    return { ok: false, error: message };
  }
}

export async function remoteChatStream({
  config,
  question,
  contextText,
  history,
  model,
  systemPrompt,
  onToken,
  maxTokens = 400,
  temperature = 0.6,
}) {
  const base = remoteEndpoint(config);
  const useModel = model || config.remote.model;

  const messages = [{ role: "system", content: systemPrompt }];
  for (const msg of (history || []).slice(-4)) {
    const role = msg.role === "assistant" ? "assistant" : "user";
    const content = String(msg.content || "").slice(0, 600);
    if (content) messages.push({ role, content });
  }

  const userContent = contextText
    ? `Extraits de mes documents :\n\n${contextText}\n\n---\n\nQuestion : ${question}`
    : question;
  messages.push({ role: "user", content: userContent });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  let res;
  try {
    res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(config),
      signal: controller.signal,
      body: JSON.stringify({
        model: useModel,
        messages,
        stream: true,
        temperature,
        max_tokens: maxTokens,
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Erreur du serveur distant (${res.status}) : ${text.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          if (onToken) onToken(delta);
        }
      } catch {
        /* ignore */
      }
    }
  }

  return full;
}
