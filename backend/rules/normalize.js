export function normalizePages(ocrPages = []) {
  const pages = (ocrPages || []).map(p => ({
    page: p.page,
    text: String(p.text || '').replace(/\u00A0/g, ' ').replace(/[ \t]+/g, ' ').trim()
  }));
  const fullText = pages.map(p => p.text).join('\n');
  const lines = fullText.toLowerCase().split(/\r?\n/);
  return { pages, fullText, lines };
}
