#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const files = [
  'examples/sample_extraction_result.json',
  'docs/schema/extraction_result.schema.json'
];

let ok = true;

for (const rel of files) {
  const p = path.join(root, rel);
  try {
    JSON.parse(fs.readFileSync(p, 'utf8'));
    console.log(`JSON OK: ${rel}`);
  } catch (e) {
    console.error(`JSON INVALID: ${rel}`);
    console.error(e.message);
    ok = false;
  }
}

process.exit(ok ? 0 : 1);
