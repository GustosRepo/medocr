import fs from 'fs';
import path from 'path';

const METRICS_PATH = process.env.METRICS_STORE_PATH || path.join(process.cwd(), 'data', 'metrics.json');

const state = {
  counters: {
    docsQueued: 0,
    docsProcessed: 0,
    docsErrored: 0,
    ocrTimeouts: 0,
    ocrFailures: 0,
    apiErrorsUser: 0,
    apiErrorsExternal: 0,
    apiErrorsSystem: 0
  },
  extractionLatencyMs: [],
  confidenceSamples: [],
  maxConcurrentOcr: 0,
  lastFlush: 0
};

let loaded = false;
function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(METRICS_PATH)) {
      const json = JSON.parse(fs.readFileSync(METRICS_PATH, 'utf8'));
      Object.assign(state.counters, json.counters || {});
  state.extractionLatencyMs = Array.isArray(json.extractionLatencyMs) ? json.extractionLatencyMs : [];
  state.confidenceSamples = Array.isArray(json.confidenceSamples) ? json.confidenceSamples : [];
    } else {
      fs.mkdirSync(path.dirname(METRICS_PATH), { recursive: true });
    }
  } catch {
    // ignore load issues
  }
}

function flush(force=false) {
  const now = Date.now();
  const isTest = process.env.NODE_ENV === 'test' || process.argv.some(a=>a.includes('--test'));
  if (!force && !isTest && now - state.lastFlush < 5000) return; // throttle 5s (not in test)
  state.lastFlush = now;
  try {
    fs.writeFileSync(METRICS_PATH, JSON.stringify({
      counters: state.counters,
      extractionLatencyMs: state.extractionLatencyMs.slice(-500),
      confidenceSamples: state.confidenceSamples.slice(-500)
    }, null, 2));
  } catch {
    // ignore
  }
}

export function incCounter(name, delta=1) {
  load();
  if (!state.counters[name] && state.counters[name] !== 0) state.counters[name] = 0;
  state.counters[name] += delta;
  flush();
}

export function recordLatency(ms) {
  load();
  state.extractionLatencyMs.push(ms);
  if (state.extractionLatencyMs.length > 500) state.extractionLatencyMs.splice(0, state.extractionLatencyMs.length - 500);
  flush();
}

export function snapshot() {
  load();
  const arr = state.extractionLatencyMs;
  let dist = { count: 0 };
  if (arr.length) {
    const sorted = [...arr].sort((a,b)=>a-b);
    const pick = (p)=> sorted[Math.min(sorted.length-1, Math.floor(p*(sorted.length-1)))];
    dist = { count: arr.length, p50: pick(0.5), p90: pick(0.9), p95: pick(0.95), max: sorted[sorted.length-1] };
  }
  // Confidence drift
  const conf = state.confidenceSamples;
  let drift = null;
  if (conf.length >= 10) {
    const base = conf.slice(0, Math.min(20, conf.length));
    const recent = conf.slice(-Math.min(20, conf.length));
    const avg = a => a.reduce((s,v)=>s+v,0)/a.length;
    const baseAvg = avg(base);
    const recentAvg = avg(recent);
    const delta = recentAvg - baseAvg;
    const pct = baseAvg ? delta / baseAvg : 0;
    drift = { baseAvg, recentAvg, delta, pct };
  }
  let driftAlert = null;
  if (drift && Math.abs(drift.pct) > 0.10) {
    driftAlert = { level: 'warn', message: `Confidence drift ${(drift.pct*100).toFixed(1)}% vs baseline` };
  }
  return { counters: state.counters, extractionLatency: dist, confidenceDrift: drift, confidenceDriftAlert: driftAlert, concurrency: { maxConcurrentOcr: state.maxConcurrentOcr } };
}

export function _resetForTests() {
  loaded = true; // prevent reload
  for (const k of Object.keys(state.counters)) state.counters[k] = 0;
  state.extractionLatencyMs = [];
  state.confidenceSamples = [];
  try { if (fs.existsSync(METRICS_PATH)) fs.unlinkSync(METRICS_PATH); } catch {}
}

export function _forceFlush() { flush(true); }

export function recordConfidence(score) {
  load();
  if (typeof score === 'number' && !Number.isNaN(score)) {
    state.confidenceSamples.push(score);
    if (state.confidenceSamples.length > 500) state.confidenceSamples.splice(0, state.confidenceSamples.length - 500);
  }
  flush();
}

export function recordConcurrency(current) {
  load();
  if (current > state.maxConcurrentOcr) state.maxConcurrentOcr = current;
  flush();
}
