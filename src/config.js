import path from "path";
import os from "os";

export const DATA_DIR = path.resolve(process.cwd(), "data");
export const INDEX_DIR = path.resolve(process.cwd(), ".zrm");
export const INDEX_FILE = path.join(INDEX_DIR, "index.json");

export const SUPPORTED_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".jsonl",
  ".csv",
  ".tsv",
  ".log",
  ".pdf",
  ".sqlite",
  ".sqlite3",
  ".db",
];

export const CHUNK_SIZE = 900;
export const CHUNK_OVERLAP = 150;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const BM25_K1 = 1.5;
export const BM25_B = 0.75;
export const TOP_K = 6;
export const MIN_SCORE = 0.15;
export const EMBEDDING_MODEL = "Xenova/multilingual-e5-small";

export const MODEL_NAME = "ZRM Local RAG";
export const PREFIX = "⚡ ZRM › ";

export function isWindows() {
  return os.platform() === "win32";
}
