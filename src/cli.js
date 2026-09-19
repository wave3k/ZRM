#!/usr/bin/env node
import fs from "fs";
import * as p from "@clack/prompts";
import yocto from "yoctocolors";
import { DATA_DIR, MODEL_NAME, PREFIX, TOP_K, MIN_SCORE } from "./config.js";
import { scanDataDir } from "./ingest/scanner.js";
import { rebuildAndSave, loadIndex, indexStats } from "./index/store.js";
import { hybridSearch } from "./index/search.js";
import { extractQueryTerms } from "./index/tokenizer.js";
import { synthesize } from "./answer/synthesizer.js";
import { warmupEmbeddings } from "./index/embeddings.js";

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const remainingMs = Math.round(ms % 1000);
  if (totalSeconds < 1) return `${remainingMs}ms`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 1) return `${seconds}s ${remainingMs}ms`;
  return `${minutes}min ${seconds}s`;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    return true;
  }
  return false;
}

async function runIngest() {
  ensureDataDir();
  const s = p.spinner();
  s.start(yocto.dim("Préparation du moteur sémantique..."));
  await warmupEmbeddings();
  s.stop(yocto.green("✓ Moteur sémantique prêt."));

  const sIdx = p.spinner();
  sIdx.start(yocto.dim("Indexation de 'data/'..."));

  const start = performance.now();
  const { chunks, files, skipped } = await scanDataDir(DATA_DIR);
  sIdx.message = yocto.dim(`Calcul des vecteurs (${chunks.length} passages)...`);
  const index = await rebuildAndSave(chunks, { embeddings: true });
  const duration = formatDuration(performance.now() - start);

  sIdx.stop(
    yocto.green(
      `✓ Index construit : ${chunks.length} passages depuis ${files} fichier(s) (${duration})`,
    ),
  );

  if (skipped.length > 0) {
    const lines = skipped
      .slice(0, 8)
      .map((s) => `  • ${s.file} — ${s.reason}`)
      .join("\n");
    const more = skipped.length > 8 ? `\n  … +${skipped.length - 8} autre(s)` : "";
    p.note(yocto.yellow(lines + more), "Fichiers ignores");
  }

  return index;
}

function showStats(index) {
  const stats = indexStats(index);
  const kinds = Object.entries(stats.byKind)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  p.note(
    `${yocto.cyan("Passages indexés")} : ${stats.chunks}\n` +
      `${yocto.cyan("Documents")} : ${stats.documents}\n` +
      `${yocto.cyan("Termes uniques")} : ${stats.terms}\n` +
      `${yocto.cyan("Par type")} : ${kinds || "—"}\n` +
      `${yocto.cyan("Construit le")} : ${new Date(stats.builtAt).toLocaleString()}`,
    "Statistiques de l'index",
  );
}

function showSources(index) {
  const stats = indexStats(index);
  if (stats.sources.length === 0) {
    p.note(yocto.yellow("Aucune source indexée."), "Sources");
    return;
  }
  const lines = stats.sources
    .map(([source, count]) => `  • ${source} ${yocto.dim(`(${count} passages)`)}`)
    .join("\n");
  p.note(lines, `Sources (${stats.documents})`);
}

function showHelp() {
  p.note(
    `${yocto.magenta("/ingest")}     - (Re)indexer le dossier 'data/'\n` +
      `${yocto.magenta("/ask <q>")}   - Poser une question et y repondre\n` +
      `${yocto.magenta("/stats")}     - Statistiques de l'index\n` +
      `${yocto.magenta("/sources")}   - Lister les documents indexes\n` +
      `${yocto.magenta("/help")}      - Cette aide\n` +
      `${yocto.magenta("/quit")}      - Quitter`,
    "Commandes",
  );
}

