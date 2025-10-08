import { loadJsonConfig } from './utils/configLoader.js';

const DEFAULT_CPT_RAW = [
  { code: '95811', why: 'cpt_titration', patterns: ['\\b95811\\b', 'titration'] },
  { code: '95806', why: 'cpt_hst', patterns: ['\\b95806\\b', '\\bG0399\\b', 'home\\s+(sleep\\s+)?(apnea|study|test)', '\\bHSAT\\b', '\\bHST\\b'] },
  { code: '95810', why: 'cpt_diagnostic', patterns: ['\\b95810\\b', 'polysomnography', 'in[-\\s]*lab\\s*PSG', 'sleep\\s+study'] }
];

function buildCatalog(list) {
  const compiled = [];
  if (Array.isArray(list)) {
    for (const item of list) {
      const code = String(item?.code || '').trim();
      if (!code) continue;
      const why = item?.why || 'pattern_match';
      const patterns = Array.isArray(item?.patterns) ? item.patterns : [];
      const regexes = [];
      for (const pat of patterns) {
        try {
          regexes.push(new RegExp(pat, 'i'));
        } catch {
          // ignore invalid regex
        }
      }
      if (!regexes.length) {
        try { regexes.push(new RegExp(`\\b${code}\\b`, 'i')); } catch {}
      }
      const description = typeof item?.description === 'string' ? item.description : null;
      if (regexes.length) compiled.push({ code, why, patterns: regexes, description });
    }
  }
  if (!compiled.length) {
    return buildCatalog(DEFAULT_CPT_RAW);
  }
  return compiled;
}

function getCptCatalog() {
  return loadJsonConfig('cpt_catalog.json', {
    transform: buildCatalog,
    defaultFactory: () => buildCatalog(DEFAULT_CPT_RAW)
  });
}

const TITRATION_EVIDENCE = [
  'titration','pressure too high','pressure too low','increase pressure','decrease pressure',
  'not tolerating','failed cpap','failed pap','failed apap','bipap','bi pap','asv','intolerance'
].map(s => s.toUpperCase());

function hasTitrationEvidence(U) { return TITRATION_EVIDENCE.some(k => U.includes(k)); }

