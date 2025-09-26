import fs from 'fs';
import path from 'path';

let catalog = [];
function loadCpt() {
  if (catalog.length) return;
  try {
    const p = path.resolve(process.cwd(), 'backend/rules/data/cpt_catalog.json');
    const raw = fs.readFileSync(p, 'utf8');
    const list = JSON.parse(raw);
    catalog = list.map(item => ({ code: item.code, why: item.why, res: (item.patterns || []).map(p => new RegExp(p, 'i')) }));
  } catch (e) {
    catalog = [
      { code: '95811', why: 'cpt_titration', res: [/\b95811\b/i, /titration/i] },
      { code: '95806', why: 'cpt_hst', res: [/\b95806\b/i, /\bG0399\b/i, /home\s*(sleep)?\s*(test|apnea)/i, /HSAT/i, /HST/i] },
      { code: '95810', why: 'cpt_diagnostic', res: [/\b95810\b/i, /polysomnography/i, /in[-\s]*lab\s*PSG/i, /sleep\s*study/i] }
    ];
  }
}

export function selectCpt(fullText) {
  loadCpt();
  for (const item of catalog) {
    for (const re of item.res) {
      if (re.test(fullText)) return { hit: true, value: item.code, why: item.why };
    }
  }
  return { hit: false, why: 'cpt_none' };
}
