#!/usr/bin/env node
import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { performance } from 'perf_hooks';
import { incCounter, recordLatency, snapshot as metricsSnapshot, recordConfidence, recordConcurrency } from './metrics/store.js';
import crypto from 'crypto';
import { addSnapshot, ambiguousCptRate, recentSnapshots } from './snapshot/store.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { runExtraction, runExtractionWithDates } from './rules/index.js';
import { log, withReq, classifyError } from './logging/logger.js';
import { toFhirBundle } from './fhir/export.js';
import { listBatchDates, collectBatchDocs as collectDocsSvc, summarizeActions as summarizeActionsSvc, buildCoverJson, buildProblemLogJson, renderCoverPdf, renderProblemLogPdf, renderPatientPdf } from './batch/report.js';
import { mapAction, mapActions } from './actionMap.js';
import { addFeedback, listFeedback, stats as feedbackStats } from './feedback/store.js';
import { buildCoverage } from './coverage.js';

const app = express();
app.use(express.json({ limit: process.env.BODY_SIZE_LIMIT || '256kb' }));
// Static dashboard assets
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
app.use('/static', express.static(path.join(__dirname, 'public')));
app.get('/dashboard', (_req,res) => {
  res.sendFile(path.join(__dirname,'public','dashboard.html'));
});

// Metrics moved to persistent store (metrics/store.js)
// Correlation ID middleware
let _ridCounter = 0;
app.use((req, res, next) => { req.id = `r${Date.now().toString(36)}_${(_ridCounter++).toString(36)}`; next(); });
// Detect test environment either via NODE_ENV or node --test runner flag
const IS_TEST = process.env.NODE_ENV === 'test' || process.argv.some(a => a.includes('--test'));
// Basic in-memory rate limiter (sliding window) to protect OCR endpoint fan-out
const RATE_WINDOW_MS = parseInt(process.env.RATE_WINDOW_MS || '60000', 10);
const RATE_MAX = parseInt(process.env.RATE_MAX || '120', 10); // max requests per window
const rateBuckets = new Map(); // key -> array of timestamps
function rateLimit(key) {
  const now = Date.now();
  const arr = rateBuckets.get(key) || [];
  const fresh = arr.filter(ts => now - ts < RATE_WINDOW_MS);
  fresh.push(now);
  rateBuckets.set(key, fresh);
  return fresh.length <= RATE_MAX;
}
app.use((req, res, next) => {
  // Skip rate limiting in tests for determinism
  if (IS_TEST) return next();
  const key = req.ip || 'global';
  if (!rateLimit(key)) {
    return res.status(429).json({ error: { code: 'rate_limited', message: `Too many requests (>${RATE_MAX}/min)` } });
  }
  next();
});
const uploadDir = path.join(process.cwd(), 'data', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });
const port = process.env.PORT || 4387;
const ocrServiceUrl = process.env.OCR_SERVICE_URL || 'http://127.0.0.1:8000';
// Concurrency guard for OCR calls
const OCR_MAX_CONCURRENCY = parseInt(process.env.OCR_MAX_CONCURRENCY || '4', 10);
let ocrInFlight = 0;
const ocrQueue = [];
function scheduleOcr(fn) {
  return new Promise((resolve, reject) => {
    const task = async () => {
      try {
        ocrInFlight++;
        resolve(await fn());
      } catch (e) { reject(e); }
      finally {
        ocrInFlight--;
        if (ocrQueue.length) {
          const next = ocrQueue.shift();
          setTimeout(next,0);
        }
      }
    };
  if (ocrInFlight < OCR_MAX_CONCURRENCY) { recordConcurrency(ocrInFlight+1); task(); } else { ocrQueue.push(() => { recordConcurrency(ocrInFlight+1); task(); }); }
  });
}

// In-memory doc store for dev
const docs = new Map(); // id -> { filePath, status, result, error }

// In-memory checklist overrides: id -> { note, category, updatedAt }
// category: 'ready' | 'attention'
const checklistOverrides = new Map();

