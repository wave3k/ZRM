import { CHUNK_SIZE, CHUNK_OVERLAP } from "../config.js";

const RECORD_KINDS = new Set(["sqlite", "csv"]);
const RECORDS_PER_CHUNK = 3;

function splitSentences(text) {
  return text
    .split(/(?<=[.!?;:])\s+|\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function chunkRecords(text, source, kind) {
  const records = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const chunks = [];
  for (let i = 0; i < records.length; i += RECORDS_PER_CHUNK) {
    const group = records.slice(i, i + RECORDS_PER_CHUNK);
    chunks.push({ source, kind, text: group.join("\n") });
  }
  return chunks;
}

export function chunkText(text, { source, kind }) {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  if (RECORD_KINDS.has(kind) && clean.includes("\n")) {
    const recordChunks = chunkRecords(clean, source, kind);
    if (recordChunks.length > 1) return recordChunks;
  }

  if (clean.length <= CHUNK_SIZE) {
    return [{ source, kind, text: clean }];
  }

  const chunks = [];
  const paragraphs = clean.split(/\n{2,}/);

  let current = "";
  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push({ source, kind, text: trimmed });
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_SIZE) {
      flush();
      const sentences = splitSentences(paragraph);
      for (const sentence of sentences) {
        if ((current + " " + sentence).length > CHUNK_SIZE && current) {
          chunks.push({ source, kind, text: current.trim() });
          const tail = current.slice(-CHUNK_OVERLAP);
          current = tail + " " + sentence;
        } else {
          current += (current ? " " : "") + sentence;
        }
      }
      flush();
      continue;
    }

    if ((current + "\n\n" + paragraph).length > CHUNK_SIZE && current) {
      flush();
      const tail = chunks.length
        ? chunks[chunks.length - 1].text.slice(-CHUNK_OVERLAP)
        : "";
      current = tail + "\n\n" + paragraph;
    } else {
      current += (current ? "\n\n" : "") + paragraph;
    }
  }

  flush();
  return chunks;
}
