#!/usr/bin/env node
import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { performance } from 'perf_hooks';
import { PassThrough } from 'stream';
import archiver from 'archiver';
import { PDFDocument } from 'pdf-lib';
import { incCounter, recordLatency, snapshot as metricsSnapshot, recordConfidence, recordConcurrency, recordOcrQueueDepth } from './metrics/store.js';
import crypto from 'crypto';
import { addSnapshot, ambiguousCptRate, recentSnapshots } from './snapshot/store.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { runExtraction, runExtractionWithDates } from './rules/index.js';
import { parseNameFromFilename } from './rules/patient.js';
import { log, withReq, classifyError } from './logging/logger.js';
import { toFhirBundle } from './fhir/export.js';
import { listBatchDates, collectBatchDocs as collectDocsSvc, summarizeActions as summarizeActionsSvc, buildCoverJson, buildProblemLogJson, renderCoverPdf, renderProblemLogPdf, renderPatientPdf } from './batch/report.js';
import { buildPdfModel } from './pdf/model.js';
import { mapAction, mapActions } from './actionMap.js';
import { addFeedback, listFeedback, stats as feedbackStats } from './feedback/store.js';
import { buildCoverage } from './coverage.js';
import { invalidateConfigCache } from './rules/utils/configLoader.js';

