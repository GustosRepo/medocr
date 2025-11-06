import { loadJsonConfig } from './utils/configLoader.js';
import { isHeaderLine, isNonPatientLine, isFaxLike, isFromHeaderLine, isLikelyProviderLine, isNonPersonToken, contextScore } from './context_guard.js';
import { pickBest } from './selectBest.js';

// Patient name + DOB detectors used by the rules engine

const DEFAULT_PHONE_GLYPH_ENTRIES = [
  // Common OCR substitutions for digits in phone numbers
  // Zero variants
  ['O', '0'], ['o', '0'], ['D', '0'], ['Q', '0'], ['Ø', '0'],
  // One variants  
  ['I', '1'], ['l', '1'], ['|', '1'], ['t', '1'], ['T', '1'], ['i', '1'],
  // Two variants
  ['Z', '2'], ['z', '2'],
  // Five variants
  ['S', '5'], ['s', '5'], ['§', '5'],
  // Six variants
  ['G', '6'], ['g', '6'], ['b', '6'],
  // Seven variants
  ['≤', '7'], ['∑', '7'],
  // Eight variants
  ['B', '8'],
  // Punctuation/noise to remove
  ['—', ''], ['–', ''], ['_', ''], ['‒', ''],
  ['◦', '0']
];

function buildPhoneGlyphMap() {
  const overrides = loadJsonConfig('pattern_overrides.json', { defaultFactory: () => ({}) }) || {};
  const overrideEntries = overrides && typeof overrides.phoneGlyphMap === 'object' && overrides.phoneGlyphMap
    ? Object.entries(overrides.phoneGlyphMap).map(([k, v]) => [String(k), String(v)])
    : [];
  return new Map([...DEFAULT_PHONE_GLYPH_ENTRIES, ...overrideEntries]);
}

