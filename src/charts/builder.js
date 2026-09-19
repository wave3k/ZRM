import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR } from "../config.js";

const CHART_WORDS = [
  "graphique", "graph", "chart", "courbe", "diagramme", "histogramme",
  "camembert", "pie", "barres", "bars", "visualise", "visualiser", "plot",
];

const TYPE_HINTS = [
  { type: "pie", words: ["camembert", "pie", "répartition", "repartition", "part", "parts"] },
  { type: "line", words: ["courbe", "line", "évolution", "evolution", "tendance", "progression"] },
  { type: "bar", words: ["barres", "bars", "histogramme", "bar"] },
];

export function detectChartIntent(question) {
  const lower = question.toLowerCase();
  const wanted = CHART_WORDS.some((w) => lower.includes(w));
  if (!wanted) return { wanted: false };

  let type = "bar";
  for (const hint of TYPE_HINTS) {
    if (hint.words.some((w) => lower.includes(w))) {
      type = hint.type;
      break;
    }
  }
  return { wanted: true, type, question: lower };
}

function stripAccents(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function questionTerms(question) {
  return stripAccents(question.toLowerCase())
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((w) => w.length > 2) || [];
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const headers = lines[0].split(/[,;\t]/).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split(/[,;\t]/).map((c) => c.trim()));
  return { headers, rows };
}

function readSqlite(filePath) {
  const tables = [];
  let db;
  try {
    db = new DatabaseSync(filePath, { readOnly: true });
  } catch {
    return tables;
  }
  try {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all();
    for (const { name } of names) {
      let rows;
      try {
        rows = db.prepare(`SELECT * FROM "${name}" LIMIT 500`).all();
      } catch {
        continue;
      }
      if (rows.length === 0) continue;
      const headers = Object.keys(rows[0]);
      const body = rows.map((r) => headers.map((h) => r[h]));
      tables.push({ name, headers, rows: body });
    }
  } finally {
    db.close();
  }
  return tables;
}

function listDataFiles() {
  const out = [];
  if (!fs.existsSync(DATA_DIR)) return out;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(csv|tsv)$/i.test(entry.name)) out.push({ type: "csv", path: full, name: entry.name });
      else if (/\.(sqlite|sqlite3|db)$/i.test(entry.name)) out.push({ type: "sqlite", path: full, name: entry.name });
    }
  };
  walk(DATA_DIR);
  return out;
}

function scoreTable(table, terms, fileName) {
  const haystack = stripAccents(
    [fileName, table.name || "", ...(table.headers || [])].join(" ").toLowerCase(),
  );
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += 2;
    else if (haystack.includes(term.slice(0, 4))) score += 1;
  }
  return score;
}

function isNumericColumn(rows, index) {
  let numeric = 0;
  let total = 0;
  for (const row of rows) {
    const value = row[index];
    if (value === null || value === undefined || value === "") continue;
    total++;
    const cleaned = String(value).replace(/\s/g, "").replace(",", ".");
    if (!isNaN(Number(cleaned))) numeric++;
  }
  return total > 0 && numeric / total >= 0.7;
}

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/\s/g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}

function pickValueIndex(table, numericIndexes, terms) {
  let best = numericIndexes[0];
  let bestScore = -1;
  for (const i of numericIndexes) {
    const header = stripAccents(String(table.headers[i]).toLowerCase());
    let score = 0;
    for (const term of terms) {
      if (header === term) score += 5;
      else if (header.includes(term) || term.includes(header)) score += 3;
      else if (header.includes(term.slice(0, 4))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

export function buildChart(question, requestedType) {
  const terms = questionTerms(question);
  const files = listDataFiles();

  let best = null;

  for (const file of files) {
    let tables = [];
    if (file.type === "csv") {
      const parsed = parseCsv(fs.readFileSync(file.path, "utf8"));
      if (parsed) tables = [{ name: file.name, ...parsed }];
    } else {
      tables = readSqlite(file.path);
    }

    for (const table of tables) {
      const numericIndexes = table.headers
        .map((_, i) => i)
        .filter((i) => isNumericColumn(table.rows, i));
      if (numericIndexes.length === 0) continue;

      const score = scoreTable(table, terms, file.name) + (table.rows.length > 1 ? 1 : 0);
      if (!best || score > best.score) {
        best = { score, table, file, numericIndexes };
      }
    }
  }

  if (!best) {
    return {
      ok: false,
      error:
        "Aucune donnée numérique trouvée dans data/. Ajoute un CSV ou une base SQLite avec des colonnes chiffrées.",
    };
  }

  const { table, numericIndexes } = best;
  const labelIndex = table.headers.findIndex(
    (_, i) => !numericIndexes.includes(i),
  );
  const valueIndex = pickValueIndex(table, numericIndexes, terms);

  const rows = table.rows.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  const labels = rows.map((r) =>
    String(r[labelIndex >= 0 ? labelIndex : 0] ?? "").slice(0, 24),
  );
  const data = rows.map((r) => toNumber(r[valueIndex]));

  const type = requestedType && ["bar", "line", "pie"].includes(requestedType)
    ? requestedType
    : "bar";

  const limit = type === "pie" ? 8 : 20;
  const sliced = {
    labels: labels.slice(0, limit),
    data: data.slice(0, limit),
  };

  return {
    ok: true,
    spec: {
      type,
      title: `${table.headers[valueIndex]} — ${best.file.name}`,
      labels: sliced.labels,
      datasets: [{ label: table.headers[valueIndex], data: sliced.data }],
      source: best.file.name,
    },
  };
}
