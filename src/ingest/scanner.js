import fs from "fs";
import path from "path";
import { DATA_DIR, SUPPORTED_EXTENSIONS, MAX_FILE_BYTES } from "../config.js";
import { parseText } from "./parsers/text.js";
import { parseJson } from "./parsers/json.js";
import { parseCsv } from "./parsers/csv.js";
import { parsePdf } from "./parsers/pdf.js";
import { parseSqlite } from "./parsers/sqlite.js";
import { chunkText } from "./chunker.js";

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      out.push(...walk(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function classify(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) return null;
  if (ext === ".jsonl") return { parser: "json", kind: "json" };
  if (ext === ".json") return { parser: "json", kind: "json" };
  if (ext === ".csv") return { parser: "csv", kind: "csv", delimiter: "," };
  if (ext === ".tsv") return { parser: "csv", kind: "csv", delimiter: "\t" };
  if (ext === ".pdf") return { parser: "pdf", kind: "pdf" };
  if (ext === ".sqlite" || ext === ".sqlite3" || ext === ".db")
    return { parser: "sqlite", kind: "sqlite" };
  return { parser: "text", kind: "text" };
}

async function extractText(filePath, info) {
  switch (info.parser) {
    case "json":
      return parseJson(fs.readFileSync(filePath));
    case "csv":
      return parseCsv(fs.readFileSync(filePath), info.delimiter);
    case "pdf":
      return await parsePdf(fs.readFileSync(filePath));
    case "sqlite":
      return parseSqlite(filePath);
    default:
      return parseText(fs.readFileSync(filePath));
  }
}

export async function scanDataDir(dataDir = DATA_DIR, { onFile } = {}) {
  if (!fs.existsSync(dataDir)) {
    return { chunks: [], files: 0, skipped: [] };
  }

  const files = walk(dataDir);
  const chunks = [];
  const skipped = [];
  let indexed = 0;

  for (const filePath of files) {
    const info = classify(filePath);
    if (!info) {
      skipped.push({ file: filePath, reason: "extension non supportee" });
      continue;
    }

    const rel = path.relative(dataDir, filePath).split(path.sep).join("/");

    try {
      const stats = fs.statSync(filePath);
      if (stats.size > MAX_FILE_BYTES) {
        skipped.push({ file: rel, reason: "fichier trop volumineux (>25Mo)" });
        continue;
      }
      if (stats.size === 0 && info.parser !== "sqlite") {
        skipped.push({ file: rel, reason: "fichier vide" });
        continue;
      }

      const text = await extractText(filePath, info);
      if (!text || !text.trim()) {
        skipped.push({ file: rel, reason: "aucun texte extrait" });
        continue;
      }

      const fileChunks = chunkText(text, { source: rel, kind: info.kind });
      chunks.push(...fileChunks);
      indexed++;
      if (onFile) onFile(rel, fileChunks.length);
    } catch (error) {
      skipped.push({ file: rel, reason: error.message });
    }
  }

  return { chunks, files: indexed, skipped };
}
