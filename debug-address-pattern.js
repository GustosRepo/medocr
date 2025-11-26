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

const lines = realOCRText.split('\n');

console.log('Lines around "Address":');
lines.forEach((line, i) => {
  if (i >= 13 && i <= 21) {
    console.log(`Line ${i}: "${line}"`);
  }
});

console.log('\n--- Testing patterns ---');

// Test if "Address" matches standalone pattern
const addressLine = lines[15];
console.log(`\nLine 15: "${addressLine}"`);
console.log(`Trimmed: "${addressLine.trim()}"`);
console.log(`Standalone address test: ${/^address$/i.test(addressLine.trim())}`);

// Test if street address matches
const streetLine = lines[17];
console.log(`\nLine 17: "${streetLine}"`);
console.log(`Street pattern test: ${/^\d+\s+[A-Za-z]/.test(streetLine)}`);
console.log(`Length > 5: ${streetLine.length > 5}`);

// Test city/state/ZIP pattern
const cszLine = lines[19];
console.log(`\nLine 19: "${cszLine}"`);
const cszMatch = cszLine.match(/^([A-Za-z\s]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
console.log(`City/State/ZIP match:`, cszMatch);
