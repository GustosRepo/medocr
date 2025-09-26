#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const root = process.cwd();
const schemaPath = path.join(root, 'docs/schema/extraction_result.schema.json');
const examplesDir = path.join(root, 'examples');

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.isFile() && p.endsWith('.json')) yield p;
  }
}

let failCount = 0;
for (const file of walk(examplesDir)) {
  const rel = path.relative(root, file);
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ok = validate(data);
    if (!ok) {
      console.error(`FAIL: ${rel}`);
      console.error(JSON.stringify(validate.errors, null, 2));
      failCount++;
    } else {
      console.log(`OK:   ${rel}`);
    }
  } catch (e) {
    console.error(`ERROR parsing ${rel}: ${e.message}`);
    failCount++;
  }
}

process.exit(failCount === 0 ? 0 : 1);
