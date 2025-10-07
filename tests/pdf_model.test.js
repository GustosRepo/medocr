import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../backend/server.js';

function buildExtraction(overrides = {}) {
  return {
    patient: { first: 'Jane', last: 'Doe', dob: '01/02/1970', phones: ['555-111-2222'], email: 'jane@example.com' },
    insurance: [{ carrier: 'Aetna', memberId: 'M123', groupId: 'G9', status: 'active' }],
    procedure: { cpt: '95811', description: 'In-lab titration', providerNotes: ['urgent'] },
    provider: { name: 'Dr Tester', npi: '1234567890', phone: '555-333-4444', fax: '555-333-9999' },
    clinical: { primaryDiagnosis: { code: 'G47.33', description: 'OSA' }, symptoms: ['snoring'], vitals: { bmi: '31', bp: '120/70', weightLbs: 200, height: "5'9" } },
    infoAlerts: { ppeRequired: true, safety: ['fall risk'], communication: ['spanish'], accommodations: ['wheelchair'] },
    flags: { reasons: ['missing_chart_notes'], verifyManually: true },
    alerts: { actions: ['missing_chart_notes','verify_insurance'] },
    qc: { nameConsistency: 'pass', dateValidity: 'pass', phoneValidity: 'pass', cptValid: 'pass' },
    confidence: 'High',
    documentMeta: { intakeDate: '2025-01-15', pages: 2, authorizationNotes: ['Need prior auth before scheduling'] },
    ...overrides
  };
}

let injectedId = 'doc_pdf_model_fixture';

test('pdfModel build & core fields', async () => {
  const payload = { id: injectedId, result: buildExtraction() };
  const res = await request(app).post('/api/test/inject').send(payload);
  assert.equal(res.status, 200);
  assert(res.body.ok, 'inject ok');
  const resultRes = await request(app).get(`/api/documents/${injectedId}/result`);
  assert.equal(resultRes.status, 200);
  assert(resultRes.body.pdfModel, 'pdfModel present');
  const m = resultRes.body.pdfModel;
  assert.equal(m.patient.last, 'Doe');
  assert.equal(m.insurance.primary.carrier, 'Aetna');
  assert.ok(Array.isArray(m.missing));
});

test('patient PDF markers present', async () => {
  const pdfRes = await request(app).get(`/api/documents/${injectedId}/summary.pdf`).buffer().parse((res, callback)=>{
    const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>callback(null,Buffer.concat(chunks)));});
  assert.equal(pdfRes.status, 200);
  const text = pdfRes.body.toString('latin1');
  assert(text.includes('REFERRAL_SUMMARY_MARKER'));
  assert(text.includes('SECTION_DEMOGRAPHICS'));
});

test('bulk export zip returns local file header', async () => {
  const zipRes = await request(app)
    .post('/api/documents/bulk-export.zip')
    .set('Accept', 'application/zip')
    .buffer(true)
    .parse((res, callback) => { const chunks=[]; res.on('data',c=>chunks.push(c)); res.on('end',()=>callback(null,Buffer.concat(chunks))); })
    .send({ ids: [injectedId] });
  assert.equal(zipRes.status, 200);
  const b = zipRes.body;
  assert.ok(Buffer.isBuffer(b), 'response not buffer');
  assert.equal(b[0], 0x50); // 'P'
  assert.equal(b[1], 0x4b); // 'K'
});

test('backfill pdfModel endpoint', async () => {
  const res = await request(app).post('/api/admin/backfill-pdf-models').send({});
  assert.equal(res.status, 200);
  assert(res.body.ok);
});
