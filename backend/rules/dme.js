import { loadJsonConfig } from './utils/configLoader.js';

const DEFAULT_DME = {
  vendors: ['APRIA','LINCARE','ROTECH','ADAPT','PACIFIC','PRISM','PHILIPS','RESMED'],
  codes: ['E0\d{3}','A703[4-9]'],
  issues: [
    'not\s*tolerating|cannot\s*tolerate|intoleran',
    'pressure\s*too\s*high|high\s*pressure',
    'pressure\s*too\s*low|low\s*pressure',
    'mask\s*leak|air\s*leak',
    'mask\s*uncomfortable|uncomfortable\s*mask',
    'machine\s*broken|equipment\s*malfunction',
    'lifetime\s*usage\s*limit|insurance\s*limit\s*reached',
    'cpap\s*user|uses\s*cpap|on\s*cpap',
    'cpap\s*compliant|cpap\s*non-?compliant',
    'cpap\s*supplies|cpap\s*replacement',
    'dme\s*provider|equipment\s*provider'
  ]
};

function escapeUnion(values) {
  return values.map(v => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
}

function buildDmeConfig(cfg) {
  const vendors = Array.isArray(cfg?.vendors) && cfg.vendors.length ? cfg.vendors : DEFAULT_DME.vendors;
  const codes = Array.isArray(cfg?.codes) && cfg.codes.length ? cfg.codes : DEFAULT_DME.codes;
  const issues = Array.isArray(cfg?.issues) && cfg.issues.length ? cfg.issues : DEFAULT_DME.issues;
  let vendorRe = null;
  let codeRe = null;
  try {
    vendorRe = new RegExp(`\\b(${escapeUnion(vendors)})\\b`, 'i');
  } catch {
    vendorRe = null;
  }
  try {
    codeRe = new RegExp(`\\b(${codes.join('|')})\\b`, 'gi');
  } catch {
    codeRe = null;
  }
  const issueRes = [];
  for (const pattern of issues) {
    try { issueRes.push(new RegExp(pattern, 'i')); } catch {}
  }
  return { vendorRe, codeRe, issueRes };
}

function getDmeConfig() {
  return loadJsonConfig('dme_catalog.json', {
    transform: buildDmeConfig,
    defaultFactory: () => buildDmeConfig(DEFAULT_DME)
  });
}

export function detectDME(fullText) {
  const { vendorRe, codeRe, issueRes } = getDmeConfig();
  const vendors = [];
  const vm = vendorRe ? fullText.match(vendorRe) : null;
  if (vm) vendors.push(vm[0]);
  const codes = codeRe ? [...fullText.matchAll(codeRe)].map(m => m[0]) : [];
  if (!vendors.length && !codes.length) return { hit: false, why: 'dme_none' };
  const issues = [];
  for (const re of issueRes) { if (re.test(fullText)) issues.push(re.source); }
  return { hit: true, value: { vendors: [...new Set(vendors)], codes: [...new Set(codes)], issues }, why: 'dme_detect' };
}
