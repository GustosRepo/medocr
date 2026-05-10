#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import http from 'http';
import { performance } from 'perf_hooks';

const API_HOST = process.env.MEDOCR_API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.MEDOCR_API_PORT || 4387);
const BENCH_DIR = path.resolve(process.argv[2] || 'examples/benchmark');
const OUTPUT = path.resolve(process.argv[3] || 'data/benchmarks/local-extraction-results.json');
const POLL_MS = Number(process.env.MEDOCR_BENCH_POLL_MS || 2000);
const TIMEOUT_MS = Number(process.env.MEDOCR_BENCH_TIMEOUT_MS || 15 * 60 * 1000);
const LIMIT = Number(process.env.MEDOCR_BENCH_LIMIT || 0);

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
  'documentMeta.referralDate'
];

function usageAndExit() {
  console.error('Usage: node scripts/benchmark-local-extraction.mjs <bench_dir> [output_json]');
  console.error('');
  console.error('Bench dir format:');
  console.error('  sample.pdf');
  console.error('  sample.gold.json');
  console.error('');
  console.error('Gold JSON can contain any subset of benchmarked field paths.');
  process.exit(1);
}

function request({ method = 'GET', path: reqPath, headers = {}, body = null, timeout = 30000 }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: API_HOST,
      port: API_PORT,
      path: reqPath,
      method,
      headers,
      timeout
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch {}
        resolve({ status: res.statusCode, raw, json });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`request_timeout:${method}:${reqPath}`));
    });
    if (body) req.write(body);
    req.end();
  });
}

