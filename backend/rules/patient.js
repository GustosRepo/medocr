// Patient name + DOB detectors used by the rules engine

const BASIC_BLOCK_TOKENS = new Set([
  'patient','patients','provider','providers','clinic','clinics','hospital','sleep','study','studies','referral','referrals',
  'forwarding','support','team','fax','cover','sheet','page','paperwork','documentation','notes','summary','request','requests',
  'attention','veteran','veterans','home','homes','medical','company','specialty','order','orders','care','center','centers',
  'primary','office','insurance','practice','unit','department','services','service','authorization','auth','intake','contact'
]);

const BLOCK_LINE_PATTERNS = [
  'attention','veteran','sleep study','sleepcenter','sleep center','sleep studies','medical group','medical center','clinic',
  'fax','cover sheet','authorization','insurance','provider','practice','referral','order form','durable medical equipment',
  'home sleep','patient instructions','patient information','primary care','chart notes','specialty','company','summary','page'
];

function normalizePart(raw) {
  const base = String(raw || '').trim();
  if (!base) return '';
  const lower = base.toLowerCase();
  return lower.replace(/(^|[\s'\-])(\p{L})/gu, (_, prefix, char) => `${prefix}${char.toUpperCase()}`);
}

export function looksPlausibleName(raw) {
  const plain = String(raw || '').replace(/[^A-Za-z\p{L}]/gu, '');
  if (plain.length < 2) return false;
  if (/^[A-Za-z]\.?$/.test(plain)) return false;
  if (plain.length > 2 && BASIC_BLOCK_TOKENS.has(plain.toLowerCase())) return false;
  if (plain.length > 2 && !/[aeiouy]/i.test(plain)) return false;
  return true;
}

export function detectName(fullText, linesLCInput) {
  const origLines = fullText.split(/\r?\n/);
  const linesLC = Array.isArray(linesLCInput)
    ? linesLCInput
    : origLines.map(l => String(l || '').toLowerCase());

  const nameToken = "[A-Za-z\\p{L}'’\\-]+";
  const reLastFirst = new RegExp(`\\b(${nameToken})\\s*,\\s*(${nameToken})(?:\\s+(${nameToken}))?\\b`, 'u');
  const reFirstLast = new RegExp(`\\b(${nameToken})\\s+(${nameToken})(?:\\s+(${nameToken}))?\\b`, 'u');

  function buildResult(match, order) {
    const lastRaw = order === 'lf' ? match[1] : match[2];
    const firstRaw = order === 'lf' ? match[2] : match[1];
    const normLast = normalizePart(lastRaw);
    const normFirst = normalizePart(firstRaw);
    if (!looksPlausibleName(normLast) || !looksPlausibleName(normFirst)) return null;
    return { last: normLast, first: normFirst };
  }

  const labelRe = /(patient\s*name|patient|name)\s*[:\-]\s*(.*)$/i;

  // 1) Check for labeled lines first
  for (let i = 0; i < linesLC.length; i++) {
    if (!labelRe.test(linesLC[i] || '')) continue;
    const original = origLines[i] || '';
    const [, , after] = original.match(labelRe) || [];
    const candidates = [];
    if (after) candidates.push(after.trim());
    if (origLines[i + 1]) candidates.push(origLines[i + 1].trim());
    for (const cand of candidates) {
      if (!cand) continue;
      const lf = cand.match(reLastFirst);
      if (lf) {
        const val = buildResult(lf, 'lf');
        if (val) return { hit: true, value: val, why: 'patient_name_labeled_lf' };
      }
      const fl = cand.match(reFirstLast);
      if (fl) {
        const val = buildResult(fl, 'fl');
        if (val) return { hit: true, value: val, why: 'patient_name_labeled_fl' };
      }
    }
    break; // first labeled block wins
  }

  // 2) Fallback: scan the first few lines for the first match
  const scanLimit = Math.min(40, origLines.length);
  for (let i = 0; i < scanLimit; i++) {
    const line = origLines[i] || '';
    const lc = line.toLowerCase();
    if (BLOCK_LINE_PATTERNS.some(p => lc.includes(p))) continue;
    const lf = line.match(reLastFirst);
    if (lf) {
      const val = buildResult(lf, 'lf');
      if (val) return { hit: true, value: val, why: 'patient_name_fallback_lf' };
    }
    const fl = line.match(reFirstLast);
    if (fl) {
      const val = buildResult(fl, 'fl');
      if (val) return { hit: true, value: val, why: 'patient_name_fallback_fl' };
    }
  }

  return { hit: false, why: 'name_none' };
}

export function parseNameFromFilename(filename) {
  if (!filename) return null;
  const base = String(filename).split(/[\\/]/).pop();
  if (!base) return null;
  const withoutExt = base.replace(/\.[A-Za-z0-9]+$/i, '');
  const primary = withoutExt.split('_')[0] || withoutExt;
  const cleaned = primary.replace(/\s+/g, ' ').trim();
  const match = cleaned.match(/^([^,]+),\s*([^,]+)$/);
  if (!match) return null;
  const last = normalizePart(match[1]);
  const first = normalizePart(match[2]);
  if (!looksPlausibleName(last) || !looksPlausibleName(first)) return null;
  return { last, first };
}

export function detectDob(fullText) {
  const origLines = fullText.split(/\r?\n/);

  const dateRe = /\b(0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])[\/-]((?:19|20)\d{2})\b/;
  const dobLabelRe = /(dob|d\.\s*o\.\s*b\.|date\s*of\s*birth)\s*[:\-]?\s*(.*)$/i;
  const notDobContextRe = /(referral\s*date|order\s*date|date\s*of\s*service|dos\b|service\s*date|signed|signature|fax|scanned|printed|report\s*date|visit\s*date|appt|appointment|today|now)/i;

  const now = new Date();
  const currentYear = now.getFullYear();
  const pad2 = n => String(n).padStart(2, '0');
  const normalize = m => `${pad2(m[1])}/${pad2(m[2])}/${m[3]}`;

  const ageMatch = fullText.match(/\bage\s*[:\-]?\s*(\d{1,3})\b/i);
  const ageVal = ageMatch ? parseInt(ageMatch[1], 10) : null;

  function plausibleDob(y) {
    if (y > currentYear - 1) return false; // no future/this-year DOBs for adults
    if (y < 1900) return false;
    return true;
  }

  function scoreCandidate(lineIdx, m, whyBase) {
    const y = parseInt(m[3], 10);
    if (!plausibleDob(y)) return { score: -Infinity };
    let score = Math.max(0, 20 - lineIdx); // nearer top preferred
    if (ageVal != null) {
      const approx = currentYear - y;
      const delta = Math.abs(approx - ageVal);
      if (delta <= 2) score += 5;
      else if (delta <= 5) score += 2;
      else score -= 4;
    }
    return { score, value: normalize(m), why: whyBase };
  }

  // 1) Labeled same-line or next-line
  for (let i = 0; i < origLines.length && i < 120; i++) {
    const line = origLines[i] || '';
    const label = line.match(dobLabelRe);
    if (label) {
      const after = label[2] || '';
      const mSame = after.match(dateRe);
      if (mSame) {
        const s = scoreCandidate(i, mSame, 'dob_labeled_same_line');
        if (s.score > -Infinity) return { hit: true, value: s.value, why: s.why };
      }
      for (let j = 1; j <= 2 && i + j < origLines.length; j++) {
        const next = origLines[i + j] || '';
        const mNext = next.match(dateRe);
        if (mNext) {
          const s = scoreCandidate(i + j, mNext, 'dob_labeled_next_line');
          if (s.score > -Infinity) return { hit: true, value: s.value, why: s.why };
        }
      }
    }
  }

  // 2) Context-filtered scan
  let best = { score: -Infinity, value: null, why: null };
  for (let i = 0; i < origLines.length && i < 200; i++) {
    const line = origLines[i] || '';
    if (notDobContextRe.test(line)) continue;
    const m = line.match(dateRe);
    if (!m) continue;
    const s = scoreCandidate(i, m, 'dob_context_scan');
    if (s.score > best.score) best = s;
  }
  if (best.score > -Infinity) return { hit: true, value: best.value, why: best.why };

  // 3) Fallback
  for (let i = 0; i < origLines.length; i++) {
    const m = (origLines[i] || '').match(dateRe);
    if (m && plausibleDob(parseInt(m[3], 10))) {
      return { hit: true, value: normalize(m), why: 'dob_fallback' };
    }
  }

  return { hit: false, why: 'dob_none' };
}

// Detect patient phone numbers (US 10-digit) and return formatted variants
export function detectPhones(fullText) {
  const text = String(fullText || '');
  const re = /\b(?:\+?1[\s\-\.()]*)?(?:\(?\d{3}\)?[\s\-\.]*)\d{3}[\s\-\.]*\d{4}\b/g;
  const seen = new Set();
  const rawPhones = [];
  const lines = text.split(/\r?\n/);
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))) {
      const core = digits.length === 11 ? digits.slice(1) : digits;
      if (!seen.has(core)) {
        seen.add(core);
        const formatted = `(${core.slice(0,3)}) ${core.slice(3,6)}-${core.slice(6)}`;
        // Determine line for exclusion heuristics
        let lineIdx = -1; let acc = 0;
        for (let i=0;i<lines.length;i++) { acc += lines[i].length + 1; if (acc > m.index) { lineIdx = i; break; } }
        const lineText = lines[lineIdx] || '';
        const providerLine = /(provider|referring|physician|npi)/i.test(lineText);
        rawPhones.push({ raw, normalized: core, formatted, index: m.index, lineIdx, providerLine });
      }
    }
  }
  if (!rawPhones.length) return { hit: false, value: [], why: 'patient_phones_none' };

  // Helper: classify & score phones
  const tollFree = new Set(['800','822','833','844','855','866','877','888','900']);
  function isValidNanp(core) {
    if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(core)) return false; // area & exchange cannot start with 0/1
    const ac = core.slice(0,3);
    if (tollFree.has(ac)) return false;
    return true;
  }
  // Build context windows
  function contextSnippet(idx) {
    const start = Math.max(0, idx - 40);
    return text.slice(start, idx + 40).toLowerCase();
  }

  // First pass: filter invalid / toll-free / fax labeled
  const filtered = rawPhones.filter(p => {
    if (!isValidNanp(p.normalized)) return false;
    const ctx = contextSnippet(p.index);
    if (/fax/.test(ctx)) return false;
    if (p.providerLine) return false; // exclude lines likely belonging to provider section
    return true;
  });
  if (!filtered.length) {
    // fall back to any raw that are at least 10 digits if we over-filtered
    return { hit: true, value: rawPhones, why: 'patient_phones_detect_raw_only' };
  }

  // Scoring
  const areaFreq = filtered.reduce((acc,p)=>{ const ac=p.normalized.slice(0,3); acc[ac]=(acc[ac]||0)+1; return acc; },{});
  function score(p) {
    const ctx = contextSnippet(p.index);
    let s = 0;
    if (/phone|tel|cell|mobile/.test(ctx)) s += 5;
    if (/patient/.test(ctx)) s += 3;
    if (/provider|office|clinic/.test(ctx)) s -= 2;
    if (/insurance|auth|authorization/.test(ctx)) s -= 2;
    const ac = p.normalized.slice(0,3);
    s += (areaFreq[ac] || 0); // boost dominant area code cluster
    return s;
  }
  filtered.forEach(p => { p._score = score(p); });
  filtered.sort((a,b) => b._score - a._score);

  // Prefer dominant area code subset (likely patient locale)
  const dominantArea = Object.entries(areaFreq).sort((a,b)=>b[1]-a[1])[0][0];
  const dominant = filtered.filter(p => p.normalized.startsWith(dominantArea));
  const curated = (dominant.length ? dominant : filtered).slice(0, 3); // cap to 3 to avoid noise

  return { hit: curated.length > 0, value: curated, why: 'patient_phones_detect' };
}