// List recent documents (simple in-memory enumeration) for checklist dashboard
app.get('/api/documents', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100',10), 500);
  const items = [];
  for (const [id, entry] of Array.from(docs.entries()).reverse()) { // newest first (id contains timestamp)
    const r = entry.result || {};
    const p = r.patient || {};
    items.push({
      id,
      status: entry.status,
      last: p.last || null,
      first: p.first || null,
      dob: p.dob || null,
      intakeDate: r.documentMeta?.intakeDate || null,
      confidence: r.confidenceLevel || r.confidence || null,
      manual: !!r.flags?.verifyManually,
      actions: (r.alerts?.actions || []).slice(0,5),
      suggestedFilename: r.documentMeta?.suggestedFilename || null
    });
    if (items.length >= limit) break;
  }
  res.json({ items, count: items.length });
});

// Patient checklist (optionally filter by intake date ?date=YYYY-MM-DD)
app.get('/api/checklist', (req, res) => {
  const dateFilter = req.query.date;
  const limit = Math.min(parseInt(req.query.limit || '500', 10), 1000);
  const includeArchived = req.query.includeArchived === '1' || req.query.includeArchived === 'true';
  const statusFilterRaw = (req.query.status || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean); // ready|attention|processing|error
  const insuranceFilterRaw = (req.query.insurance || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  const rows = [];
  const forms = { insuranceVerification: 0, authorizationRequests: 0, utsReferrals: 0, providerFollowUps: 0, patientContacts: 0 };
  let processed = 0, additionalActions = 0, readyToSchedule = 0;
  // Iterate newest-first similar to documents listing
  for (const [id, entry] of Array.from(docs.entries()).reverse()) {
    if (entry.status !== 'done' || !entry.result) continue;
    const r = entry.result;
    if (dateFilter && r.documentMeta?.intakeDate !== dateFilter) continue;
    processed++;
    const p = r.patient || {};
    const insArr = Array.isArray(r.insurance) ? r.insurance : [];
    const primaryIns = insArr[0] || {};
    const actionsRaw = r.alerts?.actions || [];
    const problem = r.flags?.verifyManually || actionsRaw.length > 0;
    if (problem) additionalActions++; else readyToSchedule++;
    for (const a of actionsRaw) {
      if (/verify_insurance|insurance_verification/i.test(a)) forms.insuranceVerification++;
      if (/prior_auth|authorization_required|submit_auth/i.test(a)) forms.authorizationRequests++;
      if (/uts|out_of_network/i.test(a)) forms.utsReferrals++;
      if (/provider_follow|obtain_additional/i.test(a)) forms.providerFollowUps++;
      if (/contact_patient|missing_demographics|call_patient/i.test(a)) forms.patientContacts++;
    }
  const prettyActs = mapActions(actionsRaw);
  const override = checklistOverrides.get(id) || null;
    // Derive effective category (consider override if present)
    const effectiveCategory = (() => {
      if (override?.category) return override.category; // user override takes precedence
      if (entry.status === 'error') return 'error';
      if (entry.status === 'queued' || entry.status === 'processing') return 'processing';
      if (problem) return 'attention';
      return 'ready';
    })();
    if (statusFilterRaw.length && !statusFilterRaw.includes(effectiveCategory)) continue;
    const carrierLc = (primaryIns.carrier || '').toLowerCase();
    if (insuranceFilterRaw.length && !insuranceFilterRaw.includes(carrierLc)) continue;
    if (override?.archived && !includeArchived) continue;
    rows.push({
      id,
      status: entry.status,
      error: entry.status === 'error' ? entry.error || null : null,
      name: [p.last, p.first].filter(Boolean).join(', ') || 'Unknown',
      last: p.last || null,
      first: p.first || null,
      dob: p.dob || '—',
      intakeDate: r.documentMeta?.intakeDate || null,
      insurance: primaryIns.carrier || '—',
      memberId: primaryIns.memberId || '—',
      actions: prettyActs,
      actionsRaw,
      confidence: r.confidenceLevel || r.confidence || null,
      manual: !!r.flags?.verifyManually,
      none: !problem,
      override,
      archived: !!override?.archived,
      effectiveCategory
    });
    if (rows.length >= limit) break;
  }
  res.json({
    date: dateFilter || null,
    items: rows,
    count: rows.length,
    forms,
    totals: { processed, readyToSchedule, additionalActions }
  });
});

// Update checklist override
app.patch('/api/checklist/:id', (req, res) => {
  const { id } = req.params;
  if (!docs.has(id)) return res.status(404).json({ error: { code: 'not_found', message: 'document not found' } });
  const { note, category, status, archived } = req.body || {};
  const cat = category || status; // support either field name
  if (cat && !['ready','attention','processing','error'].includes(cat)) {
    return res.status(400).json({ error: { code: 'invalid_category', message: 'category must be one of ready|attention|processing|error' } });
  }
  const existing = checklistOverrides.get(id) || {};
  const updated = { ...existing };
  if (note !== undefined) updated.note = String(note).slice(0, 1000);
  if (cat) updated.category = cat; else if (cat === null) delete updated.category;
  if (archived !== undefined) updated.archived = !!archived;
  updated.updatedAt = new Date().toISOString();
  checklistOverrides.set(id, updated);
  res.json({ ok: true, id, override: updated });
});

// Already added JSON parser with limit above
app.use((req, _res, next) => { req.logger = withReq(req); next(); });

// Health
app.get('/api/health', (req, res) => { req.logger?.debug('health'); res.json({ status: 'ok' }); });

// Coverage (dev): summarize requirement coverage
app.get('/api/coverage', (req, res) => {
  try {
    const cov = buildCoverage();
    res.json(cov);
  } catch (e) {
    res.status(500).json({ error: { code: 'coverage_failed', message: String(e.message || e) } });
  }
});

// Upload PDF (stub: ignores file content, returns queued)
app.post('/api/documents', upload.single('file'), async (req, res) => {
  if (!req.file) {
  req.logger?.warn('upload_no_file');
  return res.status(400).json({ error: { code: 'no_file', message: 'No file uploaded' } });
  }
  // Accept common pdf mimetypes
  const mt = req.file.mimetype || '';
  const looksLikePdfType = mt === 'application/pdf' || mt === 'application/octet-stream';
  if (!looksLikePdfType && process.env.NODE_ENV !== 'test') {
  req.logger?.warn('upload_invalid_type', { mt });
  return res.status(400).json({ error: { code: 'invalid_type', message: `Only PDF files are supported (got ${mt || 'unknown'})` } });
  }
  // Always count queued document
  incCounter('docsQueued');
  // Quick magic header check (skip in tests)
  if (process.env.NODE_ENV !== 'test') {
    try {
      const fd = await fs.promises.open(req.file.path, 'r');
  const { buffer } = await fd.read(Buffer.alloc(5), 0, 5, 0);
      await fd.close();
      const head = buffer.toString('utf8');
      if (!head.startsWith('%PDF')) {
        req.logger?.warn('upload_invalid_pdf');
        return res.status(400).json({ error: { code: 'invalid_pdf', message: 'Uploaded file is not a valid PDF' } });
      }
    } catch (e) {
      return res.status(400).json({ error: { code: 'read_error', message: 'Could not read uploaded file' } });
    }
  }
  const id = `doc_${Date.now()}`;
  const filePath = req.file?.path;
  const originalName = req.file?.originalname;
  docs.set(id, { filePath, originalName, status: 'queued', result: null, error: null });
  // Kick off async processing
  setTimeout(() => processDocument(id).catch(() => {}), 0);
  req.logger?.info('doc_queued', { id });
  res.status(202).json({ id, status: 'queued' });
});

// Status: queued | processing | done | error
app.get('/api/documents/:id/status', (req, res) => {
  const id = req.params.id;
  const entry = docs.get(id);
  if (!entry) { req.logger?.warn('status_missing_doc', { id }); return res.json({ id, status: 'done', progress: 1, flags: { verifyManually: false, reasons: [] }, error: null }); }
  const status = entry.status;
  res.json({ id, status, progress: status === 'done' ? 1 : status === 'processing' ? 0.5 : 0.1, flags: entry.result?.flags || { verifyManually: false, reasons: [] }, error: entry.error });
});

// Result: returns extraction result or error if processing failed/unavailable
app.get('/api/documents/:id/result', (req, res) => {
  const id = req.params.id;
  const entry = docs.get(id);
  if (!entry) {
    req.logger?.warn('result_not_found', { id });
  return res.status(404).json({ error: { code: 'not_found', category: classifyError('not_found'), message: 'document not found' } });
  }
  if (entry.status === 'error') {
    req.logger?.info('result_error', { id, code: 'ocr_failed' });
  return res.status(502).json({ error: { code: 'ocr_failed', category: classifyError('ocr_failed'), message: entry.error || 'processing error' } });
  }
  if (entry.result) {
    const debug = req.query.debug === '1' || req.query.debug === 'true';
    if (debug) {
      return res.json({ ...entry.result, debug: { trace: entry._trace || [] } });
    }
    return res.json(entry.result);
  }
  // If not yet processed, attempt now (sync)
  processDocument(id).then(() => {
    const after = docs.get(id);
    if (after.status === 'error') {
  res.status(502).json({ error: { code: 'ocr_failed', category: classifyError('ocr_failed'), message: after.error || 'processing error' } });
    } else if (after.result) {
      res.json(after.result);
    } else {
    res.status(202).json({ status: after.status || 'processing' });
    }
  }).catch(err => {
  req.logger?.error('result_internal_error', { id, err: String(err?.message || err) });
  res.status(500).json({ error: { code: 'internal_error', category: classifyError('internal_error'), message: String(err?.message || err) } });
  });
});

// FHIR export endpoint (experimental)
app.get('/api/documents/:id/fhir', (req, res) => {
  const id = req.params.id;
  const entry = docs.get(id);
  if (!entry) return res.status(404).json({ error: { code: 'not_found', category: classifyError('not_found'), message: 'document not found' } });
  if (entry.status !== 'done' || !entry.result) return res.status(409).json({ error: { code: 'not_ready', category: classifyError('not_ready'), message: 'document not processed' } });
  try {
    const bundle = toFhirBundle(entry.result);
    res.json(bundle);
  } catch (e) {
    req.logger?.error('fhir_export_failed',{ id, err: String(e.message||e) });
  res.status(500).json({ error: { code: 'fhir_export_failed', category: classifyError('fhir_export_failed'), message: 'FHIR export error' } });
  }
});

// Individual patient PDF
app.get('/api/documents/:id/summary.pdf', (req, res) => {
  const id = req.params.id;
  const entry = docs.get(id);
  if (!entry || entry.status !== 'done' || !entry.result) {
    return res.status(404).json({ error: { code: 'not_ready', message: 'document not found or not processed' } });
  }
  // Apply naming convention: LastName_FirstName_DOB_ReferralDate.pdf
  try {
    const r = entry.result;
    const p = r.patient || {};
    const first = p.first || '';
    const last = p.last || '';
    const dob = p.dob || '';
    const referralDate = r.documentMeta?.intakeDate || '';
    const safe = (s) => String(s).trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const partsRaw = [safe(last), safe(first), safe(dob), safe(referralDate)];
    // Keep empty placeholders out but ensure referral date present if available
    const parts = partsRaw.filter((p,i)=>p || (i === 3));
    const fname = (parts.length >= 2 ? parts.join('_') : (parts[0] || 'Referral_Summary')) + '.pdf';
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"; filename*=UTF-8''${encodeURIComponent(fname)}`);
  } catch {}
  renderPatientPdf(res, entry.result, process.env.BATCH_LOGO_PATH);
});

// Test helper: inject a processed document (enabled in explicit test env or when using node --test)
if (IS_TEST) {
  app.post('/api/test/inject', (req, res) => {
    const { id, result } = req.body || {};
    if (!id || !result) return res.status(400).json({ error: { code: 'bad_request', message: 'id and result required' } });
    docs.set(id, { filePath: null, originalName: result?.documentMeta?.filename || 'injected.pdf', status: 'done', result, error: null, _trace: [] });
    try { addSnapshot(id, result); } catch {}
    if (result?.confidenceDetail?.score != null) recordConfidence(Number(result.confidenceDetail.score));
    req.logger?.info('doc_injected', { id });
    res.json({ ok: true, id });
  });
}

// Batch summary (stub)
app.get('/api/batch/:date/summary', (req, res) => {
  res.json({
    date: req.params.date,
    patients: [
      { id: 'doc_1', name: 'Doe, Jane', dob: '01/02/1970', insurance: 'Aetna', memberId: 'ABC123', additionalActions: [] }
    ],
    forms: { insuranceVerification: 0, authorizationRequests: 0, utsReferrals: 0, providerFollowUps: 0, patientContacts: 0 },
    totals: { processed: 1, readyToSchedule: 1, additionalActions: 0 }
  });
});

// Forms (stub: PDF placeholder)
app.get('/api/forms/:id/:type', (req, res) => {
  res.setHeader('Content-Type', 'application/pdf');
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'binary');
  res.send(pdf);
});

