// Detect ICD-10 codes with label/context awareness and normalize variants (e.g., G47 33 → G47.33)
import { loadJsonConfig } from './utils/configLoader.js';

const DEFAULT_ICD_CATALOG = [
  { code: 'G47.33', description: 'Obstructive sleep apnea (adult) (pediatric)' },
  { code: 'R06.83', description: 'Snoring' },
  { code: 'I10', description: 'Essential (primary) hypertension' },
  { code: 'E11.9', description: 'Type 2 diabetes mellitus without complications' },
  { code: 'J45.909', description: 'Unspecified asthma, uncomplicated' }
];

const DEFAULT_ENRICHMENT = { chronic: [], severity: {}, notes: {} };

function normalizeCode(raw) {
  if (!raw) return null;
  let s = String(raw).toUpperCase().trim();
  s = s.replace(/\s+/g, '');
  s = s.replace(/-/g, '');
  if (!s.includes('.') && /^[A-TV-Z]\d{4,6}$/.test(s)) {
    s = s.slice(0, 3) + '.' + s.slice(3);
  }
  return s;
}

function buildCatalog(list) {
  const allow = new Set();
  const desc = new Map();
  const source = Array.isArray(list) ? list : DEFAULT_ICD_CATALOG;
  for (const item of source) {
    const code = normalizeCode(item?.code);
    if (!code) continue;
    allow.add(code);
    desc.set(code, item?.description || null);
    const alias = code.replace('.', '');
    allow.add(alias);
    if (!desc.has(alias)) desc.set(alias, item?.description || null);
  }
  if (!allow.size) {
    return buildCatalog(DEFAULT_ICD_CATALOG);
  }
  return { allow, desc };
}

function buildKeywords(list) {
  if (!Array.isArray(list)) return [];
  const result = [];
  for (const item of list) {
    const code = normalizeCode(item?.code);
    if (!code) continue;
    const keywords = Array.isArray(item?.keywords) ? item.keywords : [];
    const res = [];
    for (const kw of keywords) {
      try { res.push(new RegExp(`\\b${String(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')); } catch {}
    }
    if (res.length) result.push({ code, res, label: item?.label });
  }
  return result;
}

function buildAlerts(obj) {
  const map = new Map();
  if (obj && typeof obj === 'object') {
    for (const [code, actions] of Object.entries(obj)) {
      const norm = normalizeCode(code);
      if (!norm) continue;
      map.set(norm, Array.isArray(actions) ? actions : []);
    }
  }
  return map;
}

function buildEnrichment(obj) {
  if (!obj || typeof obj !== 'object') return { ...DEFAULT_ENRICHMENT };
  const chronic = Array.isArray(obj.chronic) ? obj.chronic.map(normalizeCode).filter(Boolean) : [];
  const severity = obj.severity && typeof obj.severity === 'object' ? obj.severity : {};
  const notes = obj.notes && typeof obj.notes === 'object' ? obj.notes : {};
  return { chronic, severity, notes };
}

function getCatalog() {
  return loadJsonConfig('icd_catalog.json', {
    transform: buildCatalog,
    defaultFactory: () => buildCatalog(DEFAULT_ICD_CATALOG)
  });
}

function getKeywords() {
  return loadJsonConfig('icd_keywords.json', {
    transform: buildKeywords,
    defaultFactory: () => []
  });
}

function getAlerts() {
  return loadJsonConfig('icd_alerts.json', {
    transform: buildAlerts,
    defaultFactory: () => new Map()
  });
}

function getEnrichment() {
  return loadJsonConfig('icd_enrichment.json', {
    transform: buildEnrichment,
    defaultFactory: () => ({ ...DEFAULT_ENRICHMENT })
  });
}

export function detectICDs(fullText, _lines) {
  const catalog = getCatalog();
  const allowSet = catalog?.allow || new Set();
  const descMap = catalog?.desc || new Map();
  const keywords = getKeywords();
  const alertsMap = getAlerts();
  const enrichment = getEnrichment();

  const lines = String(fullText || '').split(/\r?\n/);

  const codeRe = /\b([A-TV-Z][0-9]{2}(?:[.\-\s]?[0-9A-Z]{1,4})?)\b/g;
  const labelRe = /(icd-?10|\bicd\b|\bdx\b|diagnos(?:is|es)|assessment|impression)\b/i;
  const skipRe = /(\bCPT\b|procedure|9580(?:6|10|11))/i;

  const seen = new Set();
  const details = [];
  const actions = new Set();
  const trace = [];

  const consider = (raw, lineIdx, text, why) => {
    const norm = normalizeCode(raw);
    if (!norm) return;
    const alias = norm.replace('.', '');
    if (!allowSet.has(norm) && !allowSet.has(alias)) return;
    const desc = descMap.get(norm) || descMap.get(alias) || null;
    if (!seen.has(norm)) {
      seen.add(norm);
      details.push({ code: norm, description: desc });
      const alertList = alertsMap.get(norm) || alertsMap.get(alias) || [];
      for (const a of alertList) actions.add(a);
      trace.push({ line: lineIdx + 1, code: norm, why, text: String(text || '').trim().slice(0, 200) });
    }
  };

  // Pass 1: labeled lines and neighbors
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || '';
    if (!labelRe.test(line)) continue;
    for (let j = i; j <= Math.min(i + 2, lines.length - 1); j++) {
      const text = lines[j] || '';
      let m;
      while ((m = codeRe.exec(text)) !== null) {
        consider(m[1], j, text, 'labeled');
      }
    }
  }

  if (seen.size === 0) {
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i] || '';
      if (skipRe.test(text)) continue;
      let m;
      while ((m = codeRe.exec(text)) !== null) {
        consider(m[1], i, text, 'global');
      }
    }
  }

  if (seen.size === 0 && keywords.length) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      if (!labelRe.test(line)) continue;
      for (let j = i; j <= Math.min(i + 2, lines.length - 1); j++) {
        const text = lines[j] || '';
        if (skipRe.test(text)) continue;
        for (const item of keywords) {
          for (const re of item.res) {
            if (re.test(text)) consider(item.code, j, text, 'infer_labeled');
          }
        }
      }
      if (seen.size) break;
    }
  }

  if (seen.size === 0 && keywords.length) {
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i] || '';
      if (skipRe.test(text)) continue;
      for (const item of keywords) {
        for (const re of item.res) {
          if (re.test(text)) consider(item.code, i, text, 'infer_global');
        }
      }
    }
  }

  if (seen.size === 0) return { hit: false, values: [], why: 'icd_none' };

  if (enrichment && details.length) {
    for (const d of details) {
      const base = d.code.replace('.', '');
      const normCode = d.code;
      const chronicArr = Array.isArray(enrichment.chronic) ? enrichment.chronic : [];
      d.chronic = chronicArr.includes(normCode) || chronicArr.includes(base);
      d.severity = enrichment.severity?.[normCode] || enrichment.severity?.[base] || null;
      d.note = enrichment.notes?.[normCode] || enrichment.notes?.[base] || null;
    }
  }

  return {
    hit: true,
    values: details.map(d => d.code),
    details,
    trace: trace.slice(0, 10),
    why: 'icd_detect',
    actions: Array.from(actions)
  };
}
