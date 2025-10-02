import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../backend/server.js';
import { _resetForTests as resetMetrics, _forceFlush } from '../backend/metrics/store.js';
import { _resetForTests as resetFeedback } from '../backend/feedback/store.js';

// Analytics endpoint basic shape

test('analytics endpoint aggregates metrics and feedback', async () => {
  resetMetrics();
  resetFeedback();
  // Create feedback entries
  await request(app).post('/api/feedback').send({ docId: 'd1', path: 'patient.dob', previousValue: '01/01/1970', newValue: '01/02/1970' });
  await request(app).post('/api/feedback').send({ docId: 'd2', path: 'procedure.cpt', previousValue: '95810', newValue: '95811' });
  _forceFlush();
  const res = await request(app).get('/api/analytics');
  assert.equal(res.status, 200);
  assert.ok(res.body.metrics, 'metrics missing');
  assert.ok(res.body.feedback.total >= 2, 'feedback total incorrect');
  assert.ok(Array.isArray(res.body.feedback.topPaths), 'topPaths missing');
  assert.ok(res.body.derived.manualCorrectionRate >= 0, 'manualCorrectionRate missing');
});