export function detectCpt(fullText) {
  const catalog = getCptCatalog();
  const descMap = new Map();
  for (const item of catalog) {
    if (item?.code) {
      descMap.set(item.code, typeof item.description === 'string' ? item.description : null);
    }
  }
  const U = (fullText || '').toUpperCase();
  const candidates = [];
  const reasons = [];
  const reasonMap = {};
  for (const item of catalog) {
    const hit = item.patterns.some(re => re.test(fullText));
    if (hit && !candidates.includes(item.code)) {
      candidates.push(item.code);
      reasons.push({ code: item.code, why: item.why });
      reasonMap[item.code] = item.why;
    }
  }
  // Fallback: explicit numeric code presence even if patterns missed (e.g. poorly OCR'd contexts still capturing numbers)
  const explicitCodes = ['95810','95811']; // restrict fallback to primary in-lab codes to reduce false home test candidates
  for (const code of explicitCodes) {
    const re = new RegExp(`\\b${code}\\b`, 'i');
    if (re.test(fullText) && !candidates.includes(code)) {
      candidates.push(code);
      reasons.push({ code, why: 'explicit_code_token' });
      reasonMap[code] = 'explicit_code_token';
    }
  }
  if (!candidates.length) return { hit: false, why: 'cpt_none' };

  // Intent classification: ordered / requested / scheduled / consider / mentioned
  const intents = {};
  const intentRank = { ordered: 5, requested: 4, scheduled: 3, consider: 2, mentioned: 1 };
  const verbPatterns = [
    { key: 'ordered', re: /(order(?:ed)?|place\s+order(?:ed)?)/i },
    { key: 'requested', re: /(request(?:ed)?)/i },
    { key: 'scheduled', re: /(schedule(?:d)?)/i },
    { key: 'consider', re: /(consider(?:ed|ing)?|evaluate|ruling\s*out)/i }
  ];
  function classifyIntent(snippet) {
    for (const v of verbPatterns) {
      if (v.re.test(snippet)) return v.key;
    }
    return 'mentioned';
  }
  // Scan context (up to 60 chars before code token)
  for (const code of candidates) {
    const matcher = new RegExp(`(.{0,60})(${code})`, 'gi');
    let best = 'mentioned';
    let m;
    while ((m = matcher.exec(fullText)) !== null) {
      const ctx = m[1] || '';
      const intent = classifyIntent(ctx);
      if (intentRank[intent] > intentRank[best]) best = intent;
    }
    intents[code] = best;
  }

  const has95811 = candidates.includes('95811');
  const has95810 = candidates.includes('95810');
  const hasHome = candidates.includes('G0399') || candidates.includes('95806');
  const titration = hasTitrationEvidence(U);
  let primary = candidates[0];
  const ambiguity = [];

  // Pediatric prioritization: if pediatric codes present and diagnostic 95810 only mentioned while pediatric is ordered/requested
  const pediatricCodes = ['95782','95783'];
  const pedPresent = candidates.filter(c => pediatricCodes.includes(c));
  if (pedPresent.length) {
    // Choose the pediatric code with highest intent rank relative to 95810
    const intentRank = { ordered: 5, requested: 4, scheduled: 3, consider: 2, mentioned: 1 };
    const pedBest = pedPresent.reduce((best, code) => {
      const r = intentRank[intents[code] || 'mentioned'];
      if (!best || r > best.r) return { code, r };
      return best;
    }, null);
    const diagIntent = has95810 ? intentRank[intents['95810'] || 'mentioned'] : 0;
    if (pedBest && pedBest.r >= diagIntent) {
      primary = pedBest.code; // promote pediatric code
    }
  }

  if (has95811 && primary !== '95782' && primary !== '95783') {
    if (titration) {
      primary = '95811';
      reasons.push({ code: '95811', why: 'titration_evidence' });
    } else if (has95810) {
      primary = '95810';
      ambiguity.push('cpt_95811_without_evidence');
    } else {
      primary = '95811';
      ambiguity.push('cpt_95811_lacks_support');
    }
  } else if (has95810) {
    if (primary !== '95782' && primary !== '95783') {
      primary = '95810';
    }
  }
  if (hasHome && (has95810 || has95811)) ambiguity.push('cpt_home_and_inlab_conflict');
  // Only push generic multi-detected marker if >2 codes or no specific ambiguity already
  if (candidates.length > 1) {
    if (candidates.length > 2 || ambiguity.length === 0) {
      ambiguity.push('cpt_multiple_detected');
    }
  }

  let details = candidates.map(code => ({
    code,
    why: reasonMap[code] || 'pattern_match',
    intent: intents[code] || 'mentioned',
    description: descMap.get(code) || null
  }));
  // Intent-based pruning: if 95810 is ordered and home study codes only 'mentioned', drop them to reduce noise
  if (primary === '95810') {
    const filteredDetails = [];
    for (const d of details) {
      if ((d.code === '95806' || d.code === 'G0399') && d.intent === 'mentioned') continue; // prune weak mention
      filteredDetails.push(d);
    }
    const prunedCodes = filteredDetails.map(d => d.code);
    if (!prunedCodes.includes(primary)) prunedCodes.unshift(primary);
    if (prunedCodes.length < candidates.length) {
      let newAmb = [...ambiguity];
      if (!prunedCodes.some(c => c === '95806' || c === 'G0399')) {
        newAmb = newAmb.filter(a => a !== 'cpt_home_and_inlab_conflict');
      }
      if (prunedCodes.length === 1) {
        newAmb = newAmb.filter(a => a !== 'cpt_multiple_detected');
      }
      details = filteredDetails;
      return { hit: true, why: 'cpt_multi_detect', primary, candidates: prunedCodes, reasons, ambiguity: newAmb, details };
    }
  }

  // Ensure primary first in candidates list (reorder if necessary)
  if (candidates.length) {
    const uniq = candidates.filter((c,i)=>candidates.indexOf(c)===i);
    const reordered = [primary, ...uniq.filter(c=>c!==primary)];
    // In-place mutation instead of reassignment (candidates declared as const)
    candidates.splice(0, candidates.length, ...reordered);
  }

  return { hit: true, why: 'cpt_multi_detect', primary, candidates, reasons, ambiguity, details };
}
