import test from 'node:test';
import assert from 'node:assert/strict';
import { runExtraction } from '../backend/rules/index.js';

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a,b)=>a-b);
  const idx = Math.min(sorted.length-1, Math.floor(p * (sorted.length-1)));
  return sorted[idx];
}

// Synthetic documents of varying complexity
const docs = Array.from({ length: 40 }, (_,i) => {
  const base = `Patient John Doe DOB 01/02/197${i%10}\nOrder: ${i%2? '95811 titration polysomnography' : '95810 polysomnography'} due to snoring and daytime sleepiness.\nDiagnosis ICD: G47.33 obstructive sleep apnea.\nInsurance: Aetna Member ID: ABC${1000+i} Group: GRP${i}`;
  const extra = i % 3 === 0 ? `\nHistory: prior failed HSAT noted. CPAP usage 6.${i%10} hrs AHI 4.${i%5}.` : '';
  return base + extra;
});

test('performance harness p50/p95 within thresholds', () => {
  const durations = [];
  for (const text of docs) {
    const t0 = process.hrtime.bigint();
    runExtraction([{ text }]);
    const t1 = process.hrtime.bigint();
    durations.push(Number(t1 - t0) / 1e6); // ms
  }
  const p50 = percentile(durations, 0.5);
  const p95 = percentile(durations, 0.95);
  // Conservative thresholds based on current typical ~20-25ms run times in existing tests.
  assert.ok(p50 < 35, `p50 too high: ${p50.toFixed(2)}ms`);
  assert.ok(p95 < 55, `p95 too high: ${p95.toFixed(2)}ms`);
  process.stdout.write('[perf] p50=' + p50.toFixed(2) + 'ms p95=' + p95.toFixed(2) + 'ms\n');
});