// --- Batch helpers and generators ---
function collectBatchDocs(date) {
  return collectDocsSvc(docs, date);
}

function formatPatient(entry) {
  const p = entry?.result?.patient || {};
  const name = [p.last, p.first].filter(Boolean).join(', ') || 'Unknown';
  const dob = p.dob || 'Unknown DOB';
  return `${name}  DOB: ${dob}`;
}

function summarizeActions(entries) { return summarizeActionsSvc(entries).map(x => `${x.action}: ${x.count}`); }

// Cover sheet PDF for a batch date (YYYY-MM-DD)
app.get('/api/batch/:date/cover.pdf', (req, res) => {
  const date = req.params.date;
  const json = buildCoverJson(docs, date);
  // Batch cover: Batch_Summary_[MMDDYYYY].pdf
  try {
    const mmddyyyy = (() => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date.slice(5,7)+date.slice(8,10)+date.slice(0,4);
      const d = new Date(date);
      if (!isNaN(d)) {
        const mm = String(d.getMonth()+1).padStart(2,'0');
        const dd = String(d.getDate()).padStart(2,'0');
        const yyyy = d.getFullYear();
        return mm+dd+yyyy;
      }
      return 'UNKNOWN_DATE';
    })();
    res.setHeader('Content-Disposition', `attachment; filename="Batch_Summary_${mmddyyyy}.pdf"`);
  } catch {}
  renderCoverPdf(res, json, process.env.BATCH_LOGO_PATH);
});