const app = express();
app.use(express.json({ limit: process.env.BODY_SIZE_LIMIT || '256kb' }));
// Static dashboard assets
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
app.use('/static', express.static(path.join(__dirname, 'public')));
app.get('/dashboard', (_req,res) => {
  res.sendFile(path.join(__dirname,'public','dashboard.html'));
});
// Lightweight healthcheck (no heavy deps) for container orchestration
app.get('/health', (_req,res) => {
  res.json({ status: 'ok', time: Date.now() });
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
const ocrServiceUrls = (() => {
  const multi = (process.env.OCR_SERVICE_URLS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (multi.length) return multi;
  const single = process.env.OCR_SERVICE_URL || 'http://127.0.0.1:8000';
  return [single];
})();
let ocrServiceUrlIndex = 0;
function nextOcrServiceUrl() {
  if (!ocrServiceUrls.length) return 'http://127.0.0.1:8000';
  const url = ocrServiceUrls[ocrServiceUrlIndex % ocrServiceUrls.length];
  ocrServiceUrlIndex = (ocrServiceUrlIndex + 1) % ocrServiceUrls.length;
  return url;
}
const rulesDataDir = path.join(__dirname, 'rules', 'data');
const PATTERN_OVERRIDES_FILE = 'pattern_overrides.json';

function listRuleFilesMeta() {
  try {
    const entries = fs.readdirSync(rulesDataDir).filter(name => name.endsWith('.json'));
    return entries.map(name => {
      const abs = path.join(rulesDataDir, name);
      const stat = fs.statSync(abs);
      return {
        name,
        size: stat.size,
        mtimeMs: stat.mtimeMs
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    log('error', 'rules_dir_read_failed', { err: String(e?.message || e) });
    return [];
  }
}

function resolveRuleFileName(rawName) {
  if (typeof rawName !== 'string') return null;
  const name = rawName.trim();
  if (!name || !/^[A-Za-z0-9_.\-]+\.json$/.test(name)) return null;
  const abs = path.join(rulesDataDir, name);
  if (!abs.startsWith(rulesDataDir)) return null;
  if (!fs.existsSync(abs)) return null;
  return abs;
}
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
    recordOcrQueueDepth(ocrQueue.length);
      }
    };
  if (ocrInFlight < OCR_MAX_CONCURRENCY) { recordConcurrency(ocrInFlight+1); task(); } else { ocrQueue.push(() => { recordConcurrency(ocrInFlight+1); task(); }); }
  recordOcrQueueDepth(ocrQueue.length);
  });
}

// Top-level document processing queue so massive batches don't saturate OCR all at once
const DOC_MAX_CONCURRENCY = parseInt(process.env.DOC_MAX_CONCURRENCY || '5', 10);
let docInFlight = 0;
const docQueue = [];
const docInQueue = new Map(); // id -> { promise, resolve, reject }

function scheduleDocumentProcessing(id) {
  if (docInQueue.has(id)) {
    return docInQueue.get(id).promise;
  }

  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  docInQueue.set(id, { promise, resolve: resolvePromise, reject: rejectPromise });

  const runTask = () => {
    docInFlight++;
    processDocument(id)
      .then(result => docInQueue.get(id)?.resolve(result))
      .catch(err => docInQueue.get(id)?.reject(err))
      .finally(() => {
        docInFlight = Math.max(0, docInFlight - 1);
        docInQueue.delete(id);
        if (docQueue.length) {
          const next = docQueue.shift();
          setTimeout(next, 0);
        }
      });
  };

  if (docInFlight < DOC_MAX_CONCURRENCY) {
    runTask();
  } else {
    docQueue.push(runTask);
  }

  return promise;
}

// In-memory doc store for dev
const docs = new Map(); // id -> { filePath, status, result, error }

function buildSummaryFileStem(result) {
  const r = result || {};
  const patient = r.patient || {};
  const first = patient.first || '';
  const last = patient.last || '';
  const dob = patient.dob || '';
  const referralDate = r.documentMeta?.intakeDate || r.pdfModel?.document?.intakeDate || '';
  const safe = (s) => String(s).trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const partsRaw = [safe(last), safe(first), safe(dob), safe(referralDate)];
  const parts = partsRaw.filter((segment, idx) => segment || (idx === 3 && referralDate));
  const stem = parts.length >= 2 ? parts.join('_') : (parts[0] || 'Referral_Summary');
  return stem || 'Referral_Summary';
}

function renderSummaryPdfBuffer(result, logoPath) {
  return new Promise((resolve, reject) => {
    const stream = new PassThrough();
    const chunks = [];
    stream.setHeader = () => {};
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    try {
      renderPatientPdf(stream, result, logoPath);
    } catch (err) {
      reject(err);
    }
  });
}

async function buildPacketPdf(docId, entry, logoPath) {
  const summaryBuffer = await renderSummaryPdfBuffer(entry.result, logoPath);
  const filePath = entry.filePath;
  if (filePath && fs.existsSync(filePath)) {
    try {
      const originalBytes = await fsPromises.readFile(filePath);
      const summaryDoc = await PDFDocument.load(summaryBuffer);
      const originalDoc = await PDFDocument.load(originalBytes);
      const copiedPages = await summaryDoc.copyPages(originalDoc, originalDoc.getPageIndices());
      copiedPages.forEach(page => summaryDoc.addPage(page));
      const merged = await summaryDoc.save();
      return Buffer.from(merged);
    } catch (err) {
      log('warn', 'packet_pdf_merge_failed', { id: docId, filePath, err: String(err?.message || err) });
    }
  } else {
    log('warn', 'packet_original_missing', { id: docId, filePath });
  }
  return summaryBuffer;
}

// Checklist overrides persistent store
import fsPromises from 'fs/promises';
const CHECKLIST_PATH = path.join(process.cwd(), 'data', 'checklist-overrides.json');
let checklistOverrides = new Map();
function loadChecklistOverrides() {
  try {
    if (fs.existsSync(CHECKLIST_PATH)) {
      const json = JSON.parse(fs.readFileSync(CHECKLIST_PATH,'utf8'));
      checklistOverrides = new Map(Object.entries(json));
    }
  } catch {}
}
let _clFlushTimer = null;
function flushChecklistOverrides() {
  if (_clFlushTimer) return;
  _clFlushTimer = setTimeout(async () => {
    _clFlushTimer = null;
    try {
      const obj = Object.fromEntries(checklistOverrides.entries());
      await fsPromises.mkdir(path.dirname(CHECKLIST_PATH), { recursive: true });
      await fsPromises.writeFile(CHECKLIST_PATH, JSON.stringify(obj, null, 2));
    } catch {}
  }, 500);
}
loadChecklistOverrides();

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
  try { flushChecklistOverrides(); } catch {}
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
  // Use timestamp + short random suffix to avoid collisions during rapid batch uploads
  const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const filePath = req.file?.path;
  const originalName = req.file?.originalname;
  docs.set(id, { filePath, originalName, status: 'queued', result: null, error: null });
  // Kick off async processing
  scheduleDocumentProcessing(id).catch(() => {});
  req.logger?.info('doc_queued', { id });
  res.status(202).json({ id, status: 'queued' });
});

