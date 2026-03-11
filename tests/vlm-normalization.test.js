import { normalizeVlmResult } from '../backend/vlmExtractor.js';

let pass = 0, fail = 0;

function check(name, actual, expected) {
  if (actual === expected) { console.log(`  PASS: ${name}`); pass++; }
  else { console.log(`  FAIL: ${name} — expected ${expected}, got ${actual}`); fail++; }
}

// Test 1: CPT field with diagnosis name 'OSA' should be rejected and inferred from description
const r1 = normalizeVlmResult({
  patient: { first: 'John', last: 'Doe', phones: [] },
  insurance: [],
  procedure: { cpt: 'OSA', description: 'polysomnography' },
  diagnoses: [{ code: 'G47.33', description: 'Obstructive sleep apnea' }],
  clinical: { symptoms: [] },
  confidence: 0.8
});
check('CPT rejects "OSA" and infers from description', r1.procedure.cpt, '95810');

// Test 2: CPT field with 'Sleep Apnea' should be rejected
const r2 = normalizeVlmResult({
  patient: { first: 'Jane', last: 'Smith', phones: [] },
  insurance: [],
  procedure: { cpt: 'Sleep Apnea', description: 'sleep study' },
  diagnoses: [],
  clinical: { symptoms: [] },
  confidence: 0.7
});
check('CPT rejects "Sleep Apnea"', r2.procedure.cpt, '95810');

// Test 3: Valid CPT should pass through
const r3 = normalizeVlmResult({
  patient: { first: 'Bob', last: 'Jones', phones: [] },
  insurance: [],
  procedure: { cpt: '95811', description: 'split night' },
  diagnoses: [],
  clinical: { symptoms: [] },
  confidence: 0.9
});
check('Valid CPT passthrough', r3.procedure.cpt, '95811');

// Test 4: Name swap - comma in first field
const r4 = normalizeVlmResult({
  patient: { first: 'DOE,', last: 'JOHN', phones: [] },
  insurance: [],
  procedure: { cpt: null },
  diagnoses: [],
  clinical: { symptoms: [] },
  confidence: 0.8
});
check('Name swap (comma in first)', r4.patient.first, 'John');
check('Name swap (comma in first) last', r4.patient.last, 'Doe');

// Test 5: Name swap - combined in last field  
const r5 = normalizeVlmResult({
  patient: { first: 'ignored', last: 'SMITH, JANE', phones: [] },
  insurance: [],
  procedure: { cpt: null },
  diagnoses: [],
  clinical: { symptoms: [] },
  confidence: 0.8
});
check('Name swap (combined in last) first', r5.patient.first, 'Jane');
check('Name swap (combined in last) last', r5.patient.last, 'Smith');

// Test 6: All-caps normalization
const r6 = normalizeVlmResult({
  patient: { first: 'JOHN', last: 'DOE', phones: [] },
  insurance: [],
  procedure: { cpt: null },
  diagnoses: [],
  clinical: { symptoms: [] },
  confidence: 0.8
});
check('Title case first', r6.patient.first, 'John');
check('Title case last', r6.patient.last, 'Doe');

// Test 7: CPT field with 'Insomnia' text should be null (no description to infer from)
const r7 = normalizeVlmResult({
  patient: { first: 'Test', last: 'User', phones: [] },
  insurance: [],
  procedure: { cpt: 'Insomnia', description: null },
  diagnoses: [],
  clinical: { symptoms: [] },
  confidence: 0.7
});
check('CPT rejects "Insomnia" with no description', r7.procedure.cpt, null);

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
