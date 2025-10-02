import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../backend/server.js';
import { _resetForTests } from '../backend/feedback/store.js';

// Basic feedback ingestion lifecycle

test('feedback ingestion: create, list, stats', async () => {
  _resetForTests();
  // Create two feedback records for two different fields
  const r1 = await request(app).post('/api/feedback').send({ docId: 'doc_fb1', path: 'patient.dob', previousValue: '01/01/1970', newValue: '01/02/1970', reason: 'Typo', user: 'qa_user' });
  assert.equal(r1.status, 201);
  assert.equal(r1.body.ok, true);
  const r2 = await request(app).post('/api/feedback').send({ docId: 'doc_fb1', path: 'procedure.cpt', previousValue: '95810', newValue: '95811', reason: 'Titration evidence present', user: 'qa_user' });
  assert.equal(r2.status, 201);

  // List for doc
  const list = await request(app).get('/api/feedback').query({ docId: 'doc_fb1' });
  assert.equal(list.status, 200);
  assert.equal(list.body.records.length, 2);
  const paths = new Set(list.body.records.map(r => r.path));
  assert.ok(paths.has('patient.dob') && paths.has('procedure.cpt'));

  // Stats
  const stats = await request(app).get('/api/feedback/stats');
  assert.equal(stats.status, 200);
  assert.equal(stats.body.total, 2);
  assert.ok(stats.body.byPath['patient.dob'] === 1);
  assert.ok(stats.body.byPath['procedure.cpt'] === 1);
});
