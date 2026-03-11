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

test('correlation id middleware assigns request id', async () => {
  const res = await request(app).get('/api/health');
  // Cannot read server-side req.id from client, but ensure second call also succeeds (smoke for middleware)
  const res2 = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res2.status, 200);
});

test('POST /api/documents enqueues', async () => {
  const res = await request(app).post('/api/documents').attach('file', Buffer.from('pdf'), 'sample.pdf');
  assert.equal(res.status, 202);
  assert.match(res.body.id, /^doc_/);
});

test('GET /api/documents/:id/status progresses to terminal state when OCR is unavailable', async () => {
  // Upload a file to trigger processing
  const up = await request(app).post('/api/documents').attach('file', Buffer.from('%PDF-1.4\n'), 'sample.pdf');
  assert.equal(up.status, 202);
  const id = up.body.id;
  // Poll a few times until status is error or done
  let status = 'queued';
  for (let i = 0; i < 20; i++) {
    const res = await request(app).get(`/api/documents/${id}/status`);
    assert.equal(res.status, 200);
    status = res.body.status;
    if (status === 'error' || status === 'done') break;
    await new Promise(r => setTimeout(r, 150));
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

test('GET /api/documents/:id/fhir returns Bundle after processing', async () => {
  // Inject a minimal processed doc
  const inj = await request(app).post('/api/test/inject').send({ id: 'doc_fhir', result: { patient: { first: 'Jane', last: 'Doe', phones: ['(111) 222-3333'] }, procedure: { cpt: '95810', description: 'In-lab diagnostic polysomnography' }, clinical: { primaryDiagnosis: { code: 'G47.33', description: 'Obstructive sleep apnea' } }, alerts: { actions: [] }, flags: { verifyManually: false, reasons: [] } } });
  assert.equal(inj.status, 200);
  const res = await request(app).get('/api/documents/doc_fhir/fhir');
  assert.equal(res.status, 200);
  assert.equal(res.body.resourceType, 'Bundle');
  const dr = (res.body.entry||[]).find(e => e.resource && e.resource.resourceType === 'DiagnosticReport');
  assert.ok(dr, 'DiagnosticReport missing');
});

// E2E sanity: inject → retrieve result → assert key fields present
test('E2E: inject document and retrieve result with key fields', async () => {
  const sampleResult = {
    patient: { first: 'John', last: 'Smith', dob: '03/15/1985', phones: ['5551234567'], email: 'john@example.com' },
    insurance: [{ carrier: 'Blue Cross', memberId: 'BCX123456', groupId: 'GRP001', planType: 'PPO' }],
    provider: { name: 'Dr. Sarah Jones MD', npi: '1234567890', phone: '5559876543', fax: '5559876544' },
    procedure: { cpt: '95810', description: 'In-lab diagnostic polysomnography' },
    diagnoses: [{ code: 'G47.33', description: 'Obstructive sleep apnea' }],
    clinical: { primaryDiagnosis: { code: 'G47.33', description: 'Obstructive sleep apnea' }, reasonForReferral: 'Suspected OSA' },
    confidence: 'High',
    alerts: { actions: [] },
    flags: { verifyManually: false, reasons: [] },
    documentMeta: { suggestedFilename: 'Smith_John_03151985.pdf' }
  };

  const inj = await request(app).post('/api/test/inject').send({ id: 'doc_e2e_sanity', result: sampleResult });
  assert.equal(inj.status, 200);
  assert.equal(inj.body.ok, true);

  // Retrieve the result
  const res = await request(app).get('/api/documents/doc_e2e_sanity/result');
  assert.equal(res.status, 200);

  // Assert key fields are present
  assert.equal(res.body.patient?.first, 'John');
  assert.equal(res.body.patient?.last, 'Smith');
  assert.equal(res.body.patient?.dob, '03/15/1985');
  assert.ok(res.body.insurance?.[0]?.carrier, 'insurance carrier missing');
  assert.ok(res.body.provider?.name, 'provider name missing');
  assert.equal(res.body.procedure?.cpt, '95810');
  assert.ok(res.body.diagnoses?.length > 0, 'diagnoses missing');
  assert.ok(res.body.confidence, 'confidence missing');
  assert.ok(res.body.documentMeta?.suggestedFilename, 'suggestedFilename missing');
});

// Error taxonomy: all error responses must include category field
test('API error responses include category field', async () => {
  // 404 error
  const notFound = await request(app).get('/api/documents/nonexistent_id_xyz/result');
  assert.equal(notFound.body.error?.category, 'user', 'not_found should be user category');

  // 400 error (no file)
  const noFile = await request(app).post('/api/documents');
  assert.equal(noFile.body.error?.category, 'user', 'no_file should be user category');
});
