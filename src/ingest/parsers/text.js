export function parseText(buffer) {
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}
