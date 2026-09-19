function flatten(value, prefix, out) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => flatten(item, `${prefix}[${i}]`, out));
    return;
  }
  if (typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      flatten(val, prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }
  out.push(`${prefix}: ${value}`);
}

export function parseJson(buffer) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (!text) return "";

  if (text.startsWith("{")) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length > 1 && lines.every((l) => l.trim().startsWith("{"))) {
      return lines
        .map((line) => {
          try {
            const out = [];
            flatten(JSON.parse(line), "", out);
            return out.join(" | ");
          } catch {
            return line;
          }
        })
        .join("\n");
    }
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return text;
  }

  const out = [];
  if (Array.isArray(data)) {
    data.forEach((item, i) => {
      const parts = [];
      flatten(item, "", parts);
      out.push(`#${i} ${parts.join(" | ")}`);
    });
  } else {
    flatten(data, "", out);
  }
  return out.join("\n");
}
