import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../backend/server.js';

test('dashboard serves HTML', async () => {
  const res = await request(app).get('/dashboard');
  assert.equal(res.status, 200);
  assert.match(res.text, /MEDOCR Analytics/);
  assert.match(res.text, /<html/i);
});
