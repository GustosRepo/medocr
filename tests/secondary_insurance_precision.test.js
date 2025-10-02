import test from 'node:test';
import assert from 'node:assert/strict';
import { runExtraction } from '../backend/rules/index.js';

/*
  Secondary Insurance Precision Evaluation Harness
  Goal: Ensure heuristic reliably detects true secondary carriers while avoiding false positives.
  Metrics (simple for now):
    - truePositives: cases expecting 2 carriers and received 2
    - falseNegatives: cases expecting 2 but received <2
    - falsePositives: cases expecting 1 but received >1
  Thresholds: zero false positives tolerated; zero false negatives in this curated sample.
*/

test('secondary insurance precision harness', () => {
  const cases = [
    {
      name: 'single primary only',
      expect: 1,
      text: 'Patient John Doe DOB 01/02/1970\nInsurance: Aetna Member ID: ABC123 Group: GRP1\nPlease attach insurance card. Insurance information required.'
    },
    {
      name: 'primary + explicit other insurance',
      expect: 2,
      text: 'Insurance: Aetna Member ID: ABC123 Group: GRP1\nOther Insurance: Medicare Member ID: Z99999 Group: MGRP'
    },
    {
      name: 'primary + generic plan mention (should NOT create secondary)',
      expect: 1,
      text: 'Insurance: Aetna Member ID: ABC123 Group: GRP1\nPlan: Sleep Program coverage details provided here.'
    },
    {
      name: 'primary + instructional lines referencing insurance (no carrier)',
      expect: 1,
      text: 'Insurance: Blue Cross Member ID: BC1111 Group: BLUE1\nPlease provide insurance cards front/back. Insurance must be active at time of service.'
    },
    {
      name: 'two distinct carriers separated by space',
      expect: 2,
      text: 'Insurance: United Healthcare Member ID: UHC123 Group: U1\nSecondary Insurance: Tricare Member ID: TRI555 Group: T1'
    },
    {
      name: 'primary + ambiguous repeated insurance word (no secondary)',
      expect: 1,
      text: 'Insurance: Cigna Member ID: CIG001 Group: CG1\nInsurance information: verify eligibility prior to study. Insurance policy may require auth.'
    }
  ];

  let truePos = 0, falseNeg = 0, falsePos = 0;
  for (const c of cases) {
    const { result } = runExtraction([{ text: c.text }]);
    const count = Array.isArray(result.insurance) ? result.insurance.length : 0;
    if (c.expect === 2) {
      if (count === 2) {
        const carriersDistinct = result.insurance[0].carrier !== result.insurance[1].carrier;
        assert.ok(carriersDistinct, `carriers not distinct in case: ${c.name}`);
        truePos++;
      } else {
        falseNeg++;
      }
    } else { // expect 1
      if (count > 1) falsePos++; // record but continue to list for visibility
    }
  }

  assert.equal(falsePos, 0, `secondary insurance false positives: ${falsePos}`);
  assert.equal(falseNeg, 0, `secondary insurance false negatives: ${falseNeg}`);
  assert.ok(truePos >= 2, 'expected at least 2 true positive detections');
});
