import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrateConfidence } from '../backend/calibration/confidence.js';

// Minimal synthetic sample set exercising different anchor coverage levels.
const samples = [
  'Patient John Doe DOB 01/02/1970 Order: 95810 Diagnosis ICD: G47.33 Insurance: Aetna Member ID: ABC123',
  'Referral for sleep study 95811 titration no diagnosis listed.',
  'Insurance: Cigna Member ID: C1111 Group: G1\nRequest polysomnography.',
  'Patient Jane Roe DOB 02/02/1980 insurance pending.',
  'Polysomnogram 95810 due to excessive daytime sleepiness and snoring.'
];

test('confidence calibration harness produces distribution stats', async () => {
  const stats = await calibrateConfidence(samples);
  assert.equal(stats.samples, samples.length);
  assert.ok(stats.score.min != null && stats.score.max != null);
  assert.ok(stats.score.avg >= 0, 'avg score should be non-negative');
  assert.ok(Object.values(stats.tiers).some(v => v > 0), 'expected at least one tier populated');
  // Expect anchor keys present
  ['patientName','dob','cpt','diagnosis'].forEach(k => {
    assert.ok(stats.anchors[k], `anchor ${k} distribution missing`);
  });
  assert.ok(Object.keys(stats.bucket).length >= 1, 'score bucket distribution missing');
});
