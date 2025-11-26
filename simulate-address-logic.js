const text = `Age
Address
Phone
11009 PRAIRIE GROVE RD
H: (619) 519-6671
LAS VEGAS, NV 89179-2075
M: (619) 519-6671`;

const lines = text.split('\n');

console.log('=== Simulating address detection ===\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  if (/^address$/i.test(line.trim())) {
    console.log(`Found "Address" label at line ${i}: "${line}"`);
    console.log(`Looking ahead from line ${i + 1} to ${Math.min(i + 6, lines.length) - 1}...\n`);
    
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const nextLine = lines[j];
      console.log(`  Checking line ${j}: "${nextLine}"`);
      
      if (/^\d+\s+[A-Za-z]/.test(nextLine) && nextLine.length > 5) {
        console.log(`    ✅ Matches street pattern!`);
        const address = nextLine.split(',')[0].trim();
        console.log(`    Address: "${address}"`);
        console.log(`    Looking for city/state/zip from line ${j + 1} to ${Math.min(j + 4, lines.length) - 1}...\n`);
        
        for (let k = j + 1; k < Math.min(j + 4, lines.length); k++) {
          const cszLine = lines[k];
          console.log(`      Checking line ${k}: "${cszLine}"`);
          const csz = cszLine.match(/^([A-Za-z\s]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
          if (csz) {
            console.log(`        ✅ Matches CSZ pattern!`);
            console.log(`        City: "${csz[1].trim()}", State: "${csz[2]}", ZIP: "${csz[3]}"`);
            break;
          } else {
            console.log(`        ❌ No CSZ match`);
          }
        }
        break;
      } else {
        console.log(`    ❌ Not a street address`);
      }
    }
  }
}
