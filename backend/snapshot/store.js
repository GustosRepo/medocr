import fs from 'fs';
import path from 'path';

const SNAPSHOT_PATH = process.env.SNAPSHOT_STORE_PATH || path.join(process.cwd(), 'data', 'snapshots.ndjson');
let loaded = false;
const _snapshots = []; // {id, ts, docId, summary}

function load() {
  if (loaded) return; loaded = true;
  try {
    if (fs.existsSync(SNAPSHOT_PATH)) {
      const lines = fs.readFileSync(SNAPSHOT_PATH,'utf8').split(/\n+/).filter(Boolean);
      for (const l of lines.slice(-500)) { try { _snapshots.push(JSON.parse(l)); } catch {} }
    } else { fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true }); }
  } catch {}
}

export function addSnapshot(docId, result) {
  load();
  const summary = {
    patient: { dob: result?.patient?.dob, hasPhones: !!(result?.patient?.phones?.length), insuranceCount: (result?.insurance||[]).length },
    procedure: { cpt: result?.procedure?.cpt, ambiguous: Array.isArray(result?.procedure?.candidates) && result.procedure.candidates.length>1 },
    flags: result?.flags || {},
    confidence: result?.confidenceDetail?.score
  };
  const rec = { id: `${Date.now()}_${Math.random().toString(36).slice(2,6)}`, ts: new Date().toISOString(), docId, summary };
  _snapshots.push(rec);
  if (_snapshots.length > 500) _snapshots.splice(0, _snapshots.length - 500);
  try { fs.appendFileSync(SNAPSHOT_PATH, JSON.stringify(rec)+'\n'); } catch {}
  // Rotation: if file exceeds ~5MB, rewrite last 300 snapshots
  try {
    const stat = fs.statSync(SNAPSHOT_PATH);
    if (stat.size > 5 * 1024 * 1024) {
      const trimmed = _snapshots.slice(-300);
      fs.writeFileSync(SNAPSHOT_PATH, trimmed.map(r=>JSON.stringify(r)).join('\n')+'\n');
    }
  } catch {}
  return rec;
}

export function recentSnapshots(n=50) { load(); return _snapshots.slice(-n).reverse(); }

export function ambiguousCptRate() {
  load();
  if (!_snapshots.length) return 0;
  const amb = _snapshots.filter(s => s.summary?.procedure?.ambiguous).length;
  return amb / _snapshots.length;
}

export function _resetForTests() { loaded=true; _snapshots.length=0; try { if (fs.existsSync(SNAPSHOT_PATH)) fs.unlinkSync(SNAPSHOT_PATH); } catch {} }
