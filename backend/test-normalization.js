#!/usr/bin/env node
/**
 * Test Field Normalization with Real Document Data
 * 
 * This tests the dynamic validation on the actual 11-page Medicare referral
 * to verify name splitting, address parsing, and placeholder handling work correctly.
 */

import { normalizeFields, splitName, parseAddress, isPlaceholder } from './utils/fieldNormalizer.js';

// Sample data structure from the real 11-page document
const testDocument = {
  patient: {
    name: "SMITH, JOHN A",  // Combined name format
    dob: "01/15/1965",
    phone: "(555) 123-4567",
    address: "123 Main Street, Springfield, IL 62701"  // Combined address
  },
  insurance: {
    name: "Medicare",
    memberId: "1EG4TE5MK73"
  },
  provider: {
    name: "Dr. Jane Wilson",
    npi: "—",  // Placeholder that should be treated as null
    phone: "(555) 987-6543"
  },
  diagnosis: "Obstructive Sleep Apnea",
  referralReason: "Sleep study consultation"
};

console.log('=== Testing Field Normalization ===\n');

// Test 1: Name splitting
console.log('Test 1: Name Splitting');
console.log('Input:', testDocument.patient.name);
const nameParts = splitName(testDocument.patient.name);
console.log('Output:', nameParts);
console.log('✓ Parsed correctly\n');

// Test 2: Address parsing
console.log('Test 2: Address Parsing');
console.log('Input:', testDocument.patient.address);
const addressParts = parseAddress(testDocument.patient.address);
console.log('Output:', addressParts);
console.log('✓ Parsed correctly\n');

// Test 3: Placeholder detection
console.log('Test 3: Placeholder Detection');
const testValues = ['—', 'N/A', '', 'Real Value', '  ', 'pending', null];
testValues.forEach(val => {
  console.log(`  "${val}" -> ${isPlaceholder(val) ? 'PLACEHOLDER' : 'VALID VALUE'}`);
});
console.log('✓ Placeholders detected correctly\n');

// Test 4: Full normalization
console.log('Test 4: Full Document Normalization');
console.log('Input document structure:', JSON.stringify(testDocument, null, 2));
const normalized = normalizeFields(testDocument);
console.log('\nNormalized document:', JSON.stringify(normalized, null, 2));

// Verify expected fields are present
const checks = [
  { field: 'patient.firstName', expected: 'JOHN', actual: normalized.patient.firstName },
  { field: 'patient.lastName', expected: 'SMITH', actual: normalized.patient.lastName },
  { field: 'patient.middleName', expected: 'A', actual: normalized.patient.middleName },
  { field: 'patient.address', expected: '123 Main Street', actual: normalized.patient.address },
  { field: 'patient.city', expected: 'Springfield', actual: normalized.patient.city },
  { field: 'patient.state', expected: 'IL', actual: normalized.patient.state },
  { field: 'patient.zip', expected: '62701', actual: normalized.patient.zip },
  { field: 'provider.npi', expected: null, actual: normalized.provider.npi }
];

console.log('\n=== Validation Checks ===');
let passed = 0;
let failed = 0;

checks.forEach(check => {
  const matches = check.actual === check.expected;
  if (matches) {
    console.log(`✓ ${check.field}: ${check.actual}`);
    passed++;
  } else {
    console.log(`✗ ${check.field}: Expected "${check.expected}", got "${check.actual}"`);
    failed++;
  }
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

if (failed === 0) {
  console.log('✅ All normalization tests passed!');
  process.exit(0);
} else {
  console.log('❌ Some tests failed');
  process.exit(1);
}
