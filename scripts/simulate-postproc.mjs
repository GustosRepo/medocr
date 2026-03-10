#!/usr/bin/env node

// Simulate what the new post-processing would do to existing batch results
import fs from 'fs';
import { glob } from 'fs';
import path from 'path';

const SLEEP_CPT_MAP = {
  '95800': 'Portable sleep study (Type 3)',
  '95801': 'Portable sleep study (Type 4)',
  '95805': 'Multiple sleep latency test (MSLT)',
  '95806': 'Unattended sleep study',
  '95810': 'Polysomnography (PSG)',
  '95811': 'PSG with PAP titration / split-night',
};

const CPT_INFERENCE_RULES = [
  [['split-night', 'split night', 'splitnight'], '95811'],
  [['titration', 'pap titration', 'cpap titration'], '95811'],
  [['mslt', 'multiple sleep latency'], '95805'],
  [['hsat', 'home sleep', 'portable sleep'], '95800'],
  [['polysomnography', 'polysomnogram', 'psg', 'sleep study', 'in-lab', 'in lab'], '95810'],
  [['sleep test', 'sleep evaluation'], '95810'],
];

function inferCpt(desc) {
  if (!desc) return null;
  const d = desc.toLowerCase();
  for (const [kws, code] of CPT_INFERENCE_RULES) {
    if (kws.some(kw => d.includes(kw))) return code;
  }
  return null;
}

function cleanIcd(code) {
  if (!code || typeof code !== 'string') return code;
  if (/^[A-Z]\d{2}\.\d{1,4}$/.test(code.trim())) return code.trim();
  const withDot = code.match(/\b([A-Z]\d{2}\.\d{1,4})\b/i);
  if (withDot) return withDot[1].toUpperCase();
  const noDot = code.match(/\b([A-Z]\d{2})(\d{1,4})\b/i);
  if (noDot) return `${noDot[1].toUpperCase()}.${noDot[2]}`;
  const prefixed = code.match(/^\s*([A-Z]\d{2}\.?\d{0,4})/i);
  if (prefixed) {
    let c = prefixed[1].toUpperCase();
    if (c.length >= 4 && !c.includes('.')) c = c.slice(0, 3) + '.' + c.slice(3);
    return c;
  }
  return code.trim();
}

function splitCpt(raw) {
  if (!raw) return null;
  if (/^\d{5}$/.test(raw)) return raw;
  const matches = raw.match(/\d{5}/g);
  if (matches) {
    const sleep = matches.filter(c => SLEEP_CPT_MAP[c]);
    return sleep.length ? sleep[0] : matches[0];
  }
  return raw.length <= 6 ? raw : null;
}

// Process all results
const dir = 'data/results';
const files = fs.readdirSync(dir).filter(f => f.startsWith('doc_17726') && f.endsWith('.json'));

let before = { cpt: 0, icd: 0, cptConcat: 0 };
let after = { cpt: 0, icd: 0, cptFixed: 0, cptInferred: 0, icdCleaned: 0 };
let total = files.length;
let improvements = [];

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f)));
  const proc = d.procedure || {};
  const diag = d.diagnoses || [];
  const name = `${d.patient?.first || '?'} ${d.patient?.last || '?'}`;

  // BEFORE
  const hadCpt = !!proc.cpt;
  const hadIcd = diag.length > 0;
  if (hadCpt) before.cpt++;
  if (hadIcd) before.icd++;
  if (proc.cpt && String(proc.cpt).length > 5) before.cptConcat++;

  // AFTER — simulate post-processing
  let newCpt = proc.cpt ? splitCpt(String(proc.cpt).replace(/[^\dA-Za-z]/g, '').toUpperCase()) : null;
  let cptSource = newCpt ? 'original' : null;

  if (!newCpt && proc.description) {
    newCpt = inferCpt(proc.description);
    if (newCpt) cptSource = 'description';
  }
  if (!newCpt) {
    const codes = diag.map(dx => dx.code).filter(Boolean).join(' ');
    if (/G47\.|R06\.83|E66/i.test(codes)) {
      newCpt = '95810';
      cptSource = 'diagnosis';
    }
  }

  if (newCpt) after.cpt++;
  if (cptSource === 'description') { after.cptInferred++; improvements.push(`  ${name}: CPT inferred ${newCpt} from "${proc.description}"`); }
  if (cptSource === 'original' && proc.cpt !== newCpt) { after.cptFixed++; improvements.push(`  ${name}: CPT fixed "${proc.cpt}" → ${newCpt}`); }

  // ICD cleaning
  const newDiag = diag.map(dx => ({ ...dx, code: cleanIcd(dx.code) })).filter(dx => dx.code);
  if (newDiag.length > 0) after.icd++;
  for (let i = 0; i < diag.length && i < newDiag.length; i++) {
    if (diag[i].code !== newDiag[i].code) {
      after.icdCleaned++;
      improvements.push(`  ${name}: ICD "${diag[i].code}" → "${newDiag[i].code}"`);
    }
  }
}

console.log(`Total results: ${total}`);
console.log();
console.log('=== CPT IMPROVEMENT ===');
console.log(`  Before: ${before.cpt}/${total} (${Math.round(before.cpt/total*100)}%)`);
console.log(`  After:  ${after.cpt}/${total} (${Math.round(after.cpt/total*100)}%)`);
console.log(`  Concat fixed: ${after.cptFixed}`);
console.log(`  Inferred from description: ${after.cptInferred}`);
console.log();
console.log('=== ICD IMPROVEMENT ===');
console.log(`  Before: ${before.icd}/${total} (${Math.round(before.icd/total*100)}%)`);
console.log(`  After:  ${after.icd}/${total} (${Math.round(after.icd/total*100)}%)`);
console.log(`  Codes cleaned: ${after.icdCleaned}`);
console.log();
console.log('=== CHANGES ===');
improvements.forEach(i => console.log(i));
