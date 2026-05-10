import test from 'node:test';
import assert from 'node:assert/strict';
import { runExtraction } from '../backend/rules/index.js';

function makePage(text){ return [{ page:1, text, boxes: [] }]; }

test('detects newly added not accepted carrier Scan Health Plan', async () => {
  const pages = makePage('Patient X\nInsurance: Scan Health Plan Member ID: AAA111 Group: BBB');
  const { result } = await runExtraction(pages);
  assert.equal(result.insurance[0].carrier, 'Scan Health Plan');
  assert.equal(result.insurance[0].status, 'not_accepted');
  assert.ok(result.flags.reasons.includes('do_not_accept_or_pending_contract'));
});

test('detects Alignment Health as not accepted', async () => {
  const pages = makePage('Referral\nInsurance: Alignment Health Member ID: ZZZ999');
  const { result } = await runExtraction(pages);
  assert.equal(result.insurance[0].carrier, 'Alignment Health');
  assert.equal(result.insurance[0].status, 'not_accepted');
});

test('applies new Cigna 95811 preauth rule', async () => {
  const pages = makePage('Order: 95811 titration study\nInsurance: Cigna');
  const { result } = await runExtraction(pages);
  assert.ok(result.alerts.actions.includes('preauth_check_needed'), 'expected preauth action');
  assert.ok(result.flags.reasons.includes('preauth_required_possible'), 'preauth flag expected');
  const notes = result.documentMeta.authorizationNotes || [];
  assert.ok(notes.some(n => /Cigna: ensure prior positive diagnostic study/i.test(n)), 'missing Cigna note');
});

test('applies Humana pediatric 95782 preauth rule', async () => {
  const pages = makePage('Order: 95782 pediatric sleep study\nInsurance: Humana');
  const { result } = await runExtraction(pages);
  assert.ok(result.alerts.actions.includes('preauth_check_needed'));
});

test('applies Tricare 95811 preauth rule', async () => {
  const pages = makePage('Order: 95811 titration study\nInsurance: Tricare');
  const { result } = await runExtraction(pages);
  assert.ok(result.alerts.actions.includes('preauth_check_needed'));
});
