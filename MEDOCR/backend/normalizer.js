import fs from 'fs';
import path from 'path';

const cfgPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'normalization_config.json');
let config = {
  dateLabels: [],
  misspellings: {},
  ungluePhrases: {},
  cptCorrections: {}
};
try {
  const raw = fs.readFileSync(cfgPath, 'utf8');
  config = JSON.parse(raw);
} catch (_) {
  // keep defaults
}

const labelUnion = config.dateLabels
  .map((l) => l.replace(/[\-\/\\^$*+?.()|[\]{}]/g, (r) => `\\${r}`))
  .join('|');

function safeCleanup(t) {
  let s = String(t || '');
  s = s.replace(/\r/g, '\n');
  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/[ \t]{2,}/g, ' ');
  s = s.replace(/[’‘]/g, "'");
  s = s.replace(/[“”]/g, '"');
  // common misspellings
  for (const [k, v] of Object.entries(config.misspellings || {})) {
    const re = new RegExp(`\\b${k}\\b`, 'gi');
    s = s.replace(re, v);
  }
  s = s.replace(/-\n/g, '');
  // remove stray pipes
  s = s.replace(/\|/g, '');
  // numbers split across newlines
  s = s.replace(/(\d)[ \t]*\n[ \t]*(\d)/g, '$1$2');
  // collapse spaced-out letters forming words
  s = s.replace(/((?:\b[A-Za-z]\s){2,}[A-Za-z]\b)/g, (seq) => seq.replace(/\s+/g, ''));
  // unglue phrases
  for (const [k, v] of Object.entries(config.ungluePhrases || {})) {
    const re = new RegExp(k, 'gi');
    s = s.replace(re, v);
  }
  return s;
}

function normalizeDates(s) {
  let t = s;
  // glued MMDD with extra zeros in year in labeled Referral/order date
  t = t.replace(/(Referral\/?order\s*date:\s*)0?(\d{2})(\d{2})[\/\-]0{1,2}(\d{4})/i, (_, p, mm, dd, yyyy) => `${p}${mm}/${dd}/${yyyy}`);
  // general fixes for / or - before 4-digit year: remove leading zeros
  t = t.replace(/(\b\d{1,2}[\/\-]\d{1,2}[\/\-])+00(\d{4}\b)/g, (m) => m.replace(/\/(?:00)/, '/').replace(/\-(?:00)/, '-'));
  t = t.replace(/(\b\d{1,2}[\/\-]\d{1,2}[\/\-])+0(\d{4}\b)/g, (m) => m.replace(/\/(?:0)/, '/').replace(/\-(?:0)/, '-'));
  // labeled date lines: remove leading zeros before 4-digit year
  if (labelUnion) {
    const re = new RegExp(`((?:${labelUnion})\\s*:\\s*[01]?\\d[\\/\\-][0-3]?\\d[\\/\\-])0+(\\d{4}\\b)`, 'gi');
    t = t.replace(re, '$1$2');
  }
  // 2-digit year with leading zeros -> expand century
  t = t.replace(/([01]?\d[\/\-][0-3]?\d[\/\-])0+(\d{2}\b)/g, (_, p, yy) => {
    const n = parseInt(yy, 10);
    const century = n <= 30 ? '20' : '19';
    return `${p}${century}${yy}`;
  });
  return t;
}

function domainTweaks(s) {
  let t = s;
  // BP spacing
  t = t.replace(/(\b\d{2,3})\s*\/\s*(\d{2,3}\b)/g, '$1/$2');
  // height artifact like 5'5'0" -> 5'0"
  t = t.replace(/(\d)'\d'(\d)\"/g, "$1'$2\"");
  // CPT corrections
  for (const [bad, good] of Object.entries(config.cptCorrections || {})) {
    const re = new RegExp(`\\b${bad}\\b`, 'g');
    t = t.replace(re, good);
  }
  return t;
}

export function normalizeOcr(text = '') {
  let t = safeCleanup(text);
  t = normalizeDates(t);
  t = domainTweaks(t);
  return t.trim();
}