// Problem log PDF for a batch date
app.get('/api/batch/:date/problem-log.pdf', (req, res) => {
  const date = req.params.date;
  const json = buildProblemLogJson(docs, date);
  // Problem log: Manual_Review_[MMDDYYYY].pdf
  try {
    const mmddyyyy = (() => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date.slice(5,7)+date.slice(8,10)+date.slice(0,4);
      const d = new Date(date);
      if (!isNaN(d)) {
        const mm = String(d.getMonth()+1).padStart(2,'0');
        const dd = String(d.getDate()).padStart(2,'0');
        const yyyy = d.getFullYear();
        return mm+dd+yyyy;
      }
      return 'UNKNOWN_DATE';
    })();
    res.setHeader('Content-Disposition', `attachment; filename="Manual_Review_${mmddyyyy}.pdf"`);
  } catch {}
  renderProblemLogPdf(res, json, process.env.BATCH_LOGO_PATH);
});

// JSON versions of batch cover and problem log
app.get('/api/batch/:date/cover.json', (req, res) => {
  const date = req.params.date;
  res.json(buildCoverJson(docs, date));
});

app.get('/api/batch/:date/problem-log.json', (req, res) => {
  const date = req.params.date;
  res.json(buildProblemLogJson(docs, date));
});

// Batch index endpoint: list all available intake dates
app.get('/api/batch', (req, res) => {
  res.json({ dates: listBatchDates(docs) });
});

