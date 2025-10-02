import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import app from '../backend/server.js';
import { _resetForTests as resetMetrics, _forceFlush } from '../backend/metrics/store.js';

const METRICS_PATH = process.env.METRICS_STORE_PATH || path.join(process.cwd(), 'data', 'metrics.json');

// This test validates that metrics file is created and accumulates counters.

test('metrics persistence file accumulates counters', async () => {
  resetMetrics();
  try { if (fs.existsSync(METRICS_PATH)) fs.unlinkSync(METRICS_PATH); } catch {}
  // Trigger two queued docs (will fail OCR, increment docsQueued + docsErrored)
  for (let i=0;i<2;i++) {
    const up = await request(app).post('/api/documents').attach('file', Buffer.from('%PDF-1.4\n'), `m${i}.pdf`);
    assert.equal(up.status, 202);
    const id = up.body.id;
    // wait for processing to fail
    for (let j=0;j<15;j++) {
      const st = await request(app).get(`/api/documents/${id}/status`);
      if (st.body.status === 'error') break;
      await new Promise(r=>setTimeout(r,50));
    }
  }
  const metricsRes = await request(app).get('/api/metrics');
  assert.equal(metricsRes.status, 200);
  assert.ok(metricsRes.body.counters.docsQueued >= 2, 'docsQueued not incremented');
  assert.ok(metricsRes.body.counters.docsErrored >= 2, 'docsErrored not incremented');
  // File exists
  assert.ok(fs.existsSync(METRICS_PATH), 'metrics file missing');
  _forceFlush();
  const contents = JSON.parse(fs.readFileSync(METRICS_PATH,'utf8'));
  assert.ok(contents.counters.docsQueued >= 2, 'metrics file counters not flushed');
});
