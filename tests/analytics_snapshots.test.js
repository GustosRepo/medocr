import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../backend/server.js';
import { _resetForTests as resetSnapshots } from '../backend/snapshot/store.js';

// Inject documents with ambiguous / unambiguous CPT candidates and verify analytics ambiguous rate surface

test('analytics ambiguous CPT rate via snapshots', async () => {
  resetSnapshots();
  // Unambiguous
  await request(app).post('/api/test/inject').send({ id: 'doc_a1', result: { patient: { first:'A' }, procedure: { cpt: '95810', description: 'Sleep study' }, flags:{}, alerts:{actions:[]}, confidenceDetail:{score:0.9} } });
  // Ambiguous (multiple candidates)
  await request(app).post('/api/test/inject').send({ id: 'doc_a2', result: { patient: { first:'B' }, procedure: { cpt: '95810', candidates:[{code:'95810',score:0.7},{code:'95811',score:0.6}] }, flags:{}, alerts:{actions:[]}, confidenceDetail:{score:0.85} } });
  const res = await request(app).get('/api/analytics');
  assert.equal(res.status, 200);
  assert.ok(res.body.derived.ambiguousCptRate >= 0);
  // Expect ambiguous rate between 0 and 1 and at least >0 for this setup
  assert.ok(res.body.derived.ambiguousCptRate > 0, 'ambiguous rate should be >0');
  assert.ok(Array.isArray(res.body.snapshots.recent), 'recent snapshots missing');
});
