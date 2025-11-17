#!/usr/bin/env node
import { runExtractionWithDates } from '../rules/index.js';

const text = `
Referral for sleep testing
Order: Split-night study with titration
Notes: prior diagnostic PSG was positive, needs settings optimized
`;

const ocrPages = [{ page: 1, text, boxes: [] }];
const { result, trace } = await runExtractionWithDates(ocrPages);

const out = {
  cpt: result.procedure?.cpt || null,
  description: result.procedure?.description || null,
  trace: trace.filter(t => String(t.rule).startsWith('cpt_description_') || t.rule === 'cpt_multi_detect' || t.rule === 'learned_correction_cpt')
};

console.log(JSON.stringify(out, null, 2));
