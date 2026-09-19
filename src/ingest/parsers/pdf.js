let pdfParseModule = null;

async function loadPdfParse() {
  if (pdfParseModule) return pdfParseModule;
  const mod = await import("pdf-parse");
  pdfParseModule = mod.default || mod;
  return pdfParseModule;
}

export async function parsePdf(buffer) {
  try {
    const pdfParse = await loadPdfParse();
    const result = await pdfParse(buffer);
    return (result.text || "").replace(/\s+\n/g, "\n").trim();
  } catch (error) {
    throw new Error(`PDF illisible : ${error.message}`);
  }
}
