import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../backend/server.js';

// Validate Practitioner, Organization, Provenance presence in FHIR bundle

test('FHIR export includes Practitioner, Organization, Provenance', async () => {
  await request(app).post('/api/test/inject').send({ id: 'doc_fhir_exp', result: { patient: { first: 'Ann', last: 'Example', phones: ['(111) 222-3333'] }, procedure: { cpt: '95810', description: 'Sleep Study' }, clinical: { primaryDiagnosis: { code: 'G47.33', description: 'Obstructive sleep apnea' } }, provider: { name: 'Dr. Smith', phone: '(999) 888-7777' }, insurance: [ { carrier: 'Aetna', memberId: 'M1' } ], alerts: { actions: [] }, flags: { verifyManually: false, reasons: [] } } });
  const res = await request(app).get('/api/documents/doc_fhir_exp/fhir');
  assert.equal(res.status, 200);
  const types = new Set((res.body.entry||[]).map(e=>e.resource?.resourceType));
  assert.ok(types.has('Practitioner'), 'Practitioner missing');
  assert.ok(types.has('Organization'), 'Organization missing');
  assert.ok(types.has('Provenance'), 'Provenance missing');
});
