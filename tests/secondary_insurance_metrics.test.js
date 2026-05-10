import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { runExtraction } from '../backend/rules/index.js';

/*
  Secondary Insurance Metrics Harness (Quantitative)
  Extends precision harness by computing precision, recall, and F1 for curated labeled sample.
  Acceptance (initial):
    - No false positives
    - No false negatives in curated set
    - Precision = 1.0, Recall = 1.0 (strict for now; relax later if sample diversifies)
*/

test('secondary insurance metrics (precision/recall/F1) curated sample', async () => {
  const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/secondary_insurance_labeled.json');
  const cases = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  let tp = 0, fp = 0, fn = 0;
  const detail = [];

  for (const c of cases) {
    const { result } = await runExtraction([{ text: c.text }]);
    const detected = (result.insurance || []).map(i => i.carrier).filter(Boolean);
    const expected = c.expectCarriers;

    // Build sets
    const expSet = new Set(expected);
    const detSet = new Set(detected);

    // True positives: intersection size beyond the primary (first always expected)
    for (const carrier of detSet) {
      if (expSet.has(carrier)) tp++; else fp++;
    }
    for (const carrier of expSet) {
      if (!detSet.has(carrier)) fn++;
    }

    detail.push({ id: c.id, expected, detected });
  }

  const precision = tp === 0 ? 0 : tp / (tp + fp);
  const recall = tp === 0 ? 0 : tp / (tp + fn);
  const f1 = (precision + recall) === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  // Strict assertions for curated sample
  assert.equal(fp, 0, `false positives present: ${fp}`);
  assert.equal(fn, 0, `false negatives present: ${fn}`);
  assert.equal(precision, 1, `precision expected 1.0 got ${precision.toFixed(2)}`);
  assert.equal(recall, 1, `recall expected 1.0 got ${recall.toFixed(2)}`);
  assert.equal(f1, 1, `f1 expected 1.0 got ${f1.toFixed(2)}`);

  // Provide structured output in process stdout for optional reporting
  // (Not an assertion, just visibility)
  process.stdout.write('[secondary_insurance_metrics] ' + JSON.stringify({ tp, fp, fn, precision, recall, f1, samples: detail.length }) + '\n');
});