// Status: queued | processing | done | error
app.get('/api/documents/:id/status', (req, res) => {
  const id = req.params.id;
  const entry = docs.get(id);
  if (!entry) { req.logger?.warn('status_missing_doc', { id }); return res.json({ id, status: 'done', progress: 1, flags: { verifyManually: false, reasons: [] }, error: null }); }
  const status = entry.status;
  let errorCode = null; let suggestions = undefined;
  if (status === 'error' && entry.error) {
    const err = entry.error.toLowerCase();
    if (err.includes('timeout')) { errorCode = 'ocr_timeout'; suggestions = ['Split large PDF', 'Reduce resolution / scan DPI', 'Retry at lower load']; }
    else if (err.includes('exceeds max pages')) { errorCode = 'too_many_pages'; suggestions = ['Remove filler pages', 'Split into smaller documents']; }
    else if (err.includes('invalid pdf')) { errorCode = 'invalid_pdf'; suggestions = ['Re-export original file as PDF', 'Ensure file not encrypted/password protected']; }
    else if (err.includes('service error')) { errorCode = 'ocr_service_error'; suggestions = ['Check OCR service health / logs', 'Restart OCR service']; }
    else if (err.includes('input file not found')) { errorCode = 'file_missing'; suggestions = ['Re-upload the document']; }
    else { errorCode = 'ocr_failed'; }
  }
  res.json({ id, status, progress: status === 'done' ? 1 : status === 'processing' ? 0.5 : 0.1, flags: entry.result?.flags || { verifyManually: false, reasons: [] }, error: entry.error, errorCode, suggestions });
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
  scheduleDocumentProcessing(id).then(() => {
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
    const stem = buildSummaryFileStem(entry.result);
    const fname = `${stem}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"; filename*=UTF-8''${encodeURIComponent(fname)}`);
  } catch {}
  renderPatientPdf(res, entry.result, process.env.BATCH_LOGO_PATH);
});

app.get('/api/documents/:id/packet.pdf', async (req, res) => {
  const id = req.params.id;
  const entry = docs.get(id);
  if (!entry || entry.status !== 'done' || !entry.result) {
    return res.status(404).json({ error: { code: 'not_ready', message: 'document not found or not processed' } });
  }

  try {
    const stem = buildSummaryFileStem(entry.result);
    const packetName = `${stem}_packet.pdf`;
    const packetBuffer = await buildPacketPdf(id, entry, process.env.BATCH_LOGO_PATH);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${packetName}"; filename*=UTF-8''${encodeURIComponent(packetName)}`);
    res.send(packetBuffer);
  } catch (err) {
    req.logger?.error('packet_build_failed', { id, err: String(err?.message || err) });
    res.status(500).json({ error: { code: 'packet_build_failed', message: 'unable to build packet' } });
  }
});

