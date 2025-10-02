import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../backend/server.js';
import { _resetForTests as resetFeedback } from '../backend/feedback/store.js';

// Test acceptance rate & suggestions

test('feedback acceptance and suggestions', async () => {
  resetFeedback();
  await request(app).post('/api/feedback').send({ docId:'d1', path:'procedure.cpt', previousValue:'95810', newValue:'95811', accepted:true });
  await request(app).post('/api/feedback').send({ docId:'d2', path:'procedure.cpt', previousValue:'95810', newValue:'95811', accepted:true });
  await request(app).post('/api/feedback').send({ docId:'d3', path:'patient.dob', previousValue:'01/01/1970', newValue:'01/02/1970', accepted:false });
  const analytics = await request(app).get('/api/analytics');
  assert.equal(analytics.status, 200);
  assert.ok(analytics.body.feedback.acceptanceRate > 0);
  const suggestion = analytics.body.feedback.suggestions.find(s => s.path==='procedure.cpt');
  assert.ok(suggestion && suggestion.suggestedValue==='95811');
});
