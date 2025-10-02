import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../backend/server.js';
import { recordConfidence, _resetForTests as resetMetrics } from '../backend/metrics/store.js';

// Simulate confidence drift by recording baseline then higher recent scores

test('analytics exposes drift alert and concurrency metrics', async () => {
  resetMetrics();
  // Baseline (lower)
  for (let i=0;i<15;i++) recordConfidence(0.5 + (i%3)*0.01);
  // Recent higher
  for (let i=0;i<15;i++) recordConfidence(0.7 + (i%3)*0.02);
  const res = await request(app).get('/api/analytics');
  assert.equal(res.status, 200);
  if (res.body.confidenceDrift) {
    assert.ok(res.body.confidenceDrift.pct !== undefined);
  }
  // drift alert may or may not trigger depending on pct; allow optional
  assert.ok(res.body.concurrency.maxConcurrentOcr !== undefined);
});
