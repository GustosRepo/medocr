import test from 'node:test';
import assert from 'node:assert/strict';
import { runExtraction } from '../backend/rules/index.js';

/*
  Confidence detail transparency test
  Verifies presence and shape of `confidenceDetail` object introduced in recalibration:
    { anchors, score, base, avgOcrConf, manualTriggers, adjustments }
*/

test('confidenceDetail structure and anchor weighting present', async () => {
  const text = `Patient: Jane Doe\nDOB: 01/02/1970\nOrder: 95810 polysomnography due to suspected OSA.\nDiagnosis ICD: G47.33 obstructive sleep apnea.\nInsurance: Aetna Member ID: ABC123 Group: GRP1 status accepted.`;
  const { result } = await runExtraction([{ text }]);
  assert.ok(result.confidenceDetail, 'confidenceDetail missing');
  const d = result.confidenceDetail;
  for (const k of ['anchors','score','base','avgOcrConf','manualTriggers','adjustments']) {
    assert.ok(Object.prototype.hasOwnProperty.call(d, k), `confidenceDetail.${k} missing`);
  }
  assert.equal(typeof d.score, 'number');
  assert.ok(d.score >= 2.5, 'expected score reflecting multiple anchors');
  assert.ok(['High','Medium','Low','Manual Review'].includes(result.confidence), 'unexpected overall confidence tier');
  // Anchors
  const a = d.anchors;
  assert.equal(typeof a.patientName, 'boolean');
  assert.equal(typeof a.dob, 'boolean');
  assert.equal(typeof a.cpt, 'boolean');
  assert.equal(typeof a.diagnosis, 'boolean');
  assert.equal(typeof a.insuranceCarrier, 'boolean');
  // At least these should be true for this sample
  ['patientName','dob','cpt','diagnosis','insuranceCarrier'].forEach(k => assert.ok(a[k], `anchor ${k} expected true`));
  // Adjustments should be an array (may be empty) with objects if present
  assert.ok(Array.isArray(d.adjustments));
});
