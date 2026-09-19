import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  DATA_DIR,
  MODEL_NAME,
  TOP_K,
  MIN_SCORE,
  SUPPORTED_EXTENSIONS,
  MAX_FILE_BYTES,
} from "./config.js";
import { scanDataDir } from "./ingest/scanner.js";
import { rebuildAndSave, loadIndex, indexStats } from "./index/store.js";
import { hybridSearch } from "./index/search.js";
import { extractQueryTerms } from "./index/tokenizer.js";
import { synthesize } from "./answer/synthesizer.js";
import { warmupEmbeddings } from "./index/embeddings.js";
import { renderDocumentPage } from "./viewer.js";
import { detectChartIntent, buildChart } from "./charts/builder.js";
import { listAllModels, chat as runChat, warmup } from "./llm/router.js";
import { loadConfig, saveConfig, testRemote, configPath } from "./llm/remote.js";
import { buildContextBlock } from "./llm/prompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..", "web");
const PORT = process.env.PORT ? Number(process.env.PORT) : 5178;

let index = loadIndex();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("payload trop volumineux"));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("JSON invalide"));
      }
    });
    req.on("error", reject);
  });
}

function readRawBody(req, limit = MAX_FILE_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("fichier trop volumineux"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function safeJoinData(relPath) {
  const normalized = relPath.replace(/\\/g, "/").replace(/\.\./g, "");
  const full = path.resolve(DATA_DIR, normalized);
  if (!full.startsWith(path.resolve(DATA_DIR))) return null;
  return full;
}

function listDocuments() {
  const out = [];
  if (!fs.existsSync(DATA_DIR)) return out;

  const walk = (dir, base) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const stats = fs.statSync(full);
        out.push({
          name: rel,
          size: stats.size,
          supported: SUPPORTED_EXTENSIONS.includes(ext),
          indexed: index ? index.docs.some((d) => d.source === rel) : false,
        });
      }
    }
  };

  walk(DATA_DIR, "");
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(WEB_DIR, urlPath);

  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403);
    res.end("Interdit");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Introuvable");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

async function reindex() {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  await warmupEmbeddings();
  const start = performance.now();
  const { chunks, files, skipped } = await scanDataDir(DATA_DIR);
  index = await rebuildAndSave(chunks, { embeddings: true });
  return {
    chunks: chunks.length,
    files,
    skipped,
    elapsedMs: Math.round(performance.now() - start),
  };
}

async function retrieve(question) {
  if (!index) return { results: [], terms: [] };
  const terms = extractQueryTerms(question);
  await warmupEmbeddings();
  const results = (await hybridSearch(index, terms, question, TOP_K)).filter(
    (r) => r.score >= MIN_SCORE,
  );
  return { results, terms };
}

function extractArtifacts(text) {
  const artifacts = [];
  let clean = text;

  const htmlRe = /```html\s*([\s\S]*?)```/gi;
  let match;
  while ((match = htmlRe.exec(text)) !== null) {
    const content = match[1].trim();
    if (content.length > 20) {
      artifacts.push({
        type: "html",
        title: "Aperçu HTML",
        content,
      });
    }
    clean = clean.replace(match[0], "");
  }

  const chartRe = /```chart\s*([\s\S]*?)```/gi;
  while ((match = chartRe.exec(text)) !== null) {
    try {
      const spec = JSON.parse(match[1].trim());
      if (spec && spec.labels && spec.datasets) {
        artifacts.push({ type: "chart", title: spec.title || "Graphique", spec });
      }
    } catch {
      /* ignore */
    }
    clean = clean.replace(match[0], "");
  }

  return { clean: clean.replace(/\n{3,}/g, "\n\n").trim(), artifacts };
}

