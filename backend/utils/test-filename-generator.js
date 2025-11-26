#!/usr/bin/env node
/**
 * Test script for filename generation
 * Run: node backend/utils/test-filename-generator.js
 */

import { generateDisplayFilename, generateExportFilename, isValidFilename, handleFilenameCollision, _test } from './filenameGenerator.js';

console.log('🧪 Testing Filename Generator\n');

// Test 1: Normal case with all data
console.log('Test 1: Full data');
const fullData = {
  patient: { first: 'Karla', last: 'Arellano' },
  procedure: { cpt: '95806' },
  documentMeta: { referralDate: '2025-08-20' }
};
console.log('  Input:', JSON.stringify(fullData, null, 2));
console.log('  Display:', generateDisplayFilename(fullData));
console.log('  Export:', generateExportFilename(fullData));
console.log('  ✅ Expected: Arellano_Karla_95806_20250820.pdf\n');

// Test 2: Name with special characters
console.log('Test 2: Special characters in name');
const specialChars = {
  patient: { name: "O'Brien, María" },
  procedure: { cpt: '95810' },
  documentMeta: { referralDate: '2025-09-15' }
};
console.log('  Input:', JSON.stringify(specialChars, null, 2));
console.log('  Display:', generateDisplayFilename(specialChars));
console.log('  ✅ Expected: OBrien_Maria_95810_20250915.pdf (sanitized)\n');

// Test 3: Missing name (fallback)
console.log('Test 3: Missing patient name');
const noName = {
  patient: {},
  procedure: { cpt: '95806' },
  documentMeta: { referralDate: '2025-08-20' }
};
console.log('  Input:', JSON.stringify(noName, null, 2));
console.log('  Display:', generateDisplayFilename(noName));
console.log('  ✅ Expected: Unknown_95806_20250820.pdf\n');

// Test 4: Missing CPT
console.log('Test 4: Missing CPT code');
const noCPT = {
  patient: { first: 'John', last: 'Smith' },
  procedure: {},
  documentMeta: { referralDate: '2025-08-20' }
};
console.log('  Input:', JSON.stringify(noCPT, null, 2));
console.log('  Display:', generateDisplayFilename(noCPT));
console.log('  ✅ Expected: Smith_John_20250820.pdf\n');

// Test 5: "Last, First" format
console.log('Test 5: Comma-separated name format');
const commaName = {
  patient: { name: 'Arellano, Karla' },
  procedure: { cpt: '95806' }
};
console.log('  Input:', JSON.stringify(commaName, null, 2));
console.log('  Display:', generateDisplayFilename(commaName, { includeDate: false }));
console.log('  ✅ Expected: Arellano_Karla_95806.pdf\n');

// Test 6: Multiple CPT codes (array)
console.log('Test 6: Multiple CPT codes');
const multiCPT = {
  patient: { first: 'Jane', last: 'Doe' },
  procedure: { cpt: ['95806', 'G0399', '95810'] }
};
console.log('  Input:', JSON.stringify(multiCPT, null, 2));
console.log('  Display:', generateDisplayFilename(multiCPT, { includeDate: false }));
console.log('  ✅ Expected: Doe_Jane_95806.pdf (takes first)\n');

// Test 7: Filename collision handling
console.log('Test 7: Collision handling');
const existingFiles = [
  'Arellano_Karla_95806.pdf',
  'Arellano_Karla_95806_v2.pdf'
];
const collisionResult = handleFilenameCollision('Arellano_Karla_95806.pdf', existingFiles);
console.log('  Existing:', existingFiles);
console.log('  Result:', collisionResult);
console.log('  ✅ Expected: Arellano_Karla_95806_v3.pdf\n');

// Test 8: Filename validation
console.log('Test 8: Filename validation');
const validNames = [
  'Arellano_Karla_95806.pdf',
  'Smith_John_95810_20250820.pdf'
];
const invalidNames = [
  '../../../etc/passwd',
  'CON.pdf',
  'file/with/slashes.pdf',
  ''
];
console.log('  Valid filenames:');
validNames.forEach(name => {
  console.log(`    ${name}: ${isValidFilename(name) ? '✅' : '❌'}`);
});
console.log('  Invalid filenames:');
invalidNames.forEach(name => {
  console.log(`    ${name || '(empty)'}: ${isValidFilename(name) ? '❌ FAILED' : '✅'}`);
});
console.log();

// Test 9: Helper function tests
console.log('Test 9: Helper functions');
console.log('  sanitizeForFilename("María O\'Brien"): ', _test.sanitizeForFilename("María O'Brien"));
console.log('  ✅ Expected: Maria_OBrien');
console.log('  parsePatientName({ name: "Smith, John" }): ', JSON.stringify(_test.parsePatientName({ name: 'Smith, John' })));
console.log('  ✅ Expected: {"first":"John","last":"Smith"}');
console.log('  extractPrimaryCPT({ cpt: ["95806", "G0399"] }): ', _test.extractPrimaryCPT({ cpt: ['95806', 'G0399'] }));
console.log('  ✅ Expected: 95806');
console.log('  formatDateForFilename("2025-08-20"): ', _test.formatDateForFilename('2025-08-20'));
console.log('  ✅ Expected: 20250820\n');

console.log('✅ All tests completed!');
console.log('\n💡 To integrate with frontend:');
console.log('   1. Frontend shows: entry.displayFilename (smart name)');
console.log('   2. Export downloads as: Arellano_Karla_95806_Summary_20250820.pdf');
console.log('   3. Original file stays: 9f7a4d93...pdf (secure hash on disk)');