function uploadPdf(filePath) {
  const filename = path.basename(filePath);
  const boundary = '----MedocrBenchmark' + Math.random().toString(36).slice(2);
  const fileBuffer = fs.readFileSync(filePath);
  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: application/pdf\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, fileBuffer, footer]);
  return request({
    method: 'POST',
    path: '/api/documents',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length
    },
    body,
    timeout: 60000
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getByPath(obj, fieldPath) {
  return fieldPath.split('.').reduce((cur, part) => {
    if (cur == null) return undefined;
    if (/^\d+$/.test(part)) return Array.isArray(cur) ? cur[Number(part)] : undefined;
    return cur[part];
  }, obj);
}

function canonical(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(canonical).filter(Boolean).join('|');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function exactOrContained(actual, expected) {
  const a = canonical(actual);
  const e = canonical(expected);
  if (!e) return { scored: false, match: false };
  if (a === e) return { scored: true, match: true };
  if (a && e && (a.includes(e) || e.includes(a))) return { scored: true, match: true };
  return { scored: true, match: false };
}

function scoreResult(result, gold) {
  const fields = [];
  for (const fieldPath of FIELD_PATHS) {
    const expected = getByPath(gold, fieldPath);
    if (expected === undefined) continue;
    const actual = getByPath(result, fieldPath);
    const verdict = exactOrContained(actual, expected);
    if (!verdict.scored) continue;
    fields.push({
      path: fieldPath,
      expected,
      actual: actual ?? null,
      match: verdict.match
    });
  }
  const matches = fields.filter(f => f.match).length;
  return {
    scoredFields: fields.length,
    matches,
    accuracy: fields.length ? matches / fields.length : null,
    fields
  };
}

async function waitForResult(id) {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastStatus = null;

  while (Date.now() < deadline) {
    const statusResp = await request({ path: `/api/documents/${id}/status`, timeout: 30000 });
    lastStatus = statusResp.json;
    const status = statusResp.json?.status;
    if (['done', 'complete', 'error', 'failed'].includes(status)) break;
    await sleep(POLL_MS);
  }

  const resultResp = await request({ path: `/api/documents/${id}/result?debug=1`, timeout: 60000 });
  return {
    status: lastStatus,
    result: resultResp.json?.result || resultResp.json || null,
    resultStatus: resultResp.status,
    error: resultResp.json?.error || null
  };
}

function findCases() {
  if (!fs.existsSync(BENCH_DIR) || !fs.statSync(BENCH_DIR).isDirectory()) {
    usageAndExit();
  }

  const cases = fs.readdirSync(BENCH_DIR)
    .filter(name => name.toLowerCase().endsWith('.pdf'))
    .sort()
    .map(name => {
      const pdf = path.join(BENCH_DIR, name);
      const base = name.replace(/\.pdf$/i, '');
      const goldPath = path.join(BENCH_DIR, `${base}.gold.json`);
      return {
        name,
        pdf,
        goldPath,
        gold: fs.existsSync(goldPath)
          ? JSON.parse(fs.readFileSync(goldPath, 'utf8'))
          : null
      };
    });
  return LIMIT > 0 ? cases.slice(0, LIMIT) : cases;
}

function summarize(run, suiteStart) {
  const scored = run.cases.filter(c => c.score?.accuracy != null);
  return {
    totalCases: run.cases.length,
    successfulCases: run.cases.filter(c => c.ok).length,
    scoredCases: scored.length,
    avgAccuracy: scored.length
      ? scored.reduce((sum, c) => sum + c.score.accuracy, 0) / scored.length
      : null,
    totalElapsedMs: performance.now() - suiteStart
  };
}

function writeRun(run, suiteStart) {
  run.summary = summarize(run, suiteStart);
  fs.writeFileSync(OUTPUT, JSON.stringify(run, null, 2));
}

async function main() {
  const cases = findCases();
  if (!cases.length) usageAndExit();

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });

  const suiteStart = performance.now();

  // Resume: load existing output if present
  let existingCases = [];
  if (fs.existsSync(OUTPUT)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
      existingCases = existing.cases || [];
      if (existingCases.length) {
        console.log(`Resuming: found ${existingCases.length} existing case(s) in ${OUTPUT}`);
      }
    } catch {}
  }
  const doneFiles = new Set(existingCases.map(c => c.file));

  const run = {
    createdAt: new Date().toISOString(),
    api: `http://${API_HOST}:${API_PORT}`,
    benchDir: BENCH_DIR,
    env: {
      TEXT_LLM: process.env.TEXT_LLM || null,
      VLM_DIRECT: process.env.VLM_DIRECT || null,
      VLM_MODEL: process.env.VLM_MODEL || null,
      TEXT_MODEL: process.env.TEXT_MODEL || null,
      OCR_SERVICE_URL: process.env.OCR_SERVICE_URL || null
    },
    limit: LIMIT || null,
    cases: [...existingCases]
  };

  console.log(`Benchmarking ${cases.length} PDFs against ${run.api}`);
  console.log(`Output: ${OUTPUT}`);

  for (const testCase of cases) {
    if (doneFiles.has(testCase.name)) {
      console.log(`\nSkipping ${testCase.name} (already done)`);
      continue;
    }
    const started = performance.now();
    console.log(`\nUploading ${testCase.name}`);
    const upload = await uploadPdf(testCase.pdf);
    const id = upload.json?.id;
    if (!id) {
      run.cases.push({
        file: testCase.name,
        ok: false,
        uploadStatus: upload.status,
        error: upload.json?.error || upload.raw
      });
      writeRun(run, suiteStart);
      console.log(`  upload failed (${upload.status})`);
      continue;
    }

    console.log(`  id=${id}; waiting for result`);
    const completed = await waitForResult(id);
    const elapsedMs = performance.now() - started;
    const score = testCase.gold ? scoreResult(completed.result, testCase.gold) : null;

    run.cases.push({
      file: testCase.name,
      id,
      ok: !completed.error,
      elapsedMs,
      terminalStatus: completed.status?.status || null,
      resultStatus: completed.resultStatus,
      score,
      error: completed.error,
      goldPath: testCase.gold ? testCase.goldPath : null,
      result: completed.result || null
    });
    writeRun(run, suiteStart);

    const accuracy = score?.accuracy == null ? 'no gold' : `${(score.accuracy * 100).toFixed(1)}%`;
    console.log(`  done in ${(elapsedMs / 1000).toFixed(1)}s; accuracy=${accuracy}`);
  }

  writeRun(run, suiteStart);
  console.log('\nSummary');
  console.log(JSON.stringify(run.summary, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
