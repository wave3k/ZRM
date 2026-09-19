const MAX_CONTEXT_CHARS = 700;

export function buildContextBlock(results) {
  if (!results || results.length === 0) return "";
  const parts = [];
  let total = 0;

  for (const { doc } of results) {
    const entry = `[${doc.source}]\n${doc.text}`;
    if (total + entry.length > MAX_CONTEXT_CHARS) {
      const room = MAX_CONTEXT_CHARS - total;
      if (room > 200) parts.push(entry.slice(0, room));
      break;
    }
    parts.push(entry);
    total += entry.length;
  }

  return parts.join("\n\n---\n\n");
}
