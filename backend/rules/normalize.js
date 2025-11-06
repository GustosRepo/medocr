// Heuristics to tag high-level sections to reduce "page 1 bias" in late fusion.
// cover: fax coversheets, disclaimers, headers
// demographics: Facesheet or Demographics sections (usually contain patient truth)
// provider: ordering/referring provider blocks
export function tagSection(line) {
  const raw = String(line || '');
  const lc = raw.toLowerCase().trim();
  if (!lc) return null;
  // Cover sheet and fax disclaimers
  if (/^(fax|cover\s*sheet)\b/.test(lc) || /(confidential|unauthorized|disclosure|recipient|destroy)/.test(lc)) {
    return 'cover';
  }
  // Facesheet / Demographics tend to host patient name/DOB/phones on later pages
  if (/^(facesheet|face\s*sheet|demographics)\b/.test(lc)) {
    return 'demographics';
  }
  // Provider/Physician/NPI headers
  if (/(ordering\s*(provider|physician)|referring\s*(provider|physician)|\bnpi\b|provider\s*name)/.test(lc)) {
    return 'provider';
  }
  return null;
}

export function normalizePages(ocrPages = []) {
  const pages = (ocrPages || []).map(p => ({
    page: p.page,
    text: String(p.text || '').replace(/\u00A0/g, ' ').replace(/[ \t]+/g, ' ').trim()
  }));
  
  // Build structured lines with section tags and page/line indices
  const lines = [];
  for (const p of pages) {
    const perPage = (p.text || '').split(/\r?\n/);
    for (let i = 0; i < perPage.length; i++) {
      const text = perPage[i];
      lines.push({
        text,
        textLC: String(text || '').toLowerCase(),
        sectionTag: tagSection(text),
        page: p.page,
        line: i
      });
    }
  }
  
  // Extract table cells from all pages
  const tableCells = [];
  for (const p of (ocrPages || [])) {
    if (Array.isArray(p.tables)) {
      for (const table of p.tables) {
        if (Array.isArray(table.cells)) {
          for (const cell of table.cells) {
            tableCells.push({
              r: cell.r,
              c: cell.c,
              text: String(cell.text || '').trim(),
              page: p.page
            });
          }
        }
      }
    }
  }
  
  const fullText = pages.map(p => p.text).join('\n');
  return { pages, fullText, lines, tableCells };
}
