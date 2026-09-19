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

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      // ignore
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function parseCsv(buffer, delimiter) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const rows = parseDelimited(text, delimiter);
  if (rows.length === 0) return "";

  const header = rows[0].map((h) => h.trim());
  const out = [];

  for (let i = 1; i < rows.length; i++) {
    const parts = [];
    const cells = rows[i];
    for (let c = 0; c < cells.length; c++) {
      const col = header[c] || `col${c}`;
      const value = cells[c].trim();
      if (value) parts.push(`${col}: ${value}`);
    }
    if (parts.length > 0) out.push(parts.join(" | "));
  }
  return out.join("\n");
}