function sseInit(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

function sseSend(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function handleChat(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return json(res, 400, { error: error.message });
  }

  const question = (body.question || "").trim();
  const mode = body.mode === "llm" ? "llm" : "fast";
  const history = Array.isArray(body.history) ? body.history : [];
  const provider = ["local", "remote", "auto"].includes(body.provider)
    ? body.provider
    : undefined;
  const model = typeof body.model === "string" ? body.model : undefined;

  if (!question) return json(res, 400, { error: "Question vide." });

  const { results, terms } = await retrieve(question);

  const chartIntent = detectChartIntent(question);
  let chartArtifact = null;
  if (chartIntent.wanted) {
    const chart = buildChart(question, chartIntent.type);
    if (chart.ok) chartArtifact = { type: "chart", title: chart.spec.title, spec: chart.spec };
  }

  sseInit(res);
  sseSend(res, { type: "start", mode });

  const citations = results.length
    ? Array.from(
        results
          .reduce((map, r) => {
            map.set(r.doc.source, (map.get(r.doc.source) || 0) + 1);
            return map;
          }, new Map())
          .entries(),
      ).map(([source, count]) => `${source} (${count} passage${count > 1 ? "s" : ""})`)
    : [];

  if (mode === "llm") {
    try {
      const contextText = buildContextBlock(results);

      let full = "";
      await runChat({
        provider,
        model,
        question,
        contextText,
        history,
        maxTokens: 400,
        temperature: 0.6,
        onToken(chunk) {
          full += chunk;
          sseSend(res, { type: "token", text: chunk });
        },
      });

      const { clean, artifacts } = extractArtifacts(full);
      if (artifacts.length > 0) {
        sseSend(res, { type: "replace", text: clean });
        for (const artifact of artifacts) sseSend(res, { type: "artifact", artifact });
      }
      if (chartArtifact) sseSend(res, { type: "artifact", artifact: chartArtifact });
      sseSend(res, { type: "sources", citations });
      sseSend(res, { type: "done" });
      return res.end();
    } catch (error) {
      sseSend(res, { type: "error", message: error.message });
      sseSend(res, { type: "done" });
      return res.end();
    }
  }

  // mode rapide : réponse extractive instantanée
  const { answer, citations: extractiveCitations } = synthesize(question, results, {
    ansi: false,
  });
  sseSend(res, { type: "token", text: answer });
  if (chartArtifact) sseSend(res, { type: "artifact", artifact: chartArtifact });
  sseSend(res, {
    type: "sources",
    citations: extractiveCitations.length ? extractiveCitations : citations,
  });
  sseSend(res, { type: "done" });
  res.end();
}

async function handleApi(req, res, urlPath) {
  if (req.method === "GET" && urlPath === "/api/stats") {
    if (!index) {
      return json(res, 200, { indexed: false, chunks: 0, documents: 0 });
    }
    const stats = indexStats(index);
    return json(res, 200, {
      indexed: true,
      chunks: stats.chunks,
      documents: stats.documents,
      terms: stats.terms,
      byKind: stats.byKind,
      semantic: stats.semantic,
      builtAt: stats.builtAt,
      sources: stats.sources.map(([source, count]) => ({ source, count })),
    });
  }

  if (req.method === "GET" && urlPath === "/api/models") {
    try {
      const info = await listAllModels();
      return json(res, 200, {
        provider: info.config.provider,
        local: info.local,
        remote: info.remote,
        remoteStatus: info.remoteStatus,
        remoteUrl: info.config.remote.url,
        remoteModel: info.config.remote.model,
        loaded: info.loadedLocal,
        ready: info.localReady,
      });
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  }

  if (req.method === "GET" && urlPath === "/api/config") {
    const config = loadConfig();
    return json(res, 200, {
      ...config,
      remote: { ...config.remote, apiKey: config.remote.apiKey ? "***" : "" },
      path: configPath(),
    });
  }

  if (req.method === "POST" && urlPath === "/api/config") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
    const patch = {};
    if (["auto", "local", "remote"].includes(body.provider)) patch.provider = body.provider;
    if (body.remote && typeof body.remote === "object") {
      patch.remote = {};
      if (typeof body.remote.url === "string") patch.remote.url = body.remote.url.trim();
      if (typeof body.remote.model === "string") patch.remote.model = body.remote.model.trim();
      if (typeof body.remote.apiKey === "string" && body.remote.apiKey !== "***") {
        patch.remote.apiKey = body.remote.apiKey.trim();
      }
    }
    if (body.local && typeof body.local.model === "string") {
      patch.local = { model: body.local.model };
    }
    const config = saveConfig(patch);
    return json(res, 200, {
      ok: true,
      config: { ...config, remote: { ...config.remote, apiKey: config.remote.apiKey ? "***" : "" } },
    });
  }

  if (req.method === "POST" && urlPath === "/api/remote/test") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
    const current = loadConfig();
    const config = {
      ...current,
      remote: {
        ...current.remote,
        ...(body.url ? { url: String(body.url).trim() } : {}),
        ...(body.apiKey && body.apiKey !== "***" ? { apiKey: String(body.apiKey).trim() } : {}),
      },
    };
    const result = await testRemote(config);
    return json(res, 200, result);
  }

  if (req.method === "POST" && urlPath === "/api/models/warmup") {
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch {
      /* optionnel */
    }
    try {
      const start = performance.now();
      const result = await warmup({ provider: body.provider, model: body.model });
      return json(res, 200, {
        ok: true,
        ...result,
        elapsedMs: Math.round(performance.now() - start),
      });
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  }

  if (req.method === "GET" && urlPath === "/api/documents") {
    return json(res, 200, { documents: listDocuments() });
  }

  if (req.method === "POST" && urlPath === "/api/documents/upload") {
    const name = decodeURIComponent(req.headers["x-filename"] || "").trim();
    if (!name) return json(res, 400, { error: "Nom de fichier manquant." });

    const ext = path.extname(name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      return json(res, 400, {
        error: `Format non supporté (${ext || "inconnu"}). Formats acceptés : ${SUPPORTED_EXTENSIONS.join(", ")}`,
      });
    }

    let buffer;
    try {
      buffer = await readRawBody(req);
    } catch (error) {
      return json(res, 413, { error: error.message });
    }
    if (buffer.length === 0) return json(res, 400, { error: "Fichier vide." });

    const target = safeJoinData(name);
    if (!target) return json(res, 400, { error: "Chemin invalide." });

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buffer);
    return json(res, 200, { ok: true, name, size: buffer.length });
  }

  if (req.method === "DELETE" && urlPath.startsWith("/api/documents/")) {
    const name = decodeURIComponent(urlPath.replace("/api/documents/", ""));
    const target = safeJoinData(name);
    if (!target || !fs.existsSync(target)) {
      return json(res, 404, { error: "Fichier introuvable." });
    }
    fs.rmSync(target, { force: true });
    return json(res, 200, { ok: true, name });
  }

  if (req.method === "POST" && urlPath === "/api/ingest") {
    try {
      const result = await reindex();
      return json(res, 200, { ok: true, ...result });
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  }

  if (req.method === "POST" && urlPath === "/api/chart") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
    const question = (body.question || "").trim();
    const intent = detectChartIntent(question);
    const type = body.type || (intent.wanted ? intent.type : undefined);
    const chart = buildChart(question, type);
    if (!chart.ok) return json(res, 404, { error: chart.error });
    return json(res, 200, { ok: true, spec: chart.spec });
  }

  if (req.method === "POST" && urlPath === "/api/chat") {
    try {
      await handleChat(req, res);
    } catch (error) {
      if (!res.headersSent) json(res, 500, { error: error.message });
      else res.end();
    }
    return;
  }

  return json(res, 404, { error: "Route inconnue." });
}

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split("?")[0];

  if (urlPath.startsWith("/api/")) {
    try {
      await handleApi(req, res, urlPath);
    } catch (error) {
      if (!res.headersSent) json(res, 500, { error: error.message });
    }
    return;
  }

  if (urlPath.startsWith("/doc/")) {
    const name = decodeURIComponent(urlPath.replace("/doc/", ""));
    const { status, html } = renderDocumentPage(name);
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (urlPath.startsWith("/raw/")) {
    const name = decodeURIComponent(urlPath.replace("/raw/", ""));
    const target = safeJoinData(name);
    if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.writeHead(404);
      res.end("Introuvable");
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(target).pipe(res);
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, "127.0.0.1", async () => {
  console.log(`\n  ${MODEL_NAME} — chat`);
  console.log(`  http://127.0.0.1:${PORT}\n`);
  console.log(
    `  Index  : ${index ? `${index.docs.length} passages en mémoire` : "aucun"}`,
  );
  console.log(`  Données: ${DATA_DIR}`);

  try {
    const info = await listAllModels();
    const local = info.local.filter((m) => m.downloaded).map((m) => m.label);
    console.log(
      `  Local  : ${local.length ? local.join(", ") : "aucun (npm run model:download)"}`,
    );
    if (info.remoteStatus.reachable) {
      console.log(
        `  Distant: ${info.remote.map((m) => m.label).join(", ") || "connecté, aucun modèle"} (${info.config.remote.url})`,
      );
    } else {
      console.log(`  Distant: non joignable (${info.config.remote.url})`);
    }
  } catch {
    console.log(`  Modèles: état indisponible`);
  }
  console.log("");
});
