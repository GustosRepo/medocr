import test from 'node:test';
import assert from 'node:assert/strict';
import { runExtraction } from '../backend/rules/index.js';

function page(t){ return [{ text: t }]; }

test('titration without compliance metrics but DME issues -> verify_dme_prerequisites action', async () => {
  const txt = 'Order: 95811 titration sleep study\nEquipment: CPAP user not tolerating pressure too high\nVendor: APRIA';
  const { result } = await runExtraction(page(txt));
  assert.ok(result.alerts.actions.includes('verify_dme_prerequisites'), 'expected verify_dme_prerequisites');
  assert.ok(result.flags.reasons.includes('dme_prerequisites_missing'), 'flag for missing DME prerequisites');
});

test('titration with compliance metrics does not add missing prereq flag', async () => {
  const txt = 'Order: 95811 titration sleep study\nCPAP user AHI 12 average 6 hrs per night usage 80% nights >4 hrs\nVendor: APRIA pressure too high';
  const { result } = await runExtraction(page(txt));
  assert.ok(!result.flags.reasons.includes('dme_prerequisites_missing'), 'should not flag prereq when metrics present');
});
