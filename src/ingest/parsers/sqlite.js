import { DatabaseSync } from "node:sqlite";

function stringifyCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function parseSqlite(filePath) {
  let db;
  try {
    db = new DatabaseSync(filePath, { readOnly: true });
  } catch (error) {
    throw new Error(`Base SQLite illisible : ${error.message}`);
  }

  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all();

    const out = [];
    for (const { name } of tables) {
      let rows;
      try {
        rows = db.prepare(`SELECT * FROM "${name}" LIMIT 5000`).all();
      } catch {
        continue;
      }
      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0]);

      for (let i = 0; i < rows.length; i++) {
        const parts = [];
        for (const col of columns) {
          const value = stringifyCell(rows[i][col]).trim();
          if (value) parts.push(`${col}: ${value}`);
        }
        if (parts.length > 0)
          out.push(`[${name}] #${i + 1} ${parts.join(" | ")}`);
      }
    }
    return out.join("\n");
  } finally {
    db.close();
  }
}
