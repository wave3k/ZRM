import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR } from "./config.js";

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function renderTable(headers, rows, { maxRows = 500 } = {}) {
  const shown = rows.slice(0, maxRows);
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body = shown
    .map(
      (r) =>
        `<tr>${headers
          .map((_, i) => `<td>${escapeHtml(r[i] ?? "")}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  const note =
    rows.length > maxRows
      ? `<p class="note">${rows.length - maxRows} ligne(s) supplémentaire(s) non affichée(s).</p>`
      : "";
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${note}`;
}

function renderCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const delimiter = filePath.toLowerCase().endsWith(".tsv") ? "\t" : text.includes(";") && !text.includes(",") ? ";" : ",";
  const rows = parseDelimited(text, delimiter);
  if (rows.length === 0) return "<p>Aucune donnée.</p>";
  const headers = rows[0].map((h) => h.trim());
  return renderTable(headers, rows.slice(1));
}

function renderSqlite(filePath) {
  let db;
  try {
    db = new DatabaseSync(filePath, { readOnly: true });
  } catch (error) {
    return `<p class="error">Base illisible : ${escapeHtml(error.message)}</p>`;
  }
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all();
    if (tables.length === 0) return "<p>Aucune table.</p>";

    return tables
      .map(({ name }) => {
        let rows;
        try {
          rows = db.prepare(`SELECT * FROM "${name}" LIMIT 500`).all();
        } catch {
          return `<h2>${escapeHtml(name)}</h2><p class="error">Lecture impossible.</p>`;
        }
        if (rows.length === 0) {
          return `<h2>${escapeHtml(name)}</h2><p>Table vide.</p>`;
        }
        const headers = Object.keys(rows[0]);
        const body = rows.map((r) => headers.map((h) => r[h]));
        const count = db.prepare(`SELECT COUNT(*) as c FROM "${name}"`).get().c;
        return `<h2>${escapeHtml(name)} <span class="count">${count} ligne(s)</span></h2>${renderTable(headers, body)}`;
      })
      .join("");
  } finally {
    db.close();
  }
}

function renderJson(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  try {
    const data = JSON.parse(text);
    return `<pre class="code">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  } catch {
    return `<pre class="code">${escapeHtml(text)}</pre>`;
  }
}

function renderMarkdown(text) {
  let html = escapeHtml(text);
  html = html
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>")
    .replace(/\n{2,}/g, "</p><p>");
  return `<div class="markdown"><p>${html}</p></div>`;
}

function renderText(filePath, ext) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  if (ext === ".md" || ext === ".markdown") return renderMarkdown(text);
  if (ext === ".json" || ext === ".jsonl") return renderJson(filePath);
  return `<pre class="code">${escapeHtml(text)}</pre>`;
}

export function renderDocumentPage(relName) {
  const safe = relName.replace(/\\/g, "/").replace(/\.\./g, "");
  const full = path.resolve(DATA_DIR, safe);
  if (!full.startsWith(path.resolve(DATA_DIR)) || !fs.existsSync(full)) {
    return { status: 404, html: "<h1>Document introuvable</h1>" };
  }

  const stats = fs.statSync(full);
  const ext = path.extname(full).toLowerCase();
  const baseName = path.basename(full);

  let body;
  if (ext === ".csv" || ext === ".tsv") body = renderCsv(full);
  else if (ext === ".sqlite" || ext === ".sqlite3" || ext === ".db") body = renderSqlite(full);
  else if (ext === ".pdf") {
    body = `<iframe class="pdf" src="/raw/${encodeURIComponent(safe)}" title="PDF"></iframe>`;
  } else body = renderText(full, ext);

  const downloadUrl = `/raw/${encodeURIComponent(safe)}`;

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(baseName)} — ZRM</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{--bg:#0f1012;--bg-elev:#1b1d22;--line:#2a2d34;--text:#ececf1;--dim:#a9adb8;--faint:#6f7480;--accent:#4f7cf7}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif;font-size:15px;line-height:1.6}
  header{position:sticky;top:0;z-index:10;background:rgba(15,16,18,.9);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);padding:14px 24px;display:flex;align-items:center;gap:14px}
  .logo{width:26px;height:26px;display:grid;place-items:center;background:var(--accent);color:#fff;border-radius:8px;font-weight:700;font-size:14px;text-decoration:none}
  .name{font-weight:600;font-size:15px;word-break:break-all}
  .meta{color:var(--faint);font-size:12.5px;margin-left:auto;white-space:nowrap}
  .btn{color:var(--dim);text-decoration:none;border:1px solid var(--line);padding:6px 13px;border-radius:9px;font-size:13px}
  .btn:hover{border-color:var(--accent);color:var(--text)}
  main{max-width:1100px;margin:0 auto;padding:28px 24px 80px}
  h1{font-size:22px;margin:0 0 6px}
  h2{font-size:16px;margin:26px 0 10px;display:flex;align-items:center;gap:10px}
  .count{font-size:12px;color:var(--faint);font-weight:400}
  .table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px}
  table{border-collapse:collapse;width:100%;font-size:13.5px}
  th,td{padding:9px 13px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
  th{background:var(--bg-elev);color:var(--dim);font-weight:600;position:sticky;top:0}
  tr:last-child td{border-bottom:none}
  tbody tr:hover{background:rgba(79,124,247,.05)}
  .code{background:var(--bg-elev);border:1px solid var(--line);border-radius:12px;padding:18px;overflow-x:auto;font-family:ui-monospace,Consolas,monospace;font-size:13px;line-height:1.65;color:#d7dae2}
  .pdf{width:100%;height:78vh;border:1px solid var(--line);border-radius:12px;background:#fff}
  .markdown h1,.markdown h2,.markdown h3{margin-top:22px}
  .markdown code{background:var(--bg-elev);padding:2px 6px;border-radius:5px;font-size:.9em}
  .markdown li{margin-bottom:5px}
  .note,.error{color:var(--faint);font-size:13px}
  .error{color:#ffb3b3}
</style>
</head>
<body>
<header>
  <a class="logo" href="/">Z</a>
  <span class="name">${escapeHtml(safe)}</span>
  <span class="meta">${formatSize(stats.size)} · ${escapeHtml(ext.replace(".", "").toUpperCase() || "FICHIER")}</span>
  <a class="btn" href="${downloadUrl}" download>Télécharger</a>
  <a class="btn" href="/">← Retour au chat</a>
</header>
<main>${body}</main>
</body>
</html>`;

  return { status: 200, html };
}
