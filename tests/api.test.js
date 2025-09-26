import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import app from '../backend/server.js';

const schema = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'docs/schema/extraction_result.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

test('GET /api/health works', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('POST /api/documents enqueues', async () => {
  const res = await request(app).post('/api/documents').attach('file', Buffer.from('pdf'), 'sample.pdf');
  assert.equal(res.status, 202);
  assert.match(res.body.id, /^doc_/);
});

test('GET /api/documents/:id/status progresses to error when OCR is unavailable', async () => {
  // Upload a file to trigger processing
  const up = await request(app).post('/api/documents').attach('file', Buffer.from('%PDF-1.4\n'), 'sample.pdf');
  assert.equal(up.status, 202);
  const id = up.body.id;
  // Poll a few times until status is error or done
  let status = 'queued';
  for (let i = 0; i < 10; i++) {
    const res = await request(app).get(`/api/documents/${id}/status`);
    assert.equal(res.status, 200);
    status = res.body.status;
    if (status === 'error' || status === 'done') break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(['error', 'done'].includes(status));
});

test('GET /api/documents/:id/result returns error when OCR failed', async () => {
  const up = await request(app).post('/api/documents').attach('file', Buffer.from('%PDF-1.4\n'), 'sample.pdf');
  assert.equal(up.status, 202);
  const id = up.body.id;
  // Wait until processing completes or errors
  for (let i = 0; i < 15; i++) {
    const st = await request(app).get(`/api/documents/${id}/status`);
    if (st.body.status === 'error') break;
    if (st.body.status === 'done') break;
    await new Promise(r => setTimeout(r, 100));
  }
  const res = await request(app).get(`/api/documents/${id}/result`);
  // When OCR service isn't running, expect a 502 error
  if (res.status === 200) {
    // If by chance OCR is available, validate schema
    const valid = validate(res.body);
    if (!valid) console.error(validate.errors);
    assert.equal(valid, true);
  } else {
    assert.equal(res.status, 502);
    assert.equal(res.body.error?.code, 'ocr_failed');
  }
});

test('GET /api/batch/:date/summary returns expected shape', async () => {
  const res = await request(app).get('/api/batch/2025-09-24/summary');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.patients));
});

test('GET /api/forms/:id/:type returns pdf', async () => {
  const res = await request(app).get('/api/forms/doc_1/patient');
  assert.equal(res.status, 200);
  assert.equal(res.header['content-type'], 'application/pdf');
});

test('GET /api/coverage works', async () => {
  const res = await request(app).get('/api/coverage');
  assert.equal(res.status, 200);
  assert.ok(res.body.summary);
  assert.ok(Array.isArray(res.body.items));
  const statuses = new Set(res.body.items.map(i => i.status));
  assert.ok(['met','partial','gap'].some(s => statuses.has(s)));
});
