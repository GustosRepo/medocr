// Date normalization utility: extracts labeled order/referral/service/study dates
// Returns array of { type, value (YYYY-MM-DD), raw, confidence }

function toISO(mdY) {
  if (!mdY) return null;
  const sep = mdY.includes('/') ? '/' : '-';
  const parts = mdY.split(sep).map(p => p.trim());
  if (parts.length !== 3) return null;
  let [m, d, y] = parts;
  if (y.length === 2) {
    const yearNum = parseInt(y, 10);
    y = yearNum >= 70 ? '19' + y : '20' + y;
  }
  const mi = parseInt(m, 10), di = parseInt(d, 10), yi = parseInt(y, 10);
  if (!(mi >=1 && mi <=12 && di>=1 && di<=31 && yi>1900 && yi<2100)) return null;
  return `${yi.toString().padStart(4,'0')}-${mi.toString().padStart(2,'0')}-${di.toString().padStart(2,'0')}`;
}

export function detectDates(fullText) {
  const text = fullText || '';
  const lines = text.split(/\n/);
  const results = [];
  const seen = new Set();
  const labelPatterns = [
    { type: 'referral', re: /(referral|refer)\s*(?:date)?\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i },
    { type: 'order', re: /(order|ordered)\s*(?:date)?\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i },
    { type: 'service', re: /(service|svc)\s*(?:date)?\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i },
    { type: 'study', re: /(study|appt|appointment)\s*(?:date|scheduled)?\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i }
  ];
  for (const line of lines) {
    for (const lp of labelPatterns) {
      const m = line.match(lp.re);
      if (m) {
        const iso = toISO(m[2]);
        if (iso && !seen.has(lp.type+iso)) {
          seen.add(lp.type+iso);
            results.push({ type: lp.type, value: iso, raw: m[2], confidence: 'high' });
        }
      }
    }
    // Unlabeled standalone date (fallback)
    const unlabeled = line.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/g);
    if (unlabeled) {
      for (const d of unlabeled) {
        const iso = toISO(d);
        if (!iso) continue;
        if (![...seen].some(k => k.endsWith(iso))) {
          seen.add('any'+iso);
          results.push({ type: 'unknown', value: iso, raw: d, confidence: 'low' });
        }
      }
    }
  }
  return results;
}