function normalizePart(raw) {
  const base = String(raw || '').trim();
  if (!base) return '';
  const lower = base.toLowerCase();
  return lower.replace(/(^|[\s'\-])(\p{L})/gu, (_, prefix, char) => `${prefix}${char.toUpperCase()}`);
}

const DISCLAIMER_HINTS = /(fax|sensitive|confidential|destroy|unauthorized|disclosure|records|recipient|notify|error|intended)/i;

export function looksPlausibleName(raw) {
  const plain = String(raw || '').replace(/[^A-Za-z\p{L}]/gu, '');
  if (plain.length < 2) return false;
  if (/^[A-Za-z]\.?$/.test(plain)) return false;
  if (plain.length > 2 && isNonPersonToken(plain)) return false;
  if (plain.length > 2 && !/[aeiouy]/i.test(plain)) return false;
  return true;
}

function windowAround(structLines, idx, before = 2, after = 2) {
  const start = Math.max(0, idx - before);
  const end = Math.min(structLines.length, idx + after + 1);
  return structLines.slice(start, end).map(l => l.text).join(' \u2758 ');
}

export function detectName(fullText, structLinesInput) {
  const origLines = fullText.split(/\r?\n/);
  const structLines = Array.isArray(structLinesInput) && structLinesInput.length && typeof structLinesInput[0] === 'object'
    ? structLinesInput
    : origLines.map((t, i) => ({ text: t, textLC: String(t||'').toLowerCase(), sectionTag: null, page: 1, line: i }));

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

  const PATIENT_LABEL_RE = /(patient\s*(?:name)?|pt\s*name)\s*[:\-]\s*(.*)$/i;
  const GENERIC_NAME_LABEL_RE = /(name)\s*[:\-]\s*(.*)$/i;
  const NON_PATIENT_LABEL_HINTS = /(from|to|subject|company|facility|provider|attention|attn|fax|cc|re:|regarding)/i;

  const candidates = [];
  function extractFromLabeledLine(re, reason, requirePatient) {
    for (let i = 0; i < structLines.length; i++) {
      const line = structLines[i]?.text || '';
      const match = line.match(re);
      if (!match) continue;
      // Skip header/provider-like lines for generic labels
      if (!requirePatient && (isHeaderLine(line) || isNonPatientLine(line) || isLikelyProviderLine(line))) continue;
      const lowerLine = line.toLowerCase();
      if (requirePatient) {
        if (!/patient/.test(lowerLine) && !/pt/.test(lowerLine)) continue;
      } else if (NON_PATIENT_LABEL_HINTS.test(lowerLine)) {
        continue;
      }
      const after = match[2] || '';
      const candidatesArr = [];
      if (after) candidatesArr.push(after.trim());
      if (structLines[i + 1]?.text) candidatesArr.push(structLines[i + 1].text.trim());
      for (const cand of candidatesArr) {
        if (!cand) continue;
        if (isHeaderLine(cand) || isNonPatientLine(cand)) continue;
        if (DISCLAIMER_HINTS.test(cand)) continue;
        if (contextScore(cand).score >= 2) continue;
        const lf = cand.match(reLastFirst);
        if (lf) {
          const val = buildResult(lf, 'lf');
          if (val) {
            const ctx = windowAround(structLines, i, 2, 2);
            const baseScore = 10; // labeled lines are strong
            candidates.push({ value: val, page: structLines[i].page, line: structLines[i].line, score: baseScore, sectionTag: structLines[i].sectionTag, context: ctx });
          }
        }
        const fl = cand.match(reFirstLast);
        if (fl) {
          const val = buildResult(fl, 'fl');
          if (val) {
            const ctx = windowAround(structLines, i, 2, 2);
            const baseScore = 10;
            candidates.push({ value: val, page: structLines[i].page, line: structLines[i].line, score: baseScore, sectionTag: structLines[i].sectionTag, context: ctx });
          }
        }
      }
    }
    return null;
  }

  // 1) Prefer explicit patient-labeled lines
  extractFromLabeledLine(PATIENT_LABEL_RE, 'patient_label', true);

  // 2) Secondary pass for generic "Name:" lines (skip non-patient contexts)
  extractFromLabeledLine(GENERIC_NAME_LABEL_RE, 'generic_label', false);

  // 3) Fallback: scan the first few lines for the first match
  const scanLimit = Math.min(200, structLines.length);
  for (let i = 0; i < scanLimit; i++) {
    const line = structLines[i]?.text || '';
    const lc = line.toLowerCase();
    if (NON_PATIENT_LABEL_HINTS.test(lc)) continue;
    // Centralized header/non-patient guards
    if (isHeaderLine(line) || isNonPatientLine(line)) continue;
    if (DISCLAIMER_HINTS.test(line)) continue;
    if (contextScore(line).score >= 2) continue;
    const lf = line.match(reLastFirst);
    if (lf) {
      const val = buildResult(lf, 'lf');
      if (val) {
        const ctx = windowAround(structLines, i, 2, 2);
        const baseScore = Math.max(0, 20 - i); // earlier still helpful but not final
        candidates.push({ value: val, page: structLines[i].page, line: structLines[i].line, score: baseScore, sectionTag: structLines[i].sectionTag, context: ctx });
      }
    }
    const fl = line.match(reFirstLast);
    if (fl) {
      const val = buildResult(fl, 'fl');
      if (val) {
        const ctx = windowAround(structLines, i, 2, 2);
        const baseScore = Math.max(0, 20 - i);
        candidates.push({ value: val, page: structLines[i].page, line: structLines[i].line, score: baseScore, sectionTag: structLines[i].sectionTag, context: ctx });
      }
    }
  }
  const best = pickBest(candidates, 'patient_name');
  if (best) return { hit: true, value: best.value, why: 'name_select_best', candidates };
  return { hit: false, why: 'name_none', candidates };
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

export function detectDob(fullText, structLinesInput) {
  const origLines = fullText.split(/\r?\n/);
  const structLines = Array.isArray(structLinesInput) && structLinesInput.length && typeof structLinesInput[0] === 'object'
    ? structLinesInput
    : origLines.map((t, i) => ({ text: t, textLC: String(t||'').toLowerCase(), sectionTag: null, page: 1, line: i }));

  const DATE_SEP_CLASS = '[\\/\\-\\.\\,_\\s\\u2010-\\u2015\\u2212]';
  const dateRe = new RegExp(`\\b(0?[1-9]|1[0-2])${DATE_SEP_CLASS}*(0?[1-9]|[12]\\d|3[01])${DATE_SEP_CLASS}*(?:((?:19|20)\\d{2}))\\b`);
  const dobLabelRe = /(dob(?:\s*\/\s*age)?|d\.\s*o\.\s*b\.|date\s*of\s*birth)\s*[:\-]?\s*(.*)$/i;
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

  const candidates = [];
  // 1) Labeled same-line or next-line
  for (let i = 0; i < structLines.length && i < 240; i++) {
    const line = structLines[i]?.text || '';
    const label = line.match(dobLabelRe);
    if (label) {
      const after = label[2] || '';
      const mSame = after.match(dateRe);
      if (mSame) {
        const s = scoreCandidate(i, mSame, 'dob_labeled_same_line');
        if (s.score > -Infinity) {
          const ctx = windowAround(structLines, i, 2, 2);
          candidates.push({ value: s.value, page: structLines[i].page, line: structLines[i].line, score: s.score + 10, sectionTag: structLines[i].sectionTag, context: ctx });
        }
      }
      for (let j = 1; j <= 2 && i + j < origLines.length; j++) {
        const next = structLines[i + j]?.text || '';
        const mNext = next.match(dateRe);
        if (mNext) {
          const s = scoreCandidate(i + j, mNext, 'dob_labeled_next_line');
          if (s.score > -Infinity) {
            const ctx = windowAround(structLines, i + j, 2, 2);
            candidates.push({ value: s.value, page: structLines[i + j].page, line: structLines[i + j].line, score: s.score + 6, sectionTag: structLines[i + j].sectionTag, context: ctx });
          }
        }
      }
    }
  }

  // 2) Context-filtered scan
  for (let i = 0; i < structLines.length && i < 300; i++) {
    const line = structLines[i]?.text || '';
    if (notDobContextRe.test(line)) continue;
    if (isHeaderLine(line) || isNonPatientLine(line) || isLikelyProviderLine(line)) continue;
    const m = line.match(dateRe);
    if (!m) continue;
    const s = scoreCandidate(i, m, 'dob_context_scan');
    if (s.score > -Infinity) {
      const ctx = windowAround(structLines, i, 2, 2);
      candidates.push({ value: s.value, page: structLines[i].page, line: structLines[i].line, score: s.score, sectionTag: structLines[i].sectionTag, context: ctx });
    }
  }
  const bestDob = pickBest(candidates, 'dob');
  if (bestDob) return { hit: true, value: bestDob.value, why: 'dob_select_best', candidates };

  // 3) Fallback
  for (let i = 0; i < structLines.length; i++) {
    const m = (structLines[i]?.text || '').match(dateRe);
    if (m && plausibleDob(parseInt(m[3], 10))) {
      return { hit: true, value: normalize(m), why: 'dob_fallback', candidates };
    }
  }

  return { hit: false, why: 'dob_none', candidates };
}

// Detect patient phone numbers (US 10-digit) and return formatted variants
export function detectPhones(fullText, structLinesInput) {
  const text = String(fullText || '');
  const re = /\b(?:\+?1[\s\-\.()]*)?(?:\(?\d{3}\)?[\s\-\.]*)\d{3}[\s\-\.]*\d{4}\b/g;
  const seen = new Set();
  const rawPhones = [];
  const BLACKLIST = new Set(['7024638062','7024638368','7024363530']);
  const lines = text.split(/\r?\n/);
  const PHONE_GLYPH_MAP = buildPhoneGlyphMap();
  const events = [];
  function extractDigits(raw) {
    const out = [];
    for (const ch of raw) {
      if (/\d/.test(ch)) {
        out.push(ch);
      } else if (PHONE_GLYPH_MAP.has(ch)) {
        const mapped = PHONE_GLYPH_MAP.get(ch);
        if (mapped) out.push(mapped);
      }
    }
    return out.join('');
  }

  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const digits = extractDigits(raw);
    if (digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))) {
      const core = digits.length === 11 ? digits.slice(1) : digits;
      if (!seen.has(core)) {
        seen.add(core);
        const formatted = `(${core.slice(0,3)}) ${core.slice(3,6)}-${core.slice(6)}`;
        if (BLACKLIST.has(core)) continue;
        // Determine line for exclusion heuristics
        let lineIdx = -1; let acc = 0;
        for (let i=0;i<lines.length;i++) { acc += lines[i].length + 1; if (acc > m.index) { lineIdx = i; break; } }
        const lineText = lines[lineIdx] || '';
        const lineLower = lineText.toLowerCase();
        
        // Mark as provider line if clear provider context
        const providerLine = /(provider|referring|physician|npi|ordering|office|clinic)/i.test(lineText);
        const isPhoneLabel = /^\s*phone\s*:/i.test(lineLower);
        const hasOrderingContext = /ordering\s*(provider|physician)/i.test(lineText);
        
        const entry = { 
          raw, 
          normalized: core, 
          formatted, 
          index: m.index, 
          lineIdx, 
          providerLine,
          isPhoneLabel,
          hasOrderingContext
        };
        rawPhones.push(entry);
        events.push({ rule: 'patient_phone_detect_raw', value: formatted, lineIdx });
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
  function contextSnippet(idx, span = 40) {
    const start = Math.max(0, idx - span);
    return text.slice(start, idx + span).toLowerCase();
  }
  // Multi-line window around a given line index to capture nearby labels one or two lines away
  function lineWindow(lineIdx, before = 2, after = 2) {
    const start = Math.max(0, lineIdx - before);
    const end = Math.min(lines.length, lineIdx + after + 1);
    return lines.slice(start, end).join(' \u2758 ').toLowerCase();
  }

  // First pass: filter invalid / toll-free / fax / provider labeled (with reasons)
  const filtered = [];
  // Third-party business contexts we don't want as patient phones (pharmacy, labs, imaging)
  const THIRD_PARTY_BUSINESS_RE = /(pharmacy|walgreens|cvs|rite\s*aid|drug\s*store|drugstore|quest\s*diagnostics|labcorp|laboratory|preferred\s*lab|preferred\s*imaging|radiology|imaging|psc\b|interventional\s*radiology|medical\s*imaging|pueblo\s*medical\s*imaging)/i;
  for (const p of rawPhones) {
    const ctx = contextSnippet(p.index, 80); // slightly wider character context
    const lineLower = (lines[p.lineIdx] || '').toLowerCase();
    const facilityCtx = `${ctx} ${lineLower} ${lineWindow(p.lineIdx, 2, 2)}`;

    if (!isValidNanp(p.normalized)) {
      events.push({ rule: 'patient_phone_reject_invalid', value: p.formatted, reason: 'nanp' });
      continue;
    }
    if (tollFree.has(p.normalized.slice(0,3))) {
      events.push({ rule: 'patient_phone_reject_invalid', value: p.formatted, reason: 'toll_free' });
      continue;
    }
    if (/(^|\b)(fax|fx|facsimile)\b/.test(ctx) || /^\s*[fF](?:[:\-]|\s)/.test(lineLower) || isFaxLike(lines[p.lineIdx]) || /(^(?:.|\b))f[ao0@][xk](?![a-z])/i.test(ctx)) {
      events.push({ rule: 'patient_phone_reject_business', value: p.formatted, reason: 'fax' });
      continue;
    }
    if (/^\s*from\b/.test(lineLower) || isFromHeaderLine(lines[p.lineIdx])) {
      events.push({ rule: 'patient_phone_reject_business', value: p.formatted, reason: 'from_header' });
      continue;
    }
    if (p.providerLine || isLikelyProviderLine(lines[p.lineIdx]) || p.hasOrderingContext) {
      events.push({ rule: 'patient_phone_reject_business', value: p.formatted, reason: 'provider_context' });
      continue;
    }
    if (p.isPhoneLabel) {
      const beforeCtx = text.slice(Math.max(0, p.index - 100), p.index).toLowerCase();
      const afterCtx = text.slice(p.index, p.index + 100).toLowerCase();
      if (/ordering\s*(provider|physician)/i.test(beforeCtx + afterCtx) || /provider|physician|office|clinic|facility/i.test(beforeCtx)) {
        events.push({ rule: 'patient_phone_reject_business', value: p.formatted, reason: 'provider_label_near' });
        continue;
      }
    }
    if (/\bplace\s+of\s+surgery\b/i.test(facilityCtx) || /\bhome\s+sleep\s+stud/i.test(facilityCtx)) {
      events.push({ rule: 'patient_phone_reject_business', value: p.formatted, reason: 'facility_context' });
      continue;
    }
    if (THIRD_PARTY_BUSINESS_RE.test(facilityCtx)) {
      events.push({ rule: 'patient_phone_reject_business', value: p.formatted, reason: 'third_party' });
      continue;
    }
    if (BLACKLIST.has(p.normalized)) {
      events.push({ rule: 'patient_phone_reject_business', value: p.formatted, reason: 'blacklist' });
      continue;
    }
    filtered.push(p);
  }
  if (!filtered.length) {
    // fall back conservatively only if there are strong patient hints near the number
    events.push({ rule: 'patient_phone_overfiltered', count: rawPhones.length });
    const rawCandidates = [];
    for (const p of rawPhones) {
      const ctx = contextSnippet(p.index, 100) + ' ' + lineWindow(p.lineIdx, 2, 2);
      // skip obvious third-party/fax/provider contexts in fallback too
      if (/(^|\b)(fax|fx|facsimile)\b/.test(ctx)) continue;
      if (THIRD_PARTY_BUSINESS_RE.test(ctx)) continue;
      if (/provider|physician|office|clinic|facility|practice|ordering|referring/.test(ctx)) continue;
      // require at least one patient-specific hint
      const hasPatientHint = /(patient\s*(information|phone|contact))|\bhome\s*phone\b|\bmobile\s*phone\b|\bcell\b|\bH:\s*\(?\d{3}|\bM:\s*\(?\d{3}/i.test(ctx);
      if (!hasPatientHint) continue;
      rawCandidates.push({
        value: p.formatted,
        page: (structLinesInput?.[p.lineIdx]?.page) || 1,
        line: p.lineIdx,
        score: 1,
        sectionTag: (structLinesInput?.[p.lineIdx]?.sectionTag) || null,
        context: ctx
      });
    }
    if (!rawCandidates.length) {
      return { hit: false, value: [], why: 'patient_phones_none_filtered', trace: events };
    }
    const bestPhone = pickBest(rawCandidates, 'patient_phone');
    return { hit: !!bestPhone, value: bestPhone ? [ { formatted: bestPhone.value } ] : [], why: 'patient_phones_detect_raw_only', trace: events, candidates: rawCandidates };
  }

  // Scoring - prioritize phones near patient context and with explicit labels
  const areaFreq = filtered.reduce((acc,p)=>{ const ac=p.normalized.slice(0,3); acc[ac]=(acc[ac]||0)+1; return acc; },{});
  function score(p) {
    const ctx = contextSnippet(p.index);
    const lineLower = (lines[p.lineIdx] || '').toLowerCase();
    const around = lineWindow(p.lineIdx, 2, 2);
    const fuzzyLine = lineLower
      .replace(/[0@]/g, 'o')
      .replace(/mobte/g, 'mobile')
      .replace(/mobilc/g, 'mobile')
      .replace(/morme|morne|mome|homc|homr|homa/g, 'home')
      .replace(/prnary|prmary|pnmary|prmry|pnmaty|prmaty/g, 'primary')
      .replace(/phona/g, 'phone');
    let s = 0;
    const cg = contextScore(lines[p.lineIdx] || '');
    
    // Strong patient indicators (high priority)
    if (/\b[hm]:\s*\(?\d{3}\)?/i.test(lineLower)) s += 20; // "H:" or "M:" labels (home/mobile)
    if (/patient\s*(information|phone|contact)/i.test(ctx)) s += 15;
    if (/\bhome\s*phone\b/i.test(fuzzyLine)) s += 12;
    if (/\bmobi[el]e?\s*phone\b/i.test(fuzzyLine)) s += 12; // mobile/mobie phone (OCR variations + OCR noise)
    if (/\bhoma\s*phona\b/i.test(lineLower)) s += 12; // OCR corruption of "home phone"
  if (/\bprimary\s*(home|mobile)\b/i.test(fuzzyLine)) s += 5; // "Primary Home/Mobile"
  if (/(facesheet|demographics|patient\s*information)/i.test(around)) s += 8; // Facesheet/Demographics sections
    
    // Moderate patient indicators
    if (/phone|tel|cell|mobile/.test(ctx)) s += 5;
  if (/patient/.test(ctx)) s += 3;
  // Context guard weighting
  s += cg.patient * 6; // boost if patient context
  s -= (cg.header * 5 + cg.provider * 6 + cg.fax * 8 + Math.max(0, cg.score) * 0.5);
    
    // Strong negative indicators (exclude provider/office phones)
    if (/provider|office|clinic|facility|practice/.test(ctx)) s -= 10;
    if (/ordering|referring|physician/.test(ctx)) s -= 10;
    if (/fax/.test(ctx)) s -= 15;
    if (/insurance|auth|authorization/.test(ctx)) s -= 5;
    if (/\bplace\s+of\s+surgery\b/i.test(ctx)) s -= 8;
    if (/\bsleep\s+stud/i.test(ctx)) s -= 6;
    
    // Area code clustering bonus
    const ac = p.normalized.slice(0,3);
    s += (areaFreq[ac] || 0); // boost dominant area code cluster
    
    return s;
  }
  filtered.forEach(p => { p._score = score(p); });
  filtered.sort((a,b) => b._score - a._score);
  filtered.forEach(p => events.push({ rule: 'patient_phone_candidate', value: p.formatted, score: Number((p._score||0).toFixed(1)), lineIdx: p.lineIdx }));

  // Prefer phones with highest scores (likely patient phones with explicit labels)
  // If we have clear winners (score > 15), use only those. Otherwise use dominant area code.
  const highScorers = filtered.filter(p => p._score > 12);
  const dominantArea = Object.entries(areaFreq).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const dominant = dominantArea ? filtered.filter(p => p.normalized.startsWith(dominantArea)) : filtered;
  const curated = (highScorers.length > 0 ? highScorers : dominant).slice(0, 3); // cap to 3 to avoid noise

  if (!curated.length) {
    events.push({ rule: 'patient_phone_low_confidence', reason: 'no_curated' });
    return { hit: false, value: [], why: 'patient_phones_none_filtered', trace: events };
  }
  const bestScore = curated[0]._score ?? -Infinity;
  if (bestScore <= 0) {
    events.push({ rule: 'patient_phone_low_confidence', reason: 'score<=0' });
    return { hit: false, value: [], why: 'patient_phones_low_confidence', trace: events };
  }

  curated.forEach(p => events.push({ rule: 'patient_phone_selected', value: p.formatted, score: Number((p._score||0).toFixed(1)) }));
  // Build candidate objects for late fusion reranker
  const candidates = curated.map(p => {
    const lineObj = structLinesInput?.[p.lineIdx];
    const ctx = contextSnippet(p.index);
    // Count patient hints in context for multi-signal confirmation
    const hints = [/(patient\s*(information|phone|contact))/i, /\bhome\s*phone\b/i, /\bmobile\s*phone\b/i, /\bH:\s*\(?\d{3}/i, /\bM:\s*\(?\d{3}/i].reduce((acc, re) => acc + (re.test(ctx) ? 1 : 0), 0);
    return {
      value: p.formatted,
      page: lineObj?.page || 1,
      line: lineObj?.line ?? p.lineIdx,
      score: p._score || 0,
      sectionTag: lineObj?.sectionTag || null,
      context: ctx,
      patientHints: hints
    };
  });
  const bestPhone = pickBest(candidates, 'patient_phone');
  return { hit: !!bestPhone, value: bestPhone ? [ { formatted: bestPhone.value } ] : [], why: 'patient_phones_detect', trace: events, candidates };
}
