#!/usr/bin/env node
/**
 * generate-gold-files.mjs
 *
 * Reads data/benchmarks/regex-baseline.json, fetches each successful document's
 * extraction result from the running backend, and writes a .gold.json alongside
 * each PDF in examples/benchmark/.
 *
 * Usage:
 *   node scripts/generate-gold-files.mjs [--overwrite]
 *
 * The gold files use the SAME field paths as the benchmark scorer so that
 * re-running the benchmark will produce accuracy scores.
 *
 * Fields scored (FIELD_PATHS in benchmark script):
 *   patient.first / last / dob / phone / address / city / state / zip
 *   insurance.0.carrier / memberId / insurance.1.carrier / memberId
 *   provider.name / npi / practice / phone / fax
 *   procedure.cpt / description
 *   documentMeta.referralDate
 *
 * NOTE: The engine stores patient phone as patient.phones[] and address as
 * patient.address.{city,state,zip}, not the flat paths. Gold files only include
 * fields that are actually present at the expected path in the result.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASELINE_JSON = path.join(__dirname, '../data/benchmarks/regex-baseline.json');
const BENCH_DIR = path.join(__dirname, '../examples/benchmark');
const API_HOST = '127.0.0.1';
const API_PORT = 4387;

const FIELD_PATHS = [
  'patient.first',
  'patient.last',
  'patient.dob',
  'patient.phone',
  'patient.address',
  'patient.city',
  'patient.state',
  'patient.zip',
  'insurance.0.carrier',
  'insurance.0.memberId',
  'insurance.1.carrier',
  'insurance.1.memberId',
  'provider.name',
  'provider.npi',
  'provider.practice',
  'provider.phone',
  'provider.fax',
  'procedure.cpt',
  'procedure.description',
  'documentMeta.referralDate',
];

function getByPath(obj, fieldPath) {
  return fieldPath.split('.').reduce((cur, part) => {
    if (cur == null) return undefined;
    if (/^\d+$/.test(part)) return Array.isArray(cur) ? cur[Number(part)] : undefined;
    return cur[part];
  }, obj);
}

function setByPath(obj, fieldPath, value) {
  const parts = fieldPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextPart = parts[i + 1];
    const nextIsIndex = /^\d+$/.test(nextPart);
    if (/^\d+$/.test(part)) {
      const idx = Number(part);
      while (cur.length <= idx) cur.push(null);
      if (cur[idx] == null) cur[idx] = nextIsIndex ? [] : {};
      cur = cur[idx];
    } else {
      if (cur[part] == null) cur[part] = nextIsIndex ? [] : {};
      cur = cur[part];
    }
  }
  const lastPart = parts[parts.length - 1];
  if (/^\d+$/.test(lastPart)) {
    const idx = Number(lastPart);
    while (cur.length <= idx) cur.push(null);
    cur[idx] = value;
  } else {
    cur[lastPart] = value;
  }
}

/** Fetch extraction result for a document ID */
function fetchResult(id) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: API_HOST, port: API_PORT, path: `/api/documents/${id}/result`, method: 'GET', timeout: 30000 },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

/** Parse CPT codes from filename, e.g. "Anderson, Darryl_95806,95810,95811.pdf" → ["95806","95810","95811"] */
function cptCodesFromFilename(filename) {
  const match = filename.match(/_(\d{5}(?:,\d{5})*)\./);
  return match ? match[1].split(',') : [];
}

function isEmpty(val) {
  if (val == null || val === '') return true;
  if (Array.isArray(val) && val.length === 0) return true;
  if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) return true;
  return false;
}

async function main() {
  const overwrite = process.argv.includes('--overwrite');
  const baselineArg = process.argv.find(a => a.startsWith('--baseline='));
  const baselineFile = baselineArg ? baselineArg.split('=')[1] : BASELINE_JSON;
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  const successCases = baseline.cases.filter(c => c.ok);

  console.log(`Processing ${successCases.length} successful cases (${overwrite ? 'overwrite ON' : 'skip existing'})...`);
  console.log(`Output dir: ${BENCH_DIR}\n`);

  let generated = 0;
  let skipped = 0;
  let errors = 0;

  for (const c of successCases) {
    const base = c.file.replace(/\.pdf$/i, '');
    const goldPath = path.join(BENCH_DIR, `${base}.gold.json`);

    if (!overwrite && fs.existsSync(goldPath)) {
      console.log(`  SKIP  ${c.file}`);
      skipped++;
      continue;
    }

    let result;
    try {
      result = await fetchResult(c.id);
    } catch (e) {
      console.log(`  ERROR ${c.file}: ${e.message}`);
      errors++;
      continue;
    }

    // Build gold object by walking FIELD_PATHS and copying non-empty values
    const gold = {};
    for (const fieldPath of FIELD_PATHS) {
      const val = getByPath(result, fieldPath);
      if (!isEmpty(val)) {
        setByPath(gold, fieldPath, val);
      }
    }

    // Validate/override procedure.cpt using filename as ground truth
    const filenameCpts = cptCodesFromFilename(c.file);
    if (filenameCpts.length > 0) {
      const extractedCpt = getByPath(result, 'procedure.cpt');
      if (!extractedCpt || !filenameCpts.includes(extractedCpt)) {
        // Engine extracted a CPT not in the filename — use first filename CPT
        if (!gold.procedure) gold.procedure = {};
        gold.procedure.cpt = filenameCpts[0];
        console.log(`  WARN  ${c.file}: engine CPT=${extractedCpt} not in filename CPTs [${filenameCpts}], using ${filenameCpts[0]}`);
      }
      // Store all filename CPTs as metadata (not scored)
      gold._filenameCpts = filenameCpts;
    }

    fs.writeFileSync(goldPath, JSON.stringify(gold, null, 2));
    const scoredFields = FIELD_PATHS.filter(fp => getByPath(gold, fp) != null).length;
    console.log(`  WROTE ${c.file.padEnd(60)} (${scoredFields} scoreable fields)`);
    generated++;
  }

  console.log(`\n--- Summary ---`);
  console.log(`  Generated: ${generated}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Errors:    ${errors}`);
  if (errors === 0 && generated > 0) {
    console.log(`\nNext: node scripts/benchmark-local-extraction.mjs examples/benchmark data/benchmarks/regex-scored.json`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
