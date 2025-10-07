import fs from 'fs';
import path from 'path';

// Patient name + DOB detectors used by the rules engine

const CONFIG_PATH = path.join(process.cwd(), 'backend', 'rules', 'data', 'patient_config.json');

const DEFAULT_ADDRESS_STOP = [
  'road','rd','street','st','suite','ste','ave','avenue','blvd','drive','dr','court','ct','lane','ln',
  'circle','cir','parkway','pkwy','apt','apartment','unit','floor','fl','highway','hwy','way','terrace','ter',
  'place','pl','north','south','east','west','n','s','e','w','city','state','zip','address','phone','fax'
];

const DEFAULT_NON_PERSON_TOKENS_STRICT = [
  'fax','efax','referral','order','orders','summary','information','info','patient','provider','practice','clinic','medical','medicine','services','service','sleep','home','unknown','report','reports','signature','signed','physician','doctor','md','do','pa','np','rn','llc','inc','corp','company','group','center','centre','hospital','imaging','lab','laboratory','department','specialty','care','health','insurance','authorization','auth','request','requests','from','to','re','attention','attn','unit','units','npi','id','member','policy','patientinformation','patientinfo'
];

const DEFAULT_NON_PERSON_TOKENS_SOFT = [
  'support','team','office','forward','forwarding','review','reviews','documentation','disease','white','front','system','sleepcenter','dme','durable','equipment','schedule','appointment','appt','visit','pages','page','cover','sheet','notification','homecare','careteam'
];

const DEFAULT_NON_PERSON_LINE_PATTERNS = [
  'fax','efax','referral','order','clinic','medical','services','sleep','home','information','summary','patient information','patient summary',
  'provider','insurance','authorization','request','signature','physician','doctor','practice','department','center','hospital','imaging',
  'lab','laboratory','durable','equipment','dme','specialty','unknown','vegas','nv','pages','cover sheet','attention','attn','subject','re:','from:'
];

let cachedConfig = null;
let cachedConfigMTime = null;

function loadConfig() {
  try {
    const stat = fs.statSync(CONFIG_PATH);
    const mtime = stat.mtimeMs;
    if (cachedConfig && cachedConfigMTime === mtime) return cachedConfig;
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    cachedConfig = JSON.parse(raw);
    cachedConfigMTime = mtime;
    return cachedConfig;
  } catch {
    cachedConfig = null;
    cachedConfigMTime = null;
    return null;
  }
}

function toStopSet(values, fallback) {
  const src = Array.isArray(values) ? values : fallback;
  return new Set((src || []).map(s => String(s).toLowerCase()));
}

function buildLineRegex(patterns, fallbackPatterns) {
  const src = Array.isArray(patterns) && patterns.length ? patterns : fallbackPatterns;
  if (!src || !src.length) return null;
  const escaped = src.map(p => String(p).trim()).filter(Boolean).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!escaped.length) return null;
  return new RegExp(`(${escaped.join('|')})`, 'i');
}

