// Simple feedback store with newline-delimited JSON persistence
// Shape of a feedback record:
// { id, ts, docId, path, previousValue, newValue, reason, user, accepted?, type? }

import fs from 'fs';
import path from 'path';

const _records = [];
let _counter = 0;
const FEEDBACK_PATH = process.env.FEEDBACK_STORE_PATH || path.join(process.cwd(), 'data', 'feedback.ndjson');
let _loaded = false;

function ensureLoaded() {
  if (_loaded) return;
  _loaded = true;
  try {
    if (fs.existsSync(FEEDBACK_PATH)) {
      const lines = fs.readFileSync(FEEDBACK_PATH, 'utf8').split(/\n+/).filter(Boolean);
      for (const line of lines) {
        try { const obj = JSON.parse(line); _records.push(obj); } catch { /* ignore */ }
      }
      _counter = _records.length;
    } else {
      fs.mkdirSync(path.dirname(FEEDBACK_PATH), { recursive: true });
    }
  } catch (e) {
    // If load fails, operate in memory only
  }
}

function appendLine(obj) {
  try {
    fs.appendFileSync(FEEDBACK_PATH, JSON.stringify(obj) + '\n');
    // Rotate if >5MB
    const stat = fs.statSync(FEEDBACK_PATH);
    if (stat.size > 5 * 1024 * 1024) {
      const trimmed = _records.slice(-1000); // keep last 1000 feedbacks
      fs.writeFileSync(FEEDBACK_PATH, trimmed.map(r=>JSON.stringify(r)).join('\n')+'\n');
    }
  } catch {
    // ignore persistence errors silently (could add metric)
  }
}

function classifyType(path) {
  if (/procedure\.cpt/.test(path)) return 'cpt';
  if (/diagnosis|icd/i.test(path)) return 'diagnosis';
  if (/insurance|coverage/i.test(path)) return 'insurance';
  if (/patient\.dob/.test(path)) return 'demographic';
  return 'other';
}

export function addFeedback({ docId, path, previousValue, newValue, reason, user, accepted }) {
  ensureLoaded();
  const id = `fb_${Date.now()}_${_counter++}`;
  const rec = { id, ts: new Date().toISOString(), docId, path, previousValue, newValue, reason, user, accepted: accepted ?? null, type: classifyType(path) };
  _records.push(rec);
  appendLine(rec);
  return rec;
}

export function listFeedback({ docId } = {}) {
  ensureLoaded();
  if (docId) return _records.filter(r => r.docId === docId);
  return [..._records];
}

export function stats() {
  ensureLoaded();
  const byPath = {};
  let accepted=0, decided=0;
  const byType = {};
  for (const r of _records) {
    byPath[r.path] = (byPath[r.path] || 0) + 1;
    byType[r.type] = (byType[r.type] || 0) + 1;
    if (r.accepted === true) { accepted++; decided++; }
    else if (r.accepted === false) { decided++; }
  }
  const acceptanceRate = decided ? accepted/decided : 0;
  // Suggestions: top paths where newValue differs frequently and accepted
  const changeMap = {};
  for (const r of _records) {
    if (r.accepted) {
      const key = r.path + '::' + r.newValue;
      changeMap[key] = (changeMap[key] || 0) + 1;
    }
  }
  const suggestions = Object.entries(changeMap)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,5)
    .map(([k,count]) => { const [p,val] = k.split('::'); return { path:p, suggestedValue:val, occurrences:count }; });
  return {
    total: _records.length,
    byPath,
    byType,
    acceptanceRate,
    suggestions,
    recent: _records.slice(-10).reverse()
  };
}

// Test helper to reset (not exposed in production usage)
export function _resetForTests() {
  _records.length = 0;
  _counter = 0;
  _loaded = true; // prevent reload from file during tests
  try { if (fs.existsSync(FEEDBACK_PATH)) fs.unlinkSync(FEEDBACK_PATH); } catch {}
}
