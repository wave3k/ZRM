import { loadConfig, listRemoteModels, remoteChatStream } from "./remote.js";
import {
  availableModels,
  isModelDownloaded,
  chatStream as localChatStream,
  isReady,
  currentModel,
  loadModel,
} from "./engine.js";
import { SYSTEM_PROMPT } from "./system.js";

export { SYSTEM_PROMPT };

export async function listAllModels() {
  const config = loadConfig();
  const local = availableModels().map((m) => ({ ...m, provider: "local" }));

  let remote = [];
  let remoteStatus = { kind: null, reachable: false };

  try {
    const result = await listRemoteModels(config);
    remote = result.models;
    remoteStatus = { kind: result.kind, reachable: result.models.length > 0 || result.kind !== null };
  } catch {
    remoteStatus = { kind: null, reachable: false };
  }

  return {
    config,
    local,
    remote,
    remoteStatus,
    loadedLocal: currentModel(),
    localReady: isReady(),
  };
}

export async function chat({
  provider,
  model,
  question,
  contextText,
  history,
  onToken,
  maxTokens = 400,
  temperature = 0.6,
}) {
  const config = loadConfig();
  const useRemote =
    provider === "remote" ||
    (provider === "auto" && (config.provider === "remote" || config.provider === "auto"));

  if (useRemote) {
    try {
      return await remoteChatStream({
        config,
        question,
        contextText,
        history,
        model,
        systemPrompt: SYSTEM_PROMPT,
        onToken,
        maxTokens,
        temperature,
      });
    } catch (error) {
      if (provider === "remote") throw error;
      // fallback local si le distant échoue
      if (!isModelDownloaded(config.local.model)) throw error;
      await loadModel(config.local.model);
      return localChatStream({
        question,
        contextText,
        history,
        onToken,
        maxTokens,
        temperature,
      });
    }
  }

  const localId = config.local.model || "fast";
  if (!isModelDownloaded(localId)) {
    throw new Error(
      "Aucun modèle local téléchargé. Lance 'npm run model:download' ou configure un serveur distant.",
    );
  }
  await loadModel(localId);
  return localChatStream({
    question,
    contextText,
    history,
    onToken,
    maxTokens,
    temperature,
  });
}

export async function warmup({ provider, model } = {}) {
  const config = loadConfig();
  const useRemote =
    provider === "remote" ||
    (provider !== "local" && (config.provider === "remote" || config.provider === "auto"));

  if (useRemote) {
    const result = await listRemoteModels(config);
    return { provider: "remote", kind: result.kind, models: result.models.length };
  }

  const localId = model || config.local.model || "fast";
  await loadModel(localId);
  return { provider: "local", model: localId };
}