export function detectName(fullText, linesLCInput) {
  const payload = loadConfig() || {};
  const origLines = fullText.split(/\r?\n/);
  const linesLC = Array.isArray(linesLCInput)
    ? linesLCInput
    : origLines.map(l => String(l || '').toLowerCase());

  // Words that indicate addresses/context, not person names
  const addressStop = toStopSet(payload?.addressStop, DEFAULT_ADDRESS_STOP);
  const nonPersonTokensStrict = toStopSet(payload?.nonPersonTokensStrict ?? payload?.nonPersonTokens, DEFAULT_NON_PERSON_TOKENS_STRICT);
  const nonPersonTokensSoft = toStopSet(payload?.nonPersonTokensSoft, DEFAULT_NON_PERSON_TOKENS_SOFT);
  const nonPersonLineRe = buildLineRegex(payload?.nonPersonLineRegex, DEFAULT_NON_PERSON_LINE_PATTERNS);
  const strictBlockSet = new Set([...addressStop, ...nonPersonTokensStrict]);

  const hasAt = s => /@/.test(s || '');
  const stripAfterDob = s => String(s || '').replace(/\b(0[1-9]|1[0-2])[\/-](0[1-9]|[12]\d|3[01])[\/-]((?:19|20)\d{2})\b.*$/, '').trim();

  function isPlausibleNameToken(token) {
    if (!token) return false;
    const plain = String(token).replace(/[^A-Za-z\p{L}]/gu, '');
    if (plain.length < 2) return false;
    if (/^[A-Za-z]\.?$/.test(plain)) return false;
    if (plain.length > 2 && !/[aeiouy]/i.test(plain)) return false;
    return true;
  }

  // Allow unicode letters, apostrophes, hyphens
  const nameToken = "[A-Za-z\\p{L}'’\\-]+";
  const reLastFirst = new RegExp(`\\b(${nameToken})\\s*,\\s*(${nameToken})(?:\\s+(${nameToken}))?\\b`, 'u');
  const reFirstLast = new RegExp(`\\b(${nameToken})\\s+(${nameToken})(?:\\s+(${nameToken}))?\\b`, 'u');

  function looksLikeNameCandidate(text) {
    if (!text) return false;
    if (hasAt(text)) return false;
    const tokens = text
      .replace(/[^A-Za-z\p{L}'’\- ]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length < 2 || tokens.length > 4) return false;
    const lowerTokens = tokens.map(t => t.toLowerCase());
    let hasNameish = false;
    for (let i = 0; i < tokens.length; i++) {
      const lower = lowerTokens[i];
      if (strictBlockSet.has(lower)) continue;
      if (!nonPersonTokensSoft.has(lower)) {
        hasNameish = true;
        break;
      }
      const token = tokens[i];
      if (token.length > 2 && token[0] === token[0].toUpperCase()) {
        hasNameish = true;
        break;
      }
    }
    if (!hasNameish) return false;
    if (nonPersonLineRe && nonPersonLineRe.test(text)) return false;
    return true;
  }

  function tc(s) {
    return String(s || '').toLowerCase().replace(/\b([a-z\p{Ll}])/gu, (_, c) => c.toUpperCase());
  }

  function assembleName(m, order) {
    const a = m[1], b = m[2];
    const last = order === 'lf' ? a : b;
    const first = order === 'lf' ? b : a;
    const lastLc = last.toLowerCase();
    const firstLc = first.toLowerCase();
    if (strictBlockSet.has(lastLc) || strictBlockSet.has(firstLc)) return null;
    const normLast = tc(last);
    const normFirst = tc(first);
    if (!isPlausibleNameToken(normLast) || !isPlausibleNameToken(normFirst)) return null;
    return { last: normLast, first: normFirst };
  }

  // 1) Labeled lines: “Patient Name:”, “Patient:”, “Name:”
  let idx = linesLC.findIndex(l => /(patient\s*name|patient|name)\s*[:\-]\s*/i.test(l));
  if (idx >= 0) {
    const lineOrig = origLines[idx] || '';
    const afterColon = lineOrig.split(/[:\-]/).slice(1).join(':').trim();
    const candidateLines = [afterColon, origLines[idx + 1] || ''].map(stripAfterDob).filter(Boolean);
    for (const cand of candidateLines) {
      if (!looksLikeNameCandidate(cand)) continue;
      let m = cand.match(reLastFirst);
      if (m) {
        const val = assembleName(m, 'lf');
        if (val) return { hit: true, value: val, why: 'patient_name_labeled_lf' };
      }
      m = cand.match(reFirstLast);
      if (m) {
        const val = assembleName(m, 'fl');
        if (val) return { hit: true, value: val, why: 'patient_name_labeled_fl' };
      }
    }
  }

  // 2) Separate First/Last labeled fields
  let firstVal = null, lastVal = null;
  for (let i = 0; i < linesLC.length && i < 80; i++) {
    const o = origLines[i] || '';
    if (!firstVal) {
      const m1 = o.match(new RegExp(`first\\s*name\\s*[:\\-]?\\s*(${nameToken})(?:\\s+(${nameToken}))?`, 'iu'));
      const lookNext = !m1 && /first\s*name\s*[:\-]?\s*$/i.test(o);
      const src = m1 ? m1[1] : (lookNext ? (origLines[i + 1] || '') : '');
      if (src && looksLikeNameCandidate(src)) firstVal = tc(src.split(/\s+/)[0]);
    }
    if (!lastVal) {
      const m2 = o.match(new RegExp(`last\\s*name\\s*[:\\-]?\\s*(${nameToken})`, 'iu'));
      const lookNext = !m2 && /last\s*name\s*[:\-]?\s*$/i.test(o);
      const src = m2 ? m2[1] : (lookNext ? (origLines[i + 1] || '') : '');
      if (src && looksLikeNameCandidate(src)) lastVal = tc(src.split(/\s+/)[0]);
    }
    if (firstVal && lastVal) return { hit: true, value: { first: firstVal, last: lastVal }, why: 'patient_name_fields' };
  }

  // 3) Fallback: scan first ~40 lines
  const scanOrig = origLines.slice(0, Math.min(40, origLines.length));
  for (let i = 0; i < scanOrig.length; i++) {
    const originalLine = scanOrig[i] || '';
    if (nonPersonLineRe && nonPersonLineRe.test(originalLine)) continue;
    const line = stripAfterDob(originalLine);
    if (!looksLikeNameCandidate(line)) continue;
    let m = line.match(reLastFirst);
    if (m) {
      const val = assembleName(m, 'lf');
      if (val) return { hit: true, value: val, why: 'patient_name_fallback_lf' };
    }
    m = line.match(reFirstLast);
    if (m) {
      const val = assembleName(m, 'fl');
      if (val) return { hit: true, value: val, why: 'patient_name_fallback_fl' };
    }
  }

  return { hit: false, why: 'name_none' };
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
