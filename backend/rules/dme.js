import fs from 'fs';
import path from 'path';

let vendorRe = null;
let codeRe = null;
let issueRes = [];
function loadDme() {
  if (vendorRe && codeRe && issueRes.length) return;
  try {
    const p = path.resolve(process.cwd(), 'backend/rules/data/dme_catalog.json');
    const raw = fs.readFileSync(p, 'utf8');
    const cfg = JSON.parse(raw);
    const vendorUnion = (cfg.vendors || []).map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    vendorRe = new RegExp(`\\b(${vendorUnion})\\b`, 'i');
    const codeUnion = (cfg.codes || []).join('|');
    codeRe = new RegExp(`\\b(${codeUnion})\\b`, 'gi');
    issueRes = [
      /not\s*tolerating|cannot\s*tolerate|intoleran/i,
      /pressure\s*too\s*high|high\s*pressure/i,
      /pressure\s*too\s*low|low\s*pressure/i,
      /mask\s*leak|air\s*leak/i,
      /mask\s*uncomfortable|uncomfortable\s*mask/i,
      /machine\s*broken|equipment\s*malfunction/i,
      /lifetime\s*usage\s*limit|insurance\s*limit\s*reached/i,
      /cpap\s*user|uses\s*cpap|on\s*cpap/i,
      /cpap\s*compliant|cpap\s*non-?compliant/i,
      /cpap\s*supplies|cpap\s*replacement/i,
      /dme\s*provider|equipment\s*provider/i
    ];
  } catch (e) {
    vendorRe = /\b(APRIA|LINCARE|ROTECH|ADAPT|PACIFIC|PRISM|PHILIPS|RESMED)\b/i;
    codeRe = /\b(E0\d{3}|A703[4-9])\b/gi;
    issueRes = [];
  }
}

export function detectDME(fullText) {
  loadDme();
  const vendors = [];
  const vm = fullText.match(vendorRe);
  if (vm) vendors.push(vm[0]);
  const codes = [...fullText.matchAll(codeRe)].map(m => m[0]);
  if (!vendors.length && !codes.length) return { hit: false, why: 'dme_none' };
  const issues = [];
  for (const re of issueRes) { if (re.test(fullText)) issues.push(re.source); }
  return { hit: true, value: { vendors: [...new Set(vendors)], codes: [...new Set(codes)], issues }, why: 'dme_detect' };
}
