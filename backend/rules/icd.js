// Detect ICD-10 codes with label/context awareness and normalize variants (e.g., G47 33 → G47.33)
import fs from 'fs';
import path from 'path';

// Catalog-backed ICD detector with normalization and label-aware scanning.
// Keeps the same external API: detectICDs(fullText, lines) -> { hit, values, why, details?, trace? }

let ALLOW = new Set(); // allowed codes (normalized)
let DESC = new Map();  // code -> description
let KW = [];           // [{ code, res: [RegExp], label? }]
let ICD_ALERTS = new Map(); // code -> [actions]

function normalizeCode(raw) {
  if (!raw) return null;
  let s = String(raw).toUpperCase().trim();
  s = s.replace(/\s+/g, '');       // remove spaces
  s = s.replace(/-/g, '');          // remove dashes
  // Insert dot when missing for patterns like G4733 -> G47.33, allow up to 4 post-dot chars
  if (!s.includes('.') && /^[A-TV-Z]\d{4,6}$/.test(s)) {
    s = s.slice(0, 3) + '.' + s.slice(3);
  }
  return s;
}

function loadCatalogOnce() {
  if (ALLOW.size || DESC.size) return; // already loaded
  try {
    const catalogPath = path.resolve(process.cwd(), 'backend/rules/data/icd_catalog.json');
    const raw = fs.readFileSync(catalogPath, 'utf8');
    const list = JSON.parse(raw);
    if (Array.isArray(list)) {
      for (const item of list) {
        const code = normalizeCode(item?.code);
        if (!code) continue;
        ALLOW.add(code);
        DESC.set(code, item?.description || null);
        // Accept dotless alias too (OCR sometimes returns without dot)
        const alias = code.replace('.', '');
        ALLOW.add(alias);
        if (!DESC.has(alias)) DESC.set(alias, item?.description || null);
      }
    }
  } catch (e) {
    // Fallback to a small built-in allowlist if file missing
    const fallback = [
      { code: 'G47.33', description: 'Obstructive sleep apnea (adult) (pediatric)' },
      { code: 'R06.83', description: 'Snoring' },
      { code: 'I10', description: 'Essential (primary) hypertension' },
      { code: 'E11.9', description: 'Type 2 diabetes mellitus without complications' },
      { code: 'J45.909', description: 'Unspecified asthma, uncomplicated' }
    ];
    for (const item of fallback) {
      const code = normalizeCode(item.code);
      ALLOW.add(code); DESC.set(code, item.description);
      const alias = code.replace('.', '');
      ALLOW.add(alias); if (!DESC.has(alias)) DESC.set(alias, item.description);
    }
  }
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function loadKeywordsOnce() {
  if (KW.length) return;
  try {
    const p = path.resolve(process.cwd(), 'backend/rules/data/icd_keywords.json');
    const raw = fs.readFileSync(p, 'utf8');
    const list = JSON.parse(raw);
    if (Array.isArray(list)) {
      KW = list.map(item => {
        const code = item.code;
        const res = (item.keywords || []).map(k => new RegExp(`\\b${escapeRe(k)}\\b`, 'i'));
        return { code, res, label: item.label };
      });
    }
  } catch (e) {
    KW = [];
  }
}

function loadAlertsOnce() {
  if (ICD_ALERTS.size) return;
  try {
    const p = path.resolve(process.cwd(), 'backend/rules/data/icd_alerts.json');
    const raw = fs.readFileSync(p, 'utf8');
    const obj = JSON.parse(raw);
    for (const [code, actions] of Object.entries(obj || {})) {
      const norm = normalizeCode(code);
      if (!norm) continue;
      ICD_ALERTS.set(norm, Array.isArray(actions) ? actions : []);
    }
  } catch (e) {
    // optional
  }
}

export function detectICDs(fullText, _lines) {
  loadCatalogOnce();
  loadKeywordsOnce();
  loadAlertsOnce();

  const lines = String(fullText || '').split(/\r?\n/);

  // Candidate ICD pattern: Letter + 2 digits, optional dot/space/hyphen + up to 4 alphanum
  const codeRe = /\b([A-TV-Z][0-9]{2}(?:[.\-\s]?[0-9A-Z]{1,4})?)\b/g;

  // Prefer labeled/diagnosis sections
  const labelRe = /(icd-?10|\bicd\b|\bdx\b|diagnos(?:is|es)|assessment|impression)\b/i;

  // Avoid procedure/CPT lines when scanning broadly
  const skipRe = /(\bCPT\b|procedure|9580(?:6|10|11))/i;

  const seen = new Set();
  const details = [];
  const actions = new Set();
  const trace = [];

  const consider = (raw, lineIdx, text, why) => {
    const norm = normalizeCode(raw);
    if (!norm) return;
    // Accept if exact or dotless alias is allowed
    const ok = ALLOW.has(norm) || ALLOW.has(norm.replace('.', ''));
    if (!ok) return;
    const desc = DESC.get(norm) || DESC.get(norm.replace('.', '')) || null;
    if (!seen.has(norm)) {
      seen.add(norm);
  details.push({ code: norm, description: desc });
  // collect code-specific alerts
  const alertList = ICD_ALERTS.get(norm) || ICD_ALERTS.get(norm.replace('.', '')) || [];
  for (const a of alertList) actions.add(a);
      trace.push({ line: lineIdx + 1, code: norm, why, text: String(text || '').trim().slice(0, 200) });
    }
  };

  // Pass 1: labeled lines and up to 2 following lines
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

  // Pass 2: global fallback scan
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

  // Pass 3: keyword inference (label-aware first)
  if (seen.size === 0 && KW.length) {
    // Labeled lines and their neighbors
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      if (!labelRe.test(line)) continue;
      for (let j = i; j <= Math.min(i + 2, lines.length - 1); j++) {
        const text = lines[j] || '';
        if (skipRe.test(text)) continue;
        for (const item of KW) {
          for (const re of item.res) {
            if (re.test(text)) {
              consider(item.code, j, text, 'infer_labeled');
            }
          }
        }
      }
      if (seen.size) break; // stop after first labeled block hits
    }
  }

  // Pass 4: global keyword inference
  if (seen.size === 0 && KW.length) {
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i] || '';
      if (skipRe.test(text)) continue;
      for (const item of KW) {
        for (const re of item.res) {
          if (re.test(text)) {
            consider(item.code, i, text, 'infer_global');
          }
        }
      }
    }
  }

  if (seen.size === 0) return { hit: false, values: [], why: 'icd_none' };

  return {
    hit: true,
    values: details.map(d => d.code),
    details, // optional, not required by callers
    trace: trace.slice(0, 10),
    why: 'icd_detect',
    actions: Array.from(actions)
  };
}