// Serve fixtures directly for UI testing
app.get('/api/fixtures/:name', (req, res) => {
  const name = req.params.name.replace(/[^a-zA-Z0-9_\-]/g, '');
  const p = path.join(process.cwd(), 'examples/fixtures', `${name}.json`);
  if (!fs.existsSync(p)) return res.status(404).json({ error: { code: 'not_found', message: 'fixture not found' } });
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  res.json(data);
});

// ---------------- Feedback Ingestion ----------------
// POST /api/feedback { docId, path, previousValue, newValue, reason, user }
app.post('/api/feedback', (req, res) => {
  const { docId, path: fPath, previousValue, newValue, reason, user, accepted } = req.body || {};
  if (!docId || !fPath) return res.status(400).json({ error: { code: 'bad_request', message: 'docId and path required' } });
  const rec = addFeedback({ docId, path: fPath, previousValue, newValue, reason, user, accepted });
  res.status(201).json({ ok: true, record: rec });
});

// GET /api/feedback?docId=doc_x
app.get('/api/feedback', (req, res) => {
  const { docId } = req.query;
  const records = listFeedback({ docId });
  res.json({ records });
});

// GET /api/feedback/stats
app.get('/api/feedback/stats', (_req, res) => {
  res.json(feedbackStats());
});

