#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const root = process.cwd();
const schemaPath = path.join(root, 'docs/schema/extraction_result.schema.json');
const samplePath = path.join(root, 'examples/sample_extraction_result.json');

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function validate() {
  const schema = loadJSON(schemaPath);
  const sample = loadJSON(samplePath);

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const validate = ajv.compile(schema);
  const valid = validate(sample);

  if (!valid) {
    console.error('Schema validation failed:\n');
    console.error(JSON.stringify(validate.errors, null, 2));
    process.exit(1);
  }
  console.log('Schema validation passed for examples/sample_extraction_result.json');
}

validate();