// Test helper: inject a processed document (enabled in explicit test env or when using node --test)
if (IS_TEST) {
  app.post('/api/test/inject', (req, res) => {
    const { id, result } = req.body || {};
    if (!id || !result) return res.status(400).json({ error: { code: 'bad_request', message: 'id and result required' } });
  try { if (!result.pdfModel) result.pdfModel = buildPdfModel(result); } catch {}
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

app.get('/api/admin/rules/files', (_req, res) => {
  const files = listRuleFilesMeta();
  res.json({ files });
});

app.get('/api/admin/rules/files/:name', async (req, res) => {
  const abs = resolveRuleFileName(req.params.name);
  if (!abs) return res.status(404).json({ error: { code: 'not_found', message: 'rules file not found' } });
  try {
    const raw = await fsPromises.readFile(abs, 'utf8');
    let normalized = raw;
    try {
      const parsed = JSON.parse(raw);
      normalized = JSON.stringify(parsed, null, 2);
    } catch {
      // keep raw (may be invalid JSON)
    }
    const stat = await fsPromises.stat(abs);
    res.json({
      name: path.basename(abs),
      content: normalized,
      size: stat.size,
      mtimeMs: stat.mtimeMs
    });
  } catch (e) {
    res.status(500).json({ error: { code: 'read_failed', message: String(e?.message || e) } });
  }
});

app.put('/api/admin/rules/files/:name', async (req, res) => {
  const abs = resolveRuleFileName(req.params.name);
  if (!abs) return res.status(404).json({ error: { code: 'not_found', message: 'rules file not found' } });
  const content = req.body?.content;
  if (typeof content !== 'string') {
    return res.status(400).json({ error: { code: 'invalid_payload', message: 'content string required' } });
  }
  let normalized;
  try {
    const parsed = JSON.parse(content);
    normalized = JSON.stringify(parsed, null, 2) + '\n';
  } catch (e) {
    return res.status(400).json({ error: { code: 'invalid_json', message: `JSON parse error: ${e?.message || e}` } });
  }
  try {
    await fsPromises.writeFile(abs, normalized, 'utf8');
    invalidateConfigCache(path.basename(abs));
    const stat = await fsPromises.stat(abs);
    res.json({ ok: true, size: stat.size, mtimeMs: stat.mtimeMs });
  } catch (e) {
    res.status(500).json({ error: { code: 'write_failed', message: String(e?.message || e) } });
  }
});

app.get('/api/admin/rules/pattern-overrides', async (_req, res) => {
  const abs = resolveRuleFileName(PATTERN_OVERRIDES_FILE);
  if (!abs) return res.status(404).json({ error: { code: 'not_found', message: 'rules file not found' } });
  try {
    const raw = await fsPromises.readFile(abs, 'utf8');
    let normalized = raw;
    try {
      const parsed = JSON.parse(raw);
      normalized = JSON.stringify(parsed, null, 2);
    } catch {
      // keep raw to surface parse errors to the UI
    }
    const stat = await fsPromises.stat(abs);
    res.json({
      name: path.basename(abs),
      content: normalized,
      size: stat.size,
      mtimeMs: stat.mtimeMs
    });
  } catch (e) {
    res.status(500).json({ error: { code: 'read_failed', message: String(e?.message || e) } });
  }
});

app.put('/api/admin/rules/pattern-overrides', async (req, res) => {
  const abs = resolveRuleFileName(PATTERN_OVERRIDES_FILE);
  if (!abs) return res.status(404).json({ error: { code: 'not_found', message: 'rules file not found' } });
  const { content, overrides } = req.body || {};
  let payload = content;
  if (payload == null && typeof overrides === 'object') {
    try {
      payload = JSON.stringify(overrides);
    } catch (e) {
      return res.status(400).json({ error: { code: 'invalid_payload', message: `JSON serialization error: ${e?.message || e}` } });
    }
  }
  if (typeof payload !== 'string') {
    return res.status(400).json({ error: { code: 'invalid_payload', message: 'content string or overrides object required' } });
  }
  let normalized;
  try {
    const parsed = JSON.parse(payload);
    normalized = JSON.stringify(parsed, null, 2) + '\n';
  } catch (e) {
    return res.status(400).json({ error: { code: 'invalid_json', message: `JSON parse error: ${e?.message || e}` } });
  }
  try {
    await fsPromises.writeFile(abs, normalized, 'utf8');
    invalidateConfigCache(path.basename(abs));
    const stat = await fsPromises.stat(abs);
    res.json({ ok: true, size: stat.size, mtimeMs: stat.mtimeMs });
  } catch (e) {
    res.status(500).json({ error: { code: 'write_failed', message: String(e?.message || e) } });
  }
});

app.post('/api/admin/rules/reload', (req, res) => {
  const filename = typeof req.body?.filename === 'string' ? req.body.filename.trim() : '';
  if (filename) {
    const abs = resolveRuleFileName(filename);
    if (!abs) {
      return res.status(404).json({ error: { code: 'not_found', message: 'rules file not found' } });
    }
    invalidateConfigCache(path.basename(abs));
    return res.json({ ok: true, scope: path.basename(abs) });
  }
  invalidateConfigCache();
  res.json({ ok: true, scope: 'all' });
});

app.post('/api/admin/documents/reset', (_req, res) => {
  docs.clear();
  log('info', 'admin_docs_reset');
  res.json({ ok: true });
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
  const ocrTimeoutMsConfig = parseInt(process.env.OCR_TIMEOUT_MS || '60000', 10);
  let lastQueueWaitMs = 0;
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
    // NOTE: Previously the AbortController timer started BEFORE entering the OCR concurrency slot.
    // If the queue wait exceeded the timeout, a doc could "timeout" without the OCR ever starting.
    // Fix: start timeout only once a concurrency slot is acquired (inside scheduleOcr closure).
    const queueEnqueuedAt = performance.now();
    const resp = await scheduleOcr(() => {
      const queueWait = performance.now() - queueEnqueuedAt;
      lastQueueWaitMs = queueWait;
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), ocrTimeoutMsConfig);
      const serviceUrl = nextOcrServiceUrl();
      log('debug','ocr_start',{ id, queueWaitMs: Math.round(queueWait), timeoutMs: ocrTimeoutMsConfig, serviceUrl });
      try { incCounter('ocrQueueWaitSamples'); } catch {}
      try {
        // Simple bucketing of queue wait into latency histogram style counters
        const bucket = queueWait < 1000 ? 'lt1s' : queueWait < 5000 ? 'lt5s' : queueWait < 15000 ? 'lt15s' : 'ge15s';
        incCounter(`ocrQueueWait_${bucket}`);
      } catch {}
      return fetch(`${serviceUrl.replace(/\/$/, '')}/ocr`, { method: 'POST', body: form, signal: controller.signal })
        .finally(() => clearTimeout(timeoutHandle));
    });
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
  const filenameName = parseNameFromFilename(result.documentMeta?.filename);
  if (filenameName) {
    const existingFirst = result.patient?.first;
    const existingLast = result.patient?.last;
    const sameName = existingFirst && existingLast &&
      existingFirst.toLowerCase() === filenameName.first.toLowerCase() &&
      existingLast.toLowerCase() === filenameName.last.toLowerCase();
    if (!sameName) {
      result.patient = { ...result.patient, ...filenameName };
      trace.push({ rule: 'patient_name_filename_fallback', value: `${filenameName.last}, ${filenameName.first}` });
    }
  }
  // Build pdfModel defensively; recordPdfModelStats may be absent in some builds
  try {
    result.pdfModel = buildPdfModel(result);
    if (result.pdfModel && typeof recordPdfModelStats === 'function') {
      recordPdfModelStats(result.pdfModel);
    }
  } catch (e) { log('warn','pdf_model_build_failed',{ id, err: String(e.message||e) }); }
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
  if (msg.includes('aborted')) {
    const durationMs = performance.now() - t0;
    const queueSegment = Number.isFinite(lastQueueWaitMs) ? `${Math.round(lastQueueWaitMs)}ms queue wait` : 'queue wait unknown';
    entry.error = `OCR timeout after ${ocrTimeoutMsConfig}ms (${queueSegment}, total elapsed ${Math.round(durationMs)}ms)`;
  } else {
    entry.error = msg;
  }
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

// Backfill pdfModel for legacy documents
app.post('/api/admin/backfill-pdf-models', (req, res) => {
  let built = 0;
  for (const [id, entry] of docs.entries()) {
    if (entry.status === 'done' && entry.result && !entry.result.pdfModel) {
      try {
        entry.result.pdfModel = buildPdfModel(entry.result);
        if (entry.result.pdfModel && typeof recordPdfModelStats === 'function') {
          recordPdfModelStats(entry.result.pdfModel);
        }
        if (entry.result.pdfModel) built++;
      } catch {}
    }
  }
  res.json({ ok: true, built });
});

// Bulk export (zip) of multiple referral PDFs (original JSON-only)
app.post('/api/documents/bulk-export.zip', express.json({ limit: '256kb' }), async (req, res) => {
  try {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 200) : [];
    if (!ids.length) return res.status(400).json({ error: { code: 'bad_request', message: 'ids required' } });

    const items = [];
    for (const id of ids) {
      const entry = docs.get(id);
      if (!entry || entry.status !== 'done' || !entry.result) continue;
      try {
        const stem = buildSummaryFileStem(entry.result);
        const packetBuffer = await buildPacketPdf(id, entry, process.env.BATCH_LOGO_PATH);
        items.push({ stem, packetBuffer });
      } catch (err) {
        log('warn', 'bulk_packet_skip', { id, err: String(err?.message || err) });
      }
    }

    if (!items.length) return res.status(404).json({ error: { code: 'none_ready', message: 'no documents available' } });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="Referral_Packets.zip"');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => {
      log('error', 'bulk_packet_zip_failed', { err: String(err?.message || err) });
      if (!res.headersSent) {
        res.status(500).json({ error: { code: 'bulk_export_failed', message: 'unable to build packet ZIP' } });
      } else {
        res.end();
      }
    });

    archive.pipe(res);

    for (const item of items) {
      archive.append(item.packetBuffer, { name: `${item.stem}_packet.pdf` });
    }

  archive.finalize();
  } catch (e) {
    log('error', 'bulk_export_failed', { err: String(e?.message || e) });
    return res.status(500).json({ error: { code: 'bulk_export_failed', message: String(e?.message || e) } });
  }
});

// (reverted) retry-failed endpoint removed

if (!IS_TEST) {
  app.listen(port, () => console.log(`MEDOCR API listening on http://127.0.0.1:${port}`));
}

export default app;
