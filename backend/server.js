#!/usr/bin/env node
import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { runExtraction } from './rules/index.js';
import { listBatchDates, collectBatchDocs as collectDocsSvc, summarizeActions as summarizeActionsSvc, buildCoverJson, buildProblemLogJson, renderCoverPdf, renderProblemLogPdf } from './batch/report.js';
import { buildCoverage } from './coverage.js';

const app = express();
const uploadDir = path.join(process.cwd(), 'data', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });
const port = process.env.PORT || 4387;
const ocrServiceUrl = process.env.OCR_SERVICE_URL || 'http://127.0.0.1:8000';

// In-memory doc store for dev
const docs = new Map(); // id -> { filePath, status, result, error }

app.use(express.json());

// Health
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

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
    return res.status(400).json({ error: { code: 'no_file', message: 'No file uploaded' } });
  }
  // Accept common pdf mimetypes
  const mt = req.file.mimetype || '';
  const looksLikePdfType = mt === 'application/pdf' || mt === 'application/octet-stream';
  if (!looksLikePdfType && process.env.NODE_ENV !== 'test') {
    return res.status(400).json({ error: { code: 'invalid_type', message: `Only PDF files are supported (got ${mt || 'unknown'})` } });
  }
  // Quick magic header check (skip in tests)
  if (process.env.NODE_ENV !== 'test') {
    try {
      const fd = await fs.promises.open(req.file.path, 'r');
      const { buffer } = await fd.read(Buffer.alloc(5), 0, 5, 0);
      await fd.close();
      const head = buffer.toString('utf8');
      if (!head.startsWith('%PDF')) {
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
  res.status(202).json({ id, status: 'queued' });
});

// Status: queued | processing | done | error
app.get('/api/documents/:id/status', (req, res) => {
  const id = req.params.id;
  const entry = docs.get(id);
  if (!entry) {
    return res.json({ id, status: 'done', progress: 1, flags: { verifyManually: false, reasons: [] }, error: null });
  }
  const status = entry.status;
  res.json({ id, status, progress: status === 'done' ? 1 : status === 'processing' ? 0.5 : 0.1, flags: entry.result?.flags || { verifyManually: false, reasons: [] }, error: entry.error });
});

// Result: returns extraction result or error if processing failed/unavailable
app.get('/api/documents/:id/result', (req, res) => {
  const id = req.params.id;
  const entry = docs.get(id);
  if (!entry) {
    return res.status(404).json({ error: { code: 'not_found', message: 'document not found' } });
  }
  if (entry.status === 'error') {
    return res.status(502).json({ error: { code: 'ocr_failed', message: entry.error || 'processing error' } });
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
      res.status(502).json({ error: { code: 'ocr_failed', message: after.error || 'processing error' } });
    } else if (after.result) {
      res.json(after.result);
    } else {
      res.status(202).json({ status: after.status || 'processing' });
    }
  }).catch(err => {
    res.status(500).json({ error: { code: 'internal_error', message: String(err?.message || err) } });
  });
});

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
  renderCoverPdf(res, json, process.env.BATCH_LOGO_PATH);
});

// Problem log PDF for a batch date
app.get('/api/batch/:date/problem-log.pdf', (req, res) => {
  const date = req.params.date;
  const json = buildProblemLogJson(docs, date);
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

async function processDocument(id) {
  const entry = docs.get(id);
  if (!entry) return;
  if (!entry.filePath || !fs.existsSync(entry.filePath)) {
  // No file available -> mark error (do not fallback to sample)
  entry.status = 'error';
  entry.error = 'Input file not found';
  entry.result = null;
  docs.set(id, entry);
  return;
  }
  entry.status = 'processing'; docs.set(id, entry);
  // Try OCR service
  try {
  const form = new FormData();
  const fileBuffer = await fs.promises.readFile(entry.filePath);
  const blob = new Blob([fileBuffer], { type: 'application/pdf' });
  form.append('file', blob, path.basename(entry.filePath));
    const resp = await fetch(`${ocrServiceUrl}/ocr`, { method: 'POST', body: form });
    if (!resp.ok) throw new Error(`OCR service error: ${resp.status}`);
    const ocrJson = await resp.json();
    const ocrPages = Array.isArray(ocrJson.ocr) ? ocrJson.ocr : [];
  // Map from OCR using rules engine (no template seed)
  const { result: mappedResult, trace } = runExtraction(ocrPages);
    // Build suggested filename: Last_First_DOB_ReferralDate.pdf
    const first = mappedResult?.patient?.first || '';
    const last = mappedResult?.patient?.last || '';
    const dob = mappedResult?.patient?.dob || '';
    const intakeDate = new Date().toISOString().slice(0, 10);
    const safe = (s) => String(s).trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const suggestedFilename = (last && first && dob)
      ? `${safe(last)}_${safe(first)}_${safe(dob)}_${safe(intakeDate)}.pdf`
      : undefined;
    const result = {
      ...mappedResult,
      ocr: ocrPages,
      documentMeta: {
        ...mappedResult.documentMeta,
        filename: entry.originalName || path.basename(entry.filePath),
        pages: Array.isArray(ocrPages) ? ocrPages.length : 0,
        intakeDate,
        suggestedFilename
      }
    };
    entry.result = result; entry._trace = trace; entry.status = 'done'; entry.error = null; docs.set(id, entry);
  } catch (e) {
  // Do not fallback to sample; surface error
  entry.result = null;
  entry.status = 'error';
  entry.error = String(e.message || e);
  docs.set(id, entry);
  }
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => console.log(`MEDOCR API listening on http://127.0.0.1:${port}`));
}

export default app;
