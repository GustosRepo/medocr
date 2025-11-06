import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPhones } from '../backend/rules/patient.js';

// This test ensures pharmacy/lab/imaging numbers near labels like WALGREENS DRUG STORE
// and Quest Diagnostics are rejected as patient phones.

test('rejects third-party pharmacy and lab phone numbers as patient phones', () => {
  const sample = `
    WALGREENS DRUG STORE #07841 (ERX)
    10510 SOUTHERN HIGHLANDS PKWY, LAS VEGAS, NV 89141
    Ph (702) 260-1992  Fax (702) 260-0595

    Preferred Lab: QUEST DIAGNOSTICS PSC
    5808 S RAINBOW BLVD, LAS VEGAS, NV 89118
    Phone: (866) 697-8378
  `;

  const res = detectPhones(sample);
  // Should find raw phones but reject them as third-party or fax/toll-free
  assert.equal(res.hit, false, 'should not have a patient phone hit');
  assert.equal(Array.isArray(res.value) && res.value.length, 0, 'no patient phones should be selected');
  // Ensure the rejection reason includes third_party for Walgreens and Quest contexts
  const reasons = res.trace.filter(e => e.rule === 'patient_phone_reject_business').map(e => e.reason);
  assert.ok(reasons.includes('third_party') || reasons.includes('fax'), 'should reject phones with third_party/fax reasons');
});
