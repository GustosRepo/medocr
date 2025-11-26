import { detectAddress } from './backend/rules/address.js';

const realOCRText = `9/2/2025 1:41:28 pm EDT
Page: 01/ 15
athsna
8d156250-b5cd-48b6-b907-d38f5e4a6535
EEN KERMANI MD LTD · 11920 SOUTHERN HIGHLANDS PKWY STE 100,LAS VEGAS NV 89141-3273
ARELLANO, Karla D (id #22614, dob: 04/08/1982)
Patient Information
Patient Name
Sex
ARELLANO, KARLA d
F
DoB
43ya
04/08/1982
Age
Address
Phone
11009 PRAIRIE GROVE RD
H: (619) 519-6671
LAS VEGAS, NV 89179-2075
M: (619) 519-6671`;

const lines = realOCRText.split('\n').map(line => line.trim());

console.log('Testing with real OCR text...\n');
console.log('Lines containing "Address" or "11009":');
lines.forEach((line, i) => {
  if (line.includes('Address') || line.includes('11009') || line.includes('LAS VEGAS, NV 89179')) {
    console.log(`  Line ${i}: "${line}"`);
  }
});

const result = detectAddress(realOCRText, lines);
console.log('\nDetection result:', JSON.stringify(result, null, 2));