async function answerQuestion(query, index) {
  const terms = extractQueryTerms(query);
  if (terms.length === 0) {
    p.note(yocto.yellow("Question trop vague, je n'ai aucun terme exploitable."), MODEL_NAME);
    return;
  }

  await warmupEmbeddings();
  const results = (await hybridSearch(index, terms, query, TOP_K)).filter(
    (r) => r.score >= MIN_SCORE,
  );
  const { answer, citations } = synthesize(query, results);

  p.note(answer, yocto.magenta(`${PREFIX}${MODEL_NAME}`));

  if (citations.length > 0) {
    const lines = citations.map((c) => `  • ${c}`).join("\n");
    p.note(yocto.dim(lines), "Sources");
  } else {
    p.note(yocto.dim("Aucune source directe — essaie /ingest pour rafraichir l'index."), "Sources");
  }
}

async function main() {
  const args = process.argv.slice(2);
  let index = loadIndex();

  if (args.includes("--ingest")) {
    index = await runIngest();
    return;
  }

  if (args.includes("--ask")) {
    const query = args.filter((a) => a !== "--ask").join(" ").trim();
    if (!query) {
      console.error(yocto.red("Usage: zrm --ask \"ta question\""));
      process.exit(1);
    }
    if (!index) index = await runIngest();
    await answerQuestion(query, index);
    return;
  }

  console.clear();
  p.intro(yocto.bgMagenta(yocto.black(`  ${MODEL_NAME} — CHAT SUR TES DONNEES  `)));

  const created = ensureDataDir();
  if (created) {
    p.note(
      `J'ai cree le dossier 'data/'. Depose-y tes fichiers (.txt, .md, .json, .csv, .pdf, .sqlite) puis lance ${yocto.magenta("/ingest")}.`,
      "Premiere utilisation",
    );
  }

  if (index) {
    const stats = indexStats(index);
    p.note(
      `${stats.chunks} passages, ${stats.documents} document(s) en memoire.`,
      "Index charge",
    );
  } else {
    p.note(
      `Aucun index trouve. Lance ${yocto.magenta("/ingest")} pour analyser 'data/'.`,
      "Pret",
    );
  }

  while (true) {
    const input = await p.text({
      message: yocto.cyan("Toi :"),
      placeholder: 'Pose une question, ou tape /ingest',
      validate(value) {
        if (!value.trim()) return "Parle.";
      },
    });

    if (p.isCancel(input)) {
      p.outro(yocto.yellow(`${MODEL_NAME} : A bientot.`));
      process.exit(0);
    }

    const inputStr = input.trim();

    if (inputStr.startsWith("/")) {
      const [cmd, ...rest] = inputStr.split(/\s+/);
      switch (cmd.toLowerCase()) {
        case "/help":
          showHelp();
          break;
        case "/quit":
          p.outro(yocto.yellow(`${MODEL_NAME} : A bientot.`));
          process.exit(0);
        case "/ingest":
          index = await runIngest();
          break;
        case "/stats":
          if (index) showStats(index);
          else p.note(yocto.yellow("Aucun index. Lance /ingest."), "Erreur");
          break;
        case "/sources":
          if (index) showSources(index);
          else p.note(yocto.yellow("Aucun index. Lance /ingest."), "Erreur");
          break;
        case "/ask": {
          const q = rest.join(" ").trim();
          if (!q) p.note(yocto.yellow("Usage : /ask ta question"), "Erreur");
          else if (!index) p.note(yocto.yellow("Aucun index. Lance /ingest."), "Erreur");
          else await answerQuestion(q, index);
          break;
        }
        default:
          p.note(yocto.red(`Commande inconnue '${cmd}'. Tape /help.`), "Erreur");
      }
      continue;
    }

    if (!index) {
      p.note(yocto.yellow("Aucun index. Lance /ingest d'abord."), "Erreur");
      continue;
    }

    const start = performance.now();
    await answerQuestion(inputStr, index);
    const duration = formatDuration(performance.now() - start);
    p.note(yocto.dim(`Repondu en ${duration}`), "Perf");
  }
}

main().catch((error) => {
  console.error(yocto.red(`Erreur fatale : ${error.message}`));
  process.exit(1);
});