// Analytics aggregation endpoint
app.get('/api/analytics', (_req, res) => {
  const metrics = metricsSnapshot();
  const fb = feedbackStats();
  const manualCorrectionRate = metrics.counters.docsProcessed ? (fb.total / metrics.counters.docsProcessed) : 0;
  const ambRate = ambiguousCptRate();
  res.json({
    metrics: metrics.counters,
    latency: metrics.extractionLatency,
    confidenceDrift: metrics.confidenceDrift,
  confidenceDriftAlert: metrics.confidenceDriftAlert,
  concurrency: metrics.concurrency,
  feedback: { total: fb.total, topPaths: Object.entries(fb.byPath).sort((a,b)=>b[1]-a[1]).slice(0,5), acceptanceRate: fb.acceptanceRate, suggestions: fb.suggestions },
    derived: { manualCorrectionRate, ambiguousCptRate: ambRate },
    snapshots: { recent: recentSnapshots(10).map(s => ({ docId: s.docId, cpt: s.summary.procedure.cpt, ambiguous: s.summary.procedure.ambiguous, confidence: s.summary.confidence })) }
  });
});

async function processDocument(id) {
  const entry = docs.get(id);
  if (!entry) return;
  const t0 = performance.now();
  if (!entry.filePath || !fs.existsSync(entry.filePath)) {
  // No file available -> mark error (do not fallback to sample)
  entry.status = 'error';
  entry.error = 'Input file not found';
  entry.result = null;
  docs.set(id, entry);
  incCounter('docsErrored');
  incCounter('ocrFailures');
  recordLatency(performance.now() - t0);
  return;
  }
  entry.status = 'processing'; docs.set(id, entry);
  log('debug','doc_processing_start',{ id });
  // Try OCR service
  try {
  const form = new FormData();
  const fileBuffer = await fs.promises.readFile(entry.filePath);
  const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  const blob = new Blob([fileBuffer], { type: 'application/pdf' });
  form.append('file', blob, path.basename(entry.filePath));
    // Abort if OCR takes too long
    const controller = new AbortController();
    const ocrTimeoutMs = parseInt(process.env.OCR_TIMEOUT_MS || '30000', 10);
    const timeoutHandle = setTimeout(() => controller.abort(), ocrTimeoutMs);
    let resp;
    try {
      resp = await scheduleOcr(() => fetch(`${ocrServiceUrl}/ocr`, { method: 'POST', body: form, signal: controller.signal }));
    } finally { clearTimeout(timeoutHandle); }
    if (!resp.ok) throw new Error(`OCR service error: ${resp.status}`);
  const ocrJson = await resp.json();
  const ocrPages = Array.isArray(ocrJson.ocr) ? ocrJson.ocr : [];
  const maxPages = parseInt(process.env.MAX_PDF_PAGES || '150',10);
  if (ocrPages.length > maxPages) throw new Error(`PDF exceeds max pages (${maxPages})`);
  // Map from OCR using rules engine (no template seed)
  const { result: mappedResult, trace } = runExtractionWithDates(ocrPages);
  // Build suggested filename per client requirement: LastName_FirstName_DOB_ReferralDate.pdf
    const first = mappedResult?.patient?.first || '';
    const last = mappedResult?.patient?.last || '';
    const dob = mappedResult?.patient?.dob || '';
    const intakeDate = new Date().toISOString().slice(0, 10);
    const safe = (s) => String(s).trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const suggestedFilename = (last && first && dob)
      ? `${safe(last)}_${safe(first)}_${safe(dob)}_${safe(intakeDate)}`
      : undefined;
  const result = {
      ...mappedResult,
      ocr: ocrPages,
      documentMeta: {
        ...mappedResult.documentMeta,
        filename: entry.originalName || path.basename(entry.filePath),
        pages: Array.isArray(ocrPages) ? ocrPages.length : 0,
        intakeDate,
    suggestedFilename: suggestedFilename ? `${suggestedFilename}.pdf` : undefined,
    fileHash
      }
    };
  // Enrichment: confidence level alias & provider heuristics & emergency contact suppression
  try {
    if (result?.confidenceDetail?.score != null && !result.confidenceLevel) {
      const s = result.confidenceDetail.score;
      result.confidenceLevel = s >= 0.8 ? 'High' : s >= 0.55 ? 'Medium' : s >= 0.35 ? 'Low' : 'Manual Review Required';
    }
    // Provider practice / supervising heuristics (simple text scan of concatenated OCR)
    if (result.provider) {
      const full = (ocrPages.map(p=>p.text||'').join('\n')).slice(0,5000);
      if (!result.provider.practice) {
        const mPractice = full.match(/\b([A-Z][A-Za-z&\s]{3,60})(Clinic|Center|Medical|Health|Hospital|Group)\b/i);
        if (mPractice) result.provider.practice = mPractice[0].trim();
      }
      if (!result.provider.supervising) {
        const mSup = full.match(/Supervis(?:ing)?\s+Physician[:\-]?\s*([^\n]+)/i);
        if (mSup) result.provider.supervising = mSup[1].trim();
      }
    }
    // Emergency contact suppression if adult and no special indicators
    if (result.patient?.emergencyContact && result.patient?.dob) {
      const dob = new Date(result.patient.dob);
      if (!isNaN(dob)) {
        const age = (Date.now() - dob.getTime()) / 31557600000;
        if (age >= 18 && !(result.infoAlerts?.accommodations||[]).some(a=>/caretaker|guardian|assistance/i.test(a))) {
          delete result.patient.emergencyContact;
        }
      }
    }
  } catch {}
  entry.result = result; entry._trace = trace; entry.status = 'done'; entry.error = null; docs.set(id, entry);
  incCounter('docsProcessed');
  recordLatency(performance.now() - t0);
  try { addSnapshot(id, result); } catch {}
  if (result?.confidenceDetail?.score != null) recordConfidence(Number(result.confidenceDetail.score));
  log('info','doc_processed',{ id, pages: result.documentMeta?.pages, actions: (result.alerts?.actions||[]).length });
  } catch (e) {
  // Do not fallback to sample; surface error
  entry.result = null;
  entry.status = 'error';
  const msg = String(e.message || e);
  entry.error = msg.includes('aborted') ? `OCR timeout after ${process.env.OCR_TIMEOUT_MS || 30000}ms` : msg;
  docs.set(id, entry);
  log('error','doc_process_failed',{ id, err: entry.error });
  incCounter('docsErrored');
  if (entry.error.toLowerCase().includes('timeout')) incCounter('ocrTimeouts'); else incCounter('ocrFailures');
  recordLatency(performance.now() - t0);
  }
}

// Metrics endpoint
app.get('/api/metrics', (_req, res) => {
  res.json(metricsSnapshot());
});

if (!IS_TEST) {
  app.listen(port, () => console.log(`MEDOCR API listening on http://127.0.0.1:${port}`));
}

export default app;
