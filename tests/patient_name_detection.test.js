import test from 'node:test';
import assert from 'node:assert/strict';
import { detectName, parseNameFromFilename } from '../backend/rules/patient.js';

test('detectName extracts patient when soft stop words surround the line', () => {
  const text = [
    'Patient Support Team Intake Sheet',
    'Patient Name: White, Amy forward documentation',
    'DOB: 01/02/1990'
  ].join('\n');
  const res = detectName(text);
  assert.ok(res.hit, 'expected name hit');
  assert.deepEqual(res.value, { first: 'Amy', last: 'White' });
});

test('detectName fallback still works when line contains soft tokens after the name', () => {
  const text = [
    'Forwarding paperwork',
    'White, Amy support team',
    'DOB 01/02/1990'
  ].join('\n');
  const res = detectName(text);
  assert.ok(res.hit, 'expected fallback hit');
  assert.deepEqual(res.value, { first: 'Amy', last: 'White' });
});

test('detectName does not return names when only strict tokens are present', () => {
  const text = 'FAX COVER SHEET: Sleep Clinic Provider Support';
  const res = detectName(text);
  assert.equal(res.hit, false);
});

test('detectName rejects initials-only extraction like "Pdt, Am"', () => {
  const text = 'Patient Name: Pdt, Am';
  const res = detectName(text);
  assert.equal(res.hit, false);
});

test('detectName still handles short legitimate names', () => {
  const text = 'Patient Name: Ng, An';
  const res = detectName(text);
  assert.ok(res.hit, 'expected name hit');
  assert.deepEqual(res.value, { first: 'An', last: 'Ng' });
});

test('detectName ignores header such as "Attention Veterans"', () => {
  const text = [
    'Attention Veterans',
    'Please see attached sleep study order'
  ].join('\n');
  const res = detectName(text);
  assert.equal(res.hit, false);
});

test('parseNameFromFilename extracts last and first from common pattern', () => {
  const res = parseNameFromFilename('Brissette Jr., Normand_95806.pdf');
  assert.deepEqual(res, { last: 'Brissette Jr.', first: 'Normand' });
});
