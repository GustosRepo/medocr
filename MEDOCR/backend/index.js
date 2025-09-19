import express from "express";
import cors from "cors";
import multer from "multer";
import { spawn } from "child_process";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { randomBytes } from "crypto";
import os from "os";
import { fileURLToPath } from "url";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { normalizeOcr } from "./normalizer.js";
// removed duplicate crypto imports; using named randomBytes above

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Text normalization to improve downstream extraction ---
function normalizeOcrServer(text = '') { return normalizeOcr(String(text || '')); }

const backendDir = path.resolve(__dirname);
const ocrWorkerDir = path.resolve(backendDir, "..", "ocr-worker");
const workerPath = path.join(ocrWorkerDir, "main.py");
const fillTemplatePath = path.join(ocrWorkerDir, "fill_template.py");
const templatePath = path.join(ocrWorkerDir, "template.txt");
const userRulesPath = path.join(ocrWorkerDir, 'rules', 'user_rules.json');

// Helpers for export root and checklist ledger
function getExportRoot() {
  const desktopPath = path.join(os.homedir(), 'Desktop');
  return process.env.EXPORT_DIR || path.join(desktopPath, 'MEDOCR-Exports');
}
function getLedgerDir() {
  const dir = path.join(getExportRoot(), 'ledger');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function getLedgerArchiveDir() {
  const dir = path.join(getLedgerDir(), 'archive');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const app = express();
const allowed = (process.env.CORS_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors(allowed.length ? { origin: allowed } : {}));
app.use(express.json({ limit: '50mb' })); // Increased limit for PDF exports

// Create persistent uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  dest: uploadsDir,
  // Allow larger batches; multer writes to disk so memory impact is limited
  limits: { fileSize: 15 * 1024 * 1024, files: 200 },
  fileFilter: (_req, file, cb) => {
    const ok = [
      "image/png",
      "image/jpeg",
      "image/tiff",
      "application/pdf"
    ].includes(file.mimetype);
    if (!ok) return cb(new Error("INVALID_FILE_TYPE"));
    cb(null, true);
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// In-memory batch progress registry
const batchProgress = new Map(); // id -> { id, total, done, status, startedAt, updatedAt, current, error }

app.get('/batch-ocr/progress/:id', (req, res) => {
  const id = String(req.params.id || '');
  const prog = batchProgress.get(id);
  if (!prog) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({ success: true, progress: prog });
});

// Helper function to run a child process and capture stdout/stderr
function runCommand(cmd, args, options = {}, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, options);
    let out = '';
    let err = '';
    let timedOut = false;

    const killer = setTimeout(() => {
      timedOut = true;
      try { p.kill('SIGKILL'); } catch {}
    }, timeoutMs);

    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('close', (code) => {
      clearTimeout(killer);
      if (timedOut) return resolve({ code: -1, out, err: (err || '') + ' [timeout]' });
      resolve({ code, out, err });
    });
  });
}

app.post("/ocr", upload.array("file"), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No files uploaded" });
  }

  const pythonCmd = process.env.PYTHON || "python3";

  // process a single file (async)
  async function processFile(file, idx) {
    const imgPath = path.resolve(file.path);
    const baseName = `ocr_result_${Date.now()}_${idx}`;
    const ocrOutPath = path.resolve(`uploads/${baseName}.txt`);
    const ocrRawPath = `${ocrOutPath}.raw`;
    const analysisPath = `${ocrOutPath}.analysis`;
    const filledPath = `${ocrOutPath}.filled`;
    const ocrTextPath = `${ocrOutPath}.enhanced_input`;

    const cleanup = () => {
      [imgPath, ocrOutPath, analysisPath, filledPath, ocrTextPath, ocrRawPath].forEach(f => {
        if (!f) return;
        fs.unlink(f, () => {});
      });
    };

    try {
      // run OCR worker
      // if user-words/patterns exist in ocr-worker, pass them to the CLI
      const userWords = path.join(ocrWorkerDir, 'config', 'user-words.txt');
      const userPatterns = path.join(ocrWorkerDir, 'config', 'user-patterns.txt');
      const args = ['main.py', imgPath];
      if (fs.existsSync(userWords)) args.push('--user-words', userWords);
      if (fs.existsSync(userPatterns)) args.push('--user-patterns', userPatterns);
      const ocrRes = await runCommand(pythonCmd, args, { cwd: ocrWorkerDir });
      if (ocrRes.code !== 0) {
        return { filename: file.originalname, error: 'OCR failed', details: ocrRes.err.trim() };
      }

      let ocrResult;
      try {
        ocrResult = JSON.parse(ocrRes.out);
      } catch (e) {
        ocrResult = { text: ocrRes.out, avg_conf: -1, analysis: {} };
      }
      const rawText = ocrResult.text || '';
      const normalizedText = normalizeOcrServer(rawText);
      // Keep raw for debugging, and normalized for downstream extraction
      fs.writeFileSync(ocrOutPath, normalizedText);
      fs.writeFileSync(ocrRawPath, rawText);

      // analysis step - always run to detect keywords for template filling
      try {
        const aRes = await runCommand(pythonCmd, ['analyze.py', ocrOutPath, '--avg_conf', String(ocrResult.avg_conf || -1)], { cwd: ocrWorkerDir });
        if (aRes.code === 0) {
          try { ocrResult.analysis = JSON.parse(aRes.out || '{}'); }
          catch { ocrResult.analysis = {}; }
        } else {
          ocrResult.analysis = {};
        }
      } catch (e) {
        ocrResult.analysis = {};
      }

      // Enhanced extraction with intelligent flagging and client requirements
      let enhancedData = {};
      let clientFeatures = {
        individual_pdf_ready: false,
        quality_checked: false,
        suggested_filename: '',
        flags_applied: 0,
        actions_required: 0
      };
      
      try {
        // Write OCR text to temporary file for enhanced processing
        fs.writeFileSync(ocrTextPath, normalizedText);
        
        // Use the new backend integration wrapper with OCR text
        const clientRes = await runCommand(
          pythonCmd,
          ['backend_integration.py', '--mode', 'single', '--text-file', ocrTextPath, '--confidence', String(ocrResult.avg_conf || -1)],
          { cwd: ocrWorkerDir }
        );

        if (clientRes.code === 0) {
          try {
            // Tolerate leading log lines (e.g., "spaCy not installed…") by parsing from first '{'
            const out = clientRes.out || '';
            const brace = out.indexOf('{');
            if (brace < 0) throw new Error('no JSON object found in stdout');
            const jsonText = out.slice(brace).trim();

            const clientData = JSON.parse(jsonText);
            if (clientData.success) {
              enhancedData = clientData.extracted_data || {};
              clientFeatures = {
                individual_pdf_ready: clientData.client_features?.individual_pdf_ready || false,
                quality_checked: clientData.client_features?.quality_checked || false,
                suggested_filename: clientData.suggested_filename || '',
                flags_applied: clientData.client_features?.flags_applied || 0,
                actions_required: clientData.client_features?.actions_required || 0,
                pdf_content: clientData.pdf_content,
                flags: clientData.flags || [],
                actions: clientData.actions || [],
                qc_results: clientData.qc_results || {},
                status: clientData.status || 'unknown'
              };
              if (clientData.pdf_content && !clientFeatures.individual_pdf_ready) {
                clientFeatures.individual_pdf_ready = true;
              }
            }
          } catch (e) {
            console.warn('Client integration not JSON; falling back', {
              preview: (clientRes.out || '').trim().slice(0, 200),
              err: (clientRes.err || '').trim().slice(0, 200),
              reason: e.message
            });
            // keep defaults and add a diagnostic flag so UI can surface it
            clientFeatures = {
              ...clientFeatures,
              status: clientFeatures.status || 'additional_actions_required',
              flags: [...(clientFeatures.flags || []), 'client_integration_error'],
              actions: [...(clientFeatures.actions || []), 'Review backend logs', 'Ensure Python emits JSON to stdout only'],
              qc_results: clientFeatures.qc_results || { errors: ['Client integration returned non-JSON'], warnings: [] }
            };
          }
        } else {
          console.warn('Client integration exited non-zero', { code: clientRes.code, err: (clientRes.err || '').trim().slice(0, 200) });
        }
        
      } catch (e) {
        enhancedData = {};
      }

      // fill template
      
      // Save analysis to temp file for template filler
      const templateContext = {
        ocr_analysis: ocrResult.analysis || {},
        // Canonical record aliases so downstream always has a single source of truth
        record: enhancedData,
        structured: enhancedData,
        enhanced_data: enhancedData,
        extracted_data: enhancedData,
        client_features: clientFeatures,
        avg_confidence: ocrResult.avg_conf,
        filename: file.originalname
      };
      fs.writeFileSync(analysisPath, JSON.stringify(templateContext));
      
      const fillRes = await runCommand(pythonCmd, ['fill_template.py', ocrOutPath, filledPath, analysisPath], { cwd: ocrWorkerDir });
      let filledText = '';
      try {
        filledText = fs.readFileSync(filledPath, 'utf8');
      } catch {
        filledText = '';
      }

      const resultObj = {
        filename: file.originalname,
        original_saved_name: undefined,
        text: ocrResult.text,
        avg_conf: ocrResult.avg_conf,
        analysis: enhancedData.procedure ? {
          cpt_code: Array.isArray(enhancedData.procedure.cpt)
            ? enhancedData.procedure.cpt.join(';')
            : (enhancedData.procedure.cpt || 'UNKNOWN'),
          confidence_bucket: (() => {
            const v = (typeof enhancedData.overall_confidence === 'number') ? enhancedData.overall_confidence
                    : (typeof ocrResult.avg_conf === 'number' ? ocrResult.avg_conf : undefined);
            if (typeof v !== 'number') return 'high';
            if (v >= 0.8) return 'high';
            if (v >= 0.6) return 'medium';
            return 'low';
          })(),
          contract_valid: null,
          insurance: {
            accepted: enhancedData.insurance?.primary?.carrier ? [enhancedData.insurance.primary.carrier] : [],
            auto_flag: [],
            contract_end: 'N/A'
          },
          dme: [],
          symptoms: {
            detected_symptoms: enhancedData.clinical?.symptoms || []
          }
        } : (ocrResult.analysis || {}),
        filled_template: filledText,
        enhanced_data: enhancedData,
        client_features: clientFeatures,
        suggested_filename: clientFeatures.suggested_filename,
        processing_status: clientFeatures.status,
        flags: clientFeatures.flags || [],
        actions: clientFeatures.actions || [],
        qc_results: clientFeatures.qc_results || {},
        individual_pdf_content: clientFeatures.pdf_content ? clientFeatures.pdf_content : undefined,
        ready_to_schedule: clientFeatures.status === 'ready_to_schedule'
      };

      // Persist a stable copy of the original upload for later export-combine
      try {
        const safeOriginal = (file.originalname || 'upload').replace(/[^A-Za-z0-9._-]+/g, '_');
        const savedOriginalName = `${Date.now()}_${idx}_${safeOriginal}`;
        const savedOriginalPath = path.join(uploadsDir, savedOriginalName);
        try {
          fs.copyFileSync(imgPath, savedOriginalPath);
          resultObj.original_saved_name = savedOriginalName;
        } catch (e) {
          console.warn('Failed to persist original upload copy:', e.message);
        }
      } catch (_) { /* ignore */ }
      return resultObj;
    } finally {
      cleanup();
    }
  }

  // Preserve original files for potential export later BEFORE processing
  // Copy files to permanent location with original names
  const preservedFiles = {};
  for (const file of req.files) {
    const permanentPath = path.join(uploadsDir, file.originalname);
    try {
      if (fs.existsSync(file.path)) {
        fs.copyFileSync(file.path, permanentPath);
        preservedFiles[file.originalname] = permanentPath;
        console.log(`Preserved file: ${file.originalname} -> ${permanentPath}`);
      } else {
        console.error(`Temporary file not found: ${file.path}`);
      }
    } catch (error) {
      console.error(`Failed to preserve file ${file.originalname}:`, error);
    }
  }

  const results = await Promise.all(req.files.map((f, i) => processFile(f, i)));
  const errorsCount = results.filter(r => r && r.error).length;

  // Clean up any remaining temporary files
  req.files.forEach(file => {
    if (fs.existsSync(file.path)) {
      fs.unlink(file.path, () => {});
    }
  });

  res.json({ results, errorsCount, preservedFiles });
});

// Re-extract from edited OCR text (no file upload)
app.post('/reextract-text', async (req, res) => {
  try {
    const { text, avg_conf } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Missing or invalid text' });
    }
    const pythonCmd = process.env.PYTHON || 'python3';
    const normalizedText = normalizeOcrServer(text);
    const tmpPath = path.join(uploadsDir, `edited_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(tmpPath, normalizedText);

    // Call backend integration in single mode
    const clientRes = await runCommand(
      pythonCmd,
      ['backend_integration.py', '--mode', 'single', '--text-file', tmpPath, '--confidence', String(typeof avg_conf === 'number' ? avg_conf : -1)],
      { cwd: ocrWorkerDir }
    );

    try { fs.unlinkSync(tmpPath); } catch {}

    if (clientRes.code !== 0) {
      return res.status(500).json({ success: false, error: 'Extraction failed', details: (clientRes.err || '').trim() });
    }

    // Parse JSON from stdout (skip possible logs before first '{')
    const raw = clientRes.out || '';
    const brace = raw.indexOf('{');
    if (brace < 0) return res.status(500).json({ success: false, error: 'Invalid extractor output' });
    const json = JSON.parse(raw.slice(brace));
    if (!json || json.success !== true) {
      return res.status(500).json({ success: false, error: 'Extractor returned non-success' });
    }
    // Return a trimmed payload similar to /ocr per-file result
    return res.json({
      success: true,
      enhanced_data: json.extracted_data || {},
      individual_pdf_content: json.individual_pdf_content || json.pdf_content || undefined,
      client_features: json.client_features || {},
      flags: json.flags || [],
      actions: json.actions || [],
      qc_results: json.qc_results || {},
      suggested_filename: json.suggested_filename || '',
      status: json.status || 'unknown'
    });
  } catch (e) {
    console.error('reextract-text error:', e);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// --- Simple rules API ---
function readUserRules() {
  try {
    const txt = fs.readFileSync(userRulesPath, 'utf8');
    const js = JSON.parse(txt);
    if (js && Array.isArray(js.rules)) return js;
    return { version: 1, rules: [] };
  } catch {
    return { version: 1, rules: [] };
  }
}

function writeUserRules(obj) {
  fs.writeFileSync(userRulesPath, JSON.stringify(obj, null, 2), 'utf8');
}

const FIELD_WHITELIST = new Set([
  'patient.dob', 'patient.mrn', 'patient.phone_home', 'patient.blood_pressure', 'patient.height', 'patient.weight', 'patient.bmi',
  'patient.first_name', 'patient.last_name', 'patient.email',
  'physician.name', 'physician.npi', 'physician.clinic_phone', 'physician.fax', 'physician.specialty',
  'physician.practice', 'physician.supervising',
  'insurance.primary.carrier', 'insurance.primary.member_id', 'insurance.primary.authorization_number', 'insurance.primary.insurance_verified',
  'insurance.primary.group', 'insurance.secondary.carrier', 'insurance.secondary.member_id',
  'procedure.cpt', 'procedure.study_requested', 'procedure.indication',
  'procedure.description',
  'clinical.primary_diagnosis', 'clinical.epworth_score', 'clinical.neck_circumference'
]);

app.get('/rules/list', (_req, res) => {
  res.json(readUserRules());
});

app.get('/rules/list-fields', (_req, res) => {
  res.json({ fields: Array.from(FIELD_WHITELIST) });
});

app.post('/rules/add', (req, res) => {
  try {
    const { field, pattern, flags = 'i', section = null, window = 500, postprocess = [], priority = 100 } = req.body || {};
    if (!FIELD_WHITELIST.has(field)) return res.status(400).json({ success: false, error: 'Invalid field' });
    if (!pattern || typeof pattern !== 'string' || pattern.length > 400) return res.status(400).json({ success: false, error: 'Invalid pattern' });
    const w = Number(window);
    if (Number.isNaN(w) || w < 100 || w > 2000) return res.status(400).json({ success: false, error: 'Invalid window' });
    // Basic JS regex compile for sanity (Python will compile again when applying)
    try { new RegExp(pattern, flags.includes('i') ? 'i' : undefined); } catch { return res.status(400).json({ success: false, error: 'Pattern does not compile' }); }
    const data = readUserRules();
      const id = randomBytes(6).toString('hex');
    data.rules.push({ id, field, pattern, flags, section, window: w, postprocess, priority });
    writeUserRules(data);
    res.json({ success: true, id, version: (data.version || 1), count: data.rules.length });
  } catch (e) {
    console.error('rules/add error', e);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

app.post('/rules/delete', (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'Missing id' });
    const data = readUserRules();
    const before = data.rules.length;
    data.rules = data.rules.filter(r => r.id !== id);
    writeUserRules(data);
    res.json({ success: true, removed: before - data.rules.length });
  } catch (e) {
    console.error('rules/delete error', e);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

app.post('/rules/toggle', (req, res) => {
  try {
    const { id, disabled } = req.body || {};
    if (!id || typeof disabled !== 'boolean') return res.status(400).json({ success: false, error: 'Missing id/disabled' });
    const data = readUserRules();
    const rule = data.rules.find(r => r.id === id);
    if (!rule) return res.status(404).json({ success: false, error: 'Rule not found' });
    rule.disabled = disabled;
    writeUserRules(data);
    res.json({ success: true });
  } catch (e) {
    console.error('rules/toggle error', e);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// Checklist ledger API
app.get('/checklist/list', async (req, res) => {
  try {
    const q = (s) => String(s || '').toLowerCase();
    const includeArchived = ['1','true','yes'].includes(q(req.query.include_archived));
    const archivedOnly = ['1','true','yes'].includes(q(req.query.archived_only)) || q(req.query.archived) === '1';
    const items = [];
    async function readDir(dir, archivedFlag) {
      let files = [];
      try { files = await fs.promises.readdir(dir); } catch { return; }
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
          const js = JSON.parse(await fs.promises.readFile(path.join(dir, f), 'utf8'));
          if (archivedFlag) js.archived = true; else js.archived = false;
          items.push(js);
        } catch (_) {}
      }
    }
    if (!archivedOnly) await readDir(getLedgerDir(), false);
    if (includeArchived || archivedOnly) await readDir(getLedgerArchiveDir(), true);
    items.sort((a,b)=> new Date(b.export_time) - new Date(a.export_time));
    res.json({ success: true, items });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to read checklist' });
  }
});

app.post('/checklist/update', async (req, res) => {
  try {
    const { id, status, color, checklist, note } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'Missing id' });
    let fp = path.join(getLedgerDir(), `${id}.json`);
    if (!fs.existsSync(fp)) {
      const alt = path.join(getLedgerArchiveDir(), `${id}.json`);
      if (fs.existsSync(alt)) fp = alt; else return res.status(404).json({ success: false, error: 'Record not found' });
    }
    const js = JSON.parse(await fs.promises.readFile(fp, 'utf8'));
    if (status) js.status = status;
    if (color) js.color = color;
    if (Array.isArray(checklist)) {
      const map = new Map((js.checklist || []).map(it => [it.key, it]));
      checklist.forEach(upd => {
        if (!upd || !upd.key) return;
        const cur = map.get(upd.key) || { key: upd.key, label: upd.label || upd.key, done: false };
        if (typeof upd.done === 'boolean') cur.done = upd.done;
        if (upd.label) cur.label = upd.label;
        map.set(upd.key, cur);
      });
      js.checklist = Array.from(map.values());
    }
    if (note) {
      js.notes = js.notes || [];
      js.notes.push({ when: new Date().toISOString(), text: String(note) });
    }
    await fs.promises.writeFile(fp, JSON.stringify(js, null, 2), 'utf8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to update record' });
  }
});

// Archive or restore a checklist record
app.post('/checklist/archive', async (req, res) => {
  try {
    const { id, archived } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'Missing id' });
    const inPath = path.join(getLedgerDir(), `${id}.json`);
    const archPath = path.join(getLedgerArchiveDir(), `${id}.json`);
    if (archived === false) {
      // restore from archive
      if (!fs.existsSync(archPath)) return res.status(404).json({ success: false, error: 'Record not archived' });
      await fs.promises.rename(archPath, inPath);
      return res.json({ success: true, archived: false });
    }
    // default: archive true
    if (!fs.existsSync(inPath)) return res.status(404).json({ success: false, error: 'Record not found' });
    await fs.promises.rename(inPath, archPath);
    res.json({ success: true, archived: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to archive/restore record' });
  }
});

// Import existing PDFs under export root and create ledger records for any missing
app.post('/checklist/import-scan', async (_req, res) => {
  try {
    const root = getExportRoot();
    const ledgerDir = getLedgerDir();
    // Load existing ledger entries to avoid duplicates (by file.path)
    const existing = new Set();
    try {
      const ledFiles = await fs.promises.readdir(ledgerDir);
      for (const f of ledFiles) {
        if (!f.endsWith('.json')) continue;
        try {
          const js = JSON.parse(await fs.promises.readFile(path.join(ledgerDir, f), 'utf8'));
          if (js?.file?.path) existing.add(js.file.path);
        } catch (_) {}
      }
    } catch (_) {}

    // Scan carrier folders one level deep (root/<Carrier>/*.pdf)
    const rootEntries = await fs.promises.readdir(root, { withFileTypes: true });
    const carriers = rootEntries.filter(d => d.isDirectory() && d.name !== 'ledger').map(d => d.name);
    const pdfs = [];
    for (const c of carriers) {
      const dir = path.join(root, c);
      try {
        const files = await fs.promises.readdir(dir);
        for (const f of files) {
          if (f.toLowerCase().endsWith('.pdf')) pdfs.push({ carrierFolder: c, file: f, full: path.join(dir, f) });
        }
      } catch (_) {}
    }

    let imported = 0;
    const parseFromName = (name) => {
      // "Last, First | DOB: MM/DD/YYYY | Insurance: Carrier | ID: Member"
      const m = /^(.+?),\s+(.+?)\s+\|\s+DOB:\s+([0-1]?\d\/[0-3]?\d\/\d{4})\s+\|\s+Insurance:\s+([^|]+?)\s+\|\s+ID:\s+(.+)$/i.exec(name.replace(/\.pdf$/i, ''));
      if (!m) return null;
      return { last: m[1].trim(), first: m[2].trim(), dob: m[3].trim(), insurance: m[4].trim(), member: m[5].trim() };
    };

    for (const p of pdfs) {
      if (existing.has(p.full)) continue;
      const parsed = parseFromName(p.file);
      if (!parsed) continue;
      const id = randomBytes(8).toString('hex');
      const stat = await fs.promises.stat(p.full);
      const record = {
        id,
        export_time: stat.mtime.toISOString(),
        patient: { first_name: parsed.first, last_name: parsed.last, dob: parsed.dob },
        insurance: { carrier: parsed.insurance, member_id: parsed.member },
        document_date: '',
        avg_conf: null,
        flags: [],
        actions: [],
        status: 'new',
        color: 'gray',
        checklist: [
          { key: 'verify_demographics', label: 'Verify demographics', done: false },
          { key: 'verify_insurance', label: 'Verify insurance', done: false },
          { key: 'submit_auth', label: 'Submit prior authorization', done: false },
          { key: 'attach_chart_notes', label: 'Attach chart notes', done: false },
          { key: 'upload_emr', label: 'Upload to EMR', done: false },
          { key: 'schedule_patient', label: 'Schedule patient', done: false },
          { key: 'patient_contacted', label: 'Patient contacted', done: false },
          // Common additional actions
          { key: 'gen_ins_verification_form', label: 'Generate insurance verification form', done: false },
          { key: 'sleep_questionnaire_call', label: 'Insufficient information - sleep questionnaire required, call patient', done: false },
          { key: 'order_correct_study', label: 'Wrong test ordered - need order for complete sleep study due to no testing in last 5 years', done: false },
          { key: 'fax_uts', label: 'Out of network - fax UTS → Generate UTS referral form', done: false },
          { key: 'auth_submit_fax', label: 'Authorization required - submit/fax request → Generate authorization form', done: false },
          { key: 'call_provider_demographics', label: 'Missing demographics - call provider for complete patient information', done: false },
          { key: 'provider_followup_docs', label: 'Provider follow-up required - obtain additional clinical documentation', done: false },
          { key: 'verify_coverage_current', label: 'Insurance expired/terminated - verify current coverage', done: false },
          { key: 'pediatric_specialist', label: 'Pediatric specialist referral required', done: false },
          { key: 'dme_evaluation_needed', label: 'DME evaluation needed before testing', done: false }
        ],
        file: { filename: p.file, path: p.full, carrier_folder: p.carrierFolder }
      };
      await fs.promises.writeFile(path.join(ledgerDir, `${id}.json`), JSON.stringify(record, null, 2), 'utf8');
      imported++;
    }
    res.json({ success: true, imported, scanned: pdfs.length });
  } catch (e) {
    console.error('import-scan error', e);
    res.status(500).json({ success: false, error: 'Import scan failed' });
  }
});

// New endpoint for batch processing with client requirements (cover sheets, etc.)
app.post("/batch-ocr", upload.array("file"), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No files uploaded" });
  }

  const pythonCmd = process.env.PYTHON || "python3";
  const intakeDate = req.body.intake_date || new Date().toLocaleDateString('en-US');
  const jobId = String((req.body && req.body.job_id) || randomBytes(6).toString('hex'));
  const startedAt = new Date().toISOString();
  batchProgress.set(jobId, { id: jobId, total: req.files.length, done: 0, status: 'processing', startedAt, updatedAt: startedAt, current: null, error: null });

  // Prepare optional user dictionaries for OCR bias
  const userWords = path.join(ocrWorkerDir, 'config', 'user-words.txt');
  const userPatterns = path.join(ocrWorkerDir, 'config', 'user-patterns.txt');

  const tempTextFiles = [];
  try {
    // Preserve original uploads for later export-combine (store under uploads/ by original name)
    try {
      for (const file of req.files) {
        const permanentPath = path.join(uploadsDir, file.originalname);
        if (fs.existsSync(file.path)) {
          try { fs.copyFileSync(file.path, permanentPath); } catch (_) {}
        }
      }
    } catch (_) {}

    // 1) OCR each uploaded file to normalized text files (with controlled concurrency)
    const cpuCount = (os.cpus && os.cpus().length) ? os.cpus().length : 4;
    const defaultLimit = Math.max(1, Math.min(4, Math.floor(cpuCount / 2) || 1));
    const limit = Math.max(1, Number(process.env.BATCH_OCR_CONCURRENCY || defaultLimit));
    const tempFilesArr = new Array(req.files.length);
    const ocrSummaryArr = new Array(req.files.length); // { text, avg_conf, originalFilename }
    const failedItems = [];
    const perFileTimeoutMs = Number(process.env.BATCH_OCR_TIMEOUT_MS || 180000);
    let idx = 0;
    const worker = async () => {
      while (true) {
        const i = idx++;
        if (i >= req.files.length) break;
        const f = req.files[i];
        const srcPath = path.resolve(f.path);
        const args = ['main.py', srcPath];
        if (fs.existsSync(userWords)) args.push('--user-words', userWords);
        if (fs.existsSync(userPatterns)) args.push('--user-patterns', userPatterns);
        const ocrRes = await runCommand(pythonCmd, args, { cwd: ocrWorkerDir }, { timeoutMs: perFileTimeoutMs });
        if (ocrRes.code !== 0) {
          const msg = `OCR failed: ${f.originalname} — ${(ocrRes.err || '').trim().slice(0, 160)}`;
          // Persist failed original to failed folder
          try {
            const failedDir = getFailedDir();
            const safeName = String(f.originalname || 'upload').replace(/[^A-Za-z0-9._-]+/g, '_');
            const dest = path.join(failedDir, `${Date.now()}_${safeName}`);
            if (fs.existsSync(srcPath)) fs.copyFileSync(srcPath, dest);
            failedItems.push({ filename: f.originalname, error: (ocrRes.code === -1 ? 'timeout' : (ocrRes.err || 'error')), saved_to: dest });
          } catch (_) {
            failedItems.push({ filename: f.originalname, error: (ocrRes.code === -1 ? 'timeout' : (ocrRes.err || 'error')) });
          }
          // Update progress and continue (do not abort batch)
          const prog = batchProgress.get(jobId);
          if (prog) {
            prog.done = Math.min(prog.total, (prog.done || 0) + 1);
            prog.current = f.originalname;
            prog.updatedAt = new Date().toISOString();
            prog.errors = Array.isArray(prog.errors) ? prog.errors : [];
            prog.errors.push({ filename: f.originalname, reason: (ocrRes.code === -1 ? 'timeout' : 'error') });
            batchProgress.set(jobId, prog);
          }
          continue;
        }
        let ocr;
        try { ocr = JSON.parse(ocrRes.out); }
        catch (_) { ocr = { text: ocrRes.out || '' }; }
        const normalized = normalizeOcrServer(ocr.text || '');
        const textPath = path.join(uploadsDir, `batch_${Date.now()}_${i}.txt`);
        fs.writeFileSync(textPath, normalized, 'utf8');
        tempFilesArr[i] = textPath;
        ocrSummaryArr[i] = { text: normalized, avg_conf: (typeof ocr.avg_conf === 'number' ? ocr.avg_conf : null), originalFilename: f.originalname };
        // Update progress
        const prog = batchProgress.get(jobId);
        if (prog) {
          prog.done = Math.min(prog.total, (prog.done || 0) + 1);
          prog.current = f.originalname;
          prog.updatedAt = new Date().toISOString();
          batchProgress.set(jobId, prog);
        }
      }
    };
    const workers = Array.from({ length: limit }, () => worker());
    await Promise.all(workers);
    // Rebuild list preserving input order and align summaries to the same order
    const ocrSuccArr = [];
    for (let i = 0; i < tempFilesArr.length; i++) {
      const p = tempFilesArr[i];
      if (p) {
        tempTextFiles.push(p);
        ocrSuccArr.push(ocrSummaryArr[i]);
      }
    }

    // 2) Run client requirements batch on produced OCR text files
    // Use manifest file to avoid OS arg limits when many files are present
    const manifestPath = path.join(uploadsDir, `batch_manifest_${Date.now()}.txt`);
    fs.writeFileSync(manifestPath, tempTextFiles.join('\n'), 'utf8');
    const batchArgs = [
      'backend_integration.py', '--mode', 'batch', '--files-manifest', manifestPath,
      '--intake-date', intakeDate
    ];
    const batchRes = await runCommand(pythonCmd, batchArgs, { cwd: ocrWorkerDir }, { timeoutMs: 180000 });
    if (batchRes.code !== 0) {
      const prog = batchProgress.get(jobId);
      if (prog) { prog.status = 'completed_with_errors'; prog.updatedAt = new Date().toISOString(); batchProgress.set(jobId, prog); }
      return res.status(500).json({ error: 'Batch processing failed', details: (batchRes.err || '').trim().slice(0, 500), job_id: jobId, failed_files: failedItems, failed_count: failedItems.length, processed_count: tempTextFiles.length });
    }
    let batchResults;
    try {
      const out = batchRes.out || '';
      const brace = out.indexOf('{');
      if (brace < 0) throw new Error('no JSON object in stdout');
      const jsonText = out.slice(brace);
      batchResults = JSON.parse(jsonText);
    } catch (e) {
      const prog = batchProgress.get(jobId);
      if (prog) { prog.status = 'error'; prog.error = `Failed to parse batch results: ${e.message}`; prog.updatedAt = new Date().toISOString(); batchProgress.set(jobId, prog); }
      return res.status(500).json({ error: 'Failed to parse batch results', details: e.message, preview: (batchRes.out || '').slice(0, 200), job_id: jobId, failed_files: failedItems, failed_count: failedItems.length, processed_count: tempTextFiles.length });
    }
    if (!batchResults.success) {
      const prog = batchProgress.get(jobId);
      if (prog) { prog.status = 'completed_with_errors'; prog.error = batchResults.error || 'Batch processing failed'; prog.updatedAt = new Date().toISOString(); batchProgress.set(jobId, prog); }
      return res.status(500).json({ error: batchResults.error || 'Batch processing failed', job_id: jobId, failed_files: failedItems, failed_count: failedItems.length, processed_count: tempTextFiles.length });
    }
    // Mark progress complete (with or without errors)
    const prog = batchProgress.get(jobId);
    if (prog) { prog.status = failedItems.length ? 'completed_with_errors' : 'complete'; prog.updatedAt = new Date().toISOString(); batchProgress.set(jobId, prog); }
    // Build per-file results similar to /ocr output so UI can render rows
    const perFileResults = (batchResults.individual_results || []).map((ind, i) => {
      const sum = ocrSuccArr[i] || {};
      const enhancedData = ind.extracted_data || {};
      const overallConf = (typeof enhancedData.overall_confidence === 'number') ? enhancedData.overall_confidence
                         : (typeof ind.confidence_score === 'number' ? ind.confidence_score : (sum.avg_conf || null));
      const proc = enhancedData.procedure || {};
      const analysis = proc ? {
        cpt_code: Array.isArray(proc.cpt) ? proc.cpt.join(';') : (proc.cpt || 'UNKNOWN'),
        confidence_bucket: (() => {
          const v = (typeof overallConf === 'number') ? overallConf : undefined;
          if (typeof v !== 'number') return 'high';
          const vv = v > 1 ? v : v; // tolerant of 0-1 or 0-100 scales
          if (vv >= 0.8 || vv >= 80) return 'high';
          if (vv >= 0.6 || vv >= 60) return 'medium';
          return 'low';
        })(),
        contract_valid: null,
        insurance: {
          accepted: enhancedData.insurance?.primary?.carrier ? [enhancedData.insurance.primary.carrier] : [],
          auto_flag: [],
          contract_end: 'N/A'
        },
        dme: [],
        symptoms: { detected_symptoms: enhancedData.clinical?.symptoms || [] }
      } : {};

      const filenameOut = sum.originalFilename || ind.source_file || `file_${i+1}`;
      return {
        filename: filenameOut,
        original_saved_name: filenameOut, // preserved under uploads/ by original name
        text: sum.text || '',
        avg_conf: (typeof ind.confidence_score === 'number' ? ind.confidence_score : sum.avg_conf || null),
        analysis,
        filled_template: '',
        enhanced_data: enhancedData,
        client_features: {
          individual_pdf_ready: !!(ind.individual_pdf_ready || ind.individual_pdf_content),
          quality_checked: true,
          flags_applied: Array.isArray(ind.flags) ? ind.flags.length : 0,
          actions_required: ind.status && ind.status !== 'ready_to_schedule' ? 1 : 0,
          pdf_content: ind.individual_pdf_content || undefined,
        },
        suggested_filename: ind.filename || '',
        processing_status: ind.status || 'unknown',
        flags: ind.flags || [],
        actions: ind.actions || [],
        qc_results: ind.qc_results || {},
        individual_pdf_content: ind.individual_pdf_content || undefined,
        ready_to_schedule: ind.status === 'ready_to_schedule'
      };
    });

    res.json({
      success: true,
      job_id: jobId,
      batch_type: 'client_requirements',
      intake_date: intakeDate,
      total_documents: batchResults.batch_summary.total_documents,
      ready_to_schedule: batchResults.batch_summary.ready_to_schedule,
      additional_actions_required: batchResults.batch_summary.additional_actions_required,
      individual_results: batchResults.individual_results,
      cover_sheet_content: batchResults.cover_sheet_content,
      filename_suggestions: batchResults.filename_suggestions,
      client_features: batchResults.client_features,
      processing_statistics: batchResults.batch_summary.statistics,
      processed_count: tempTextFiles.length,
      failed_count: failedItems.length,
      failed_files: failedItems,
      results: perFileResults
    });
  } catch (error) {
    const prog = batchProgress.get(jobId);
    if (prog) { prog.status = 'error'; prog.error = error.message || 'Server error'; prog.updatedAt = new Date().toISOString(); batchProgress.set(jobId, prog); }
    res.status(500).json({ error: 'Server error during batch processing', details: error.message, job_id: jobId });
  } finally {
    // Cleanup temp upload binaries and temp text files
    req.files.forEach(file => { if (file && file.path) fs.unlink(file.path, () => {}); });
    tempTextFiles.forEach(p => { try { fs.unlinkSync(p); } catch(_){} });
    try {
      if (manifestPath && fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
    } catch(_){}
  }
});



// Feedback endpoints
const feedbackDir = path.join(__dirname, 'feedback');
if (!fs.existsSync(feedbackDir)) {
  fs.mkdirSync(feedbackDir, { recursive: true });
}

app.post('/feedback', async (req, res) => {
  try {
    const { feedback, type, data, comment, comments, timestamp, ...ocrData } = req.body;
    
    // Handle both 'feedback' (from frontend) and 'type' fields
    const feedbackType = feedback === 'up' ? 'positive' : feedback === 'down' ? 'negative' : type;
    
    const feedbackEntry = {
      timestamp: timestamp || new Date().toISOString(),
      type: feedbackType,
      data: data || ocrData, // OCR data that was being reviewed
      comment: comment || comments || null
    };
    
    // Save to NDJSON file (one JSON object per line)
    const today = new Date().toISOString().split('T')[0];
    const feedbackFile = path.join(feedbackDir, `feedback-${today}.ndjson`);
    
    await fs.promises.appendFile(feedbackFile, JSON.stringify(feedbackEntry) + '\n', 'utf8');
    
    res.json({ success: true, message: 'Feedback recorded' });
  } catch (error) {
    console.error('Error saving feedback:', error);
    res.status(500).json({ success: false, error: 'Failed to save feedback' });
  }
});

app.get('/feedback/summary', async (req, res) => {
  try {
    const files = await fs.promises.readdir(feedbackDir);
    const ndjsonFiles = files.filter(f => f.endsWith('.ndjson'));
    
    let totalPositive = 0;
    let totalNegative = 0;
    let recentFeedback = [];
    
    for (const file of ndjsonFiles) {
      const filePath = path.join(feedbackDir, file);
      const content = await fs.promises.readFile(filePath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'positive') totalPositive++;
          if (entry.type === 'negative') totalNegative++;
          recentFeedback.push(entry);
        } catch (e) {
          console.error('Error parsing feedback line:', e);
        }
      }
    }
    
    // Sort by timestamp and take most recent 50
    recentFeedback.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    recentFeedback = recentFeedback.slice(0, 50);
    
    res.json({
      summary: {
        totalPositive,
        totalNegative,
        total: totalPositive + totalNegative
      },
      recentFeedback
    });
  } catch (error) {
    console.error('Error reading feedback:', error);
    res.status(500).json({ success: false, error: 'Failed to read feedback' });
  }
});

// Helper function to convert image to PDF with better quality
async function convertImageToPdf(imagePath) {
  try {
    const imageBytes = fs.readFileSync(imagePath);
    const pdf = await PDFDocument.create();
    
    let image;
    const ext = path.extname(imagePath).toLowerCase();
    
    if (ext === '.png') {
      image = await pdf.embedPng(imageBytes);
    } else if (ext === '.jpg' || ext === '.jpeg') {
      image = await pdf.embedJpg(imageBytes);
    } else {
      throw new Error(`Unsupported image format: ${ext}`);
    }
    
    // Get original image dimensions
    const { width, height } = image;
    
    // Create page with image dimensions or A4, whichever fits better
    const maxWidth = 595; // A4 width in points
    const maxHeight = 842; // A4 height in points
    
    let pageWidth = width;
    let pageHeight = height;
    
    // If image is too large, scale down to fit A4 while maintaining aspect ratio
    if (width > maxWidth || height > maxHeight) {
      const scale = Math.min(maxWidth / width, maxHeight / height);
      pageWidth = width * scale;
      pageHeight = height * scale;
    }
    
    const page = pdf.addPage([pageWidth, pageHeight]);
    
    // Draw image to fill the entire page
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    });
    
    return await pdf.save();
  } catch (error) {
    console.error('Error converting image to PDF:', error);
    throw error;
  }
}

// Helper function to create patient-based filename
function createPatientFilename(patientData) {
  try {
    const lastName = patientData.last_name || patientData['Last Name'] || 'Unknown';
    const firstName = patientData.first_name || patientData['First Name'] || 'Unknown';
    const dob = patientData.dob || patientData.DOB || patientData['Date of Birth'] || 'Unknown';
    const insurance = patientData.insurance || patientData['Insurance'] || patientData.carrier || 'Unknown';
    const memberId = patientData.member_id || patientData['Member ID'] || patientData.id || 'Unknown';
    
    // Format DOB to MM/DD/YYYY if it's in different format
    let formattedDOB = dob;
    if (dob !== 'Unknown') {
      const dobDate = new Date(dob);
      if (!isNaN(dobDate.getTime())) {
        formattedDOB = `${String(dobDate.getMonth() + 1).padStart(2, '0')}/${String(dobDate.getDate()).padStart(2, '0')}/${dobDate.getFullYear()}`;
      }
    }
    
    // Create filename and sanitize invalid characters
    const filename = `${lastName}, ${firstName} | DOB: ${formattedDOB} | Insurance: ${insurance} | ID: ${memberId}`;
    
    // Replace invalid filename characters
    return filename.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
  } catch (error) {
    console.error('Error creating patient filename:', error);
    return `Unknown_Patient_${Date.now()}`;
  }
}

// Export combined PDF endpoint
app.post('/export-combined', async (req, res) => {
  try {
    const { originalFilename, patientData, individualPatientPdfBase64 } = req.body;
    
    if (!patientData || !individualPatientPdfBase64) {
      return res.status(400).json({ success: false, error: 'Missing required data' });
    }
    
    // Create desktop export directory
    const desktopPath = path.join(os.homedir(), 'Desktop');
    const exportRoot = process.env.EXPORT_DIR || path.join(desktopPath, 'MEDOCR-Exports');
    const insCarrier = (patientData.insurance || patientData['Insurance'] || patientData.carrier || 'UnknownIns');
    const safeCarrier = String(insCarrier).replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_').trim() || 'UnknownIns';
    const exportDir = path.join(exportRoot, safeCarrier);
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
    
    // Generate patient-based filename
    const baseFilename = createPatientFilename(patientData);
    const outputPath = path.join(exportDir, `${baseFilename}.pdf`);
    
    // Create new PDF document
    const combinedPdf = await PDFDocument.create();
    // Embed a monospaced font for accurate text width and highlighting
    const monoFont = await combinedPdf.embedFont(StandardFonts.Courier);
    
    // Add Individual Patient PDF Form FIRST (the processed data)
    try {
      const individualPdfBytes = Buffer.from(individualPatientPdfBase64, 'base64');
      const individualPdf = await PDFDocument.load(individualPdfBytes);
      const individualPages = await combinedPdf.copyPages(individualPdf, individualPdf.getPageIndices());
      individualPages.forEach((page) => combinedPdf.addPage(page));
      console.log('Added Individual Patient PDF Form pages');
    } catch (error) {
      return res.status(400).json({ success: false, error: 'Invalid PDF data for patient form' });
    }
    
    // Add original PDF/Image SECOND (the source document for reference)
    if (originalFilename) {
      const originalFilePath = path.join(uploadsDir, originalFilename);
      if (fs.existsSync(originalFilePath)) {
        try {
          const ext = path.extname(originalFilename).toLowerCase();
          
          if (ext === '.pdf') {
            // Handle PDF files
            const originalPdfBytes = fs.readFileSync(originalFilePath);
            const originalPdf = await PDFDocument.load(originalPdfBytes);
            const originalPages = await combinedPdf.copyPages(originalPdf, originalPdf.getPageIndices());
            originalPages.forEach((page) => combinedPdf.addPage(page));
            console.log('Added original PDF pages');
          } else if (['.png', '.jpg', '.jpeg', '.tiff'].includes(ext)) {
            // Handle image files - convert to PDF first
            const imagePdfBytes = await convertImageToPdf(originalFilePath);
            const imagePdf = await PDFDocument.load(imagePdfBytes);
            const imagePages = await combinedPdf.copyPages(imagePdf, imagePdf.getPageIndices());
            imagePages.forEach((page) => combinedPdf.addPage(page));
            console.log('Added original image as PDF pages');
          } else {
            console.log('Unsupported original file format:', ext);
          }
        } catch (error) {
          console.log('Could not load original file, continuing with patient form only:', error.message);
        }
      } else {
        console.log('Original file not found at:', originalFilePath);
        console.log('Available files in uploads:', fs.readdirSync(uploadsDir));
      }
    }
    
    // Save combined PDF
    const combinedPdfBytes = await combinedPdf.save();
    fs.writeFileSync(outputPath, combinedPdfBytes);
    
    res.json({
      success: true,
      message: 'Combined PDF exported successfully',
      filename: `${baseFilename}.pdf`,
      path: outputPath
    });
    
  } catch (error) {
    console.error('Error exporting combined PDF:', error);
    res.status(500).json({ success: false, error: 'Failed to export combined PDF' });
  }
});

// NEW: Server-side generation of patient form PDF (avoids html2canvas blank issues)
app.post('/export-combined-data', async (req, res) => {
  try {
    const { originalFilename, enhancedData, avgConf, flags = [], actions = [], text = '' } = req.body;
    if (!enhancedData) {
      return res.status(400).json({ success: false, error: 'Missing enhancedData' });
    }

    // Derive patientData for filename
    const p = enhancedData.patient || {};
    const ins = (enhancedData.insurance && enhancedData.insurance.primary) || {};
    const patientData = {
      last_name: p.last_name || 'Unknown',
      first_name: p.first_name || 'Unknown',
      dob: p.dob || 'Unknown',
      // Prefer plan, then carrier
      insurance: ins.plan || ins.carrier || 'Unknown',
      member_id: ins.member_id || 'Unknown'
    };

    // Helper to build Client Summary PDF using pdf-lib
    function buildPatientFormPdf(data) {
      return PDFDocument.create().then(async pdf => {
        const page = pdf.addPage([612, 792]); // Letter size
        const { width, height } = page.getSize();
        const margin = 40;
        let y = height - margin;
        const lineGap = 16;

        const digits = (s) => String(s || '').replace(/\D/g, '');
        const last10 = (s) => {
          const d = digits(s);
          return d.length >= 10 ? d.slice(-10) : d;
        };
        const dedupePhoneFax = (phone, fax) => {
          const p10 = last10(phone);
          const f10 = last10(fax);
          if (p10 && f10 && p10 === f10) return phone || fax || 'Not found';
          if (phone && fax) return `${phone} | Fax: ${fax}`;
          return phone || fax || 'Not found';
        };
        const formatPercent = (v) => {
          if (typeof v !== 'number' || Number.isNaN(v)) return 'N/A';
          const val = v <= 1 ? v * 100 : v;
          return `${val.toFixed(1)}%`;
        };
        const clean = (s) => String(s ?? '')
          .replace(/^["':\s]+/, '')
          .replace(/\s+/g, ' ')
          .trim();

        const drawLine = (text, fontSize = 11, opts = {}) => {
          if (y < margin + 40) { // new page threshold
            y = height - margin;
            pdf.addPage([612, 792]);
            return drawLine(text, fontSize, opts);
          }
          const pageRef = pdf.getPages()[pdf.getPageCount() - 1];
            pageRef.drawText(String(text || ''), {
              x: margin,
              y: y - fontSize,
              size: fontSize,
              ...opts
            });
          y -= lineGap;
        };

        const section = (title) => {
          drawLine('');
          drawLine(title, 12, { });
        };

        // Title
        drawLine('Client Summary', 16);
        drawLine(`Generated: ${new Date().toLocaleString()}`, 8);

        section('PATIENT');
        drawLine(`Name: ${p.first_name || 'Not found'} ${p.last_name || ''}`);
        drawLine(`DOB: ${p.dob || 'Not found'}`);
        drawLine(`MRN: ${p.mrn || 'Not found'}`);
        // Only use explicit home phone for the patient; avoid clinic phone bleed-through
        drawLine(`Phone(Home): ${p.phone_home || 'Not found'}`);
        drawLine(`Blood Pressure: ${p.blood_pressure || 'Not found'}`);
        drawLine(`BMI: ${p.bmi || 'Not found'} | Height: ${p.height || '—'} | Weight: ${p.weight || '—'}`);

        section('INSURANCE');
        drawLine(`Carrier: ${ins.carrier || 'Not found'}`);
        drawLine(`Member ID: ${ins.member_id || 'Not found'}`);
        drawLine(`Authorization #: ${ins.authorization_number || 'Not found'}`);
        drawLine(`Verified: ${ins.insurance_verified || 'No'}`);

        const phy = enhancedData.physician || {};
        section('PHYSICIAN');
        drawLine(`Name: ${phy.name || 'Not found'}`);
        drawLine(`Referring Specialty: ${phy.specialty || 'Not found'}`);
        drawLine(`NPI: ${phy.npi || 'Not found'}`);
        drawLine(`Clinic Phone: ${dedupePhoneFax(phy.clinic_phone, phy.fax)}`);

        const proc = enhancedData.procedure || {};
        section('PROCEDURE');
        drawLine(`Study Requested: ${proc.study_requested || 'Not found'}`);
        drawLine(`CPT: ${(proc.cpt && proc.cpt.join(', ')) || 'Not found'}`);
        drawLine(`Indication: ${clean(proc.indication || proc.study_requested || 'Not found')}`);

        const clin = enhancedData.clinical || {};
        section('CLINICAL');
        drawLine(`Primary Dx: ${clin.primary_diagnosis || 'Not found'}`);
        drawLine(`Epworth: ${clin.epworth_score || 'Not found'}`);
        drawLine(`Symptoms: ${(clin.symptoms && clin.symptoms.join(', ')) || 'Not found'}`);
  // Neck circumference actually lives under clinical in enhancedData; previous code looked under patient (p)
        drawLine(`Neck Circumference: ${clin.neck_circumference || 'Not found'}`);

        section('METADATA');
        drawLine(`Document Date: ${enhancedData.document_date || 'Not found'}`);
        drawLine(`Intake Date: ${enhancedData.intake_date || 'Not found'}`);
        drawLine(`Extraction Method: ${enhancedData.extraction_method || 'Not found'}`);
        const ocVal = (typeof enhancedData.overall_confidence === 'number')
          ? enhancedData.overall_confidence
          : (typeof avgConf === 'number' ? (avgConf > 1 ? avgConf / 100 : avgConf) : null);
        drawLine(`Overall Confidence: ${ocVal === null ? 'N/A' : formatPercent(ocVal)}`);

        // FLAGS & ACTIONS
        if (Array.isArray(flags) && flags.length) {
          section('FLAGS');
          flags.forEach(f => drawLine(`• ${String(f)}`));
        }
        if (Array.isArray(actions) && actions.length) {
          section('ACTIONS');
          actions.forEach(a => drawLine(`• ${String(a)}`));
        }

        return pdf.save();
      });
    }

    const patientFormBytes = await buildPatientFormPdf(enhancedData);

    // Combine with original (reuse existing logic but simpler)
    const exportRoot = getExportRoot();
    const carrier = (patientData.insurance || 'UnknownIns');
    const safeCarrier = String(carrier).replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_').trim() || 'UnknownIns';
    const exportDir = path.join(exportRoot, safeCarrier);
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
    const baseFilename = createPatientFilename(patientData);
    const outputPath = path.join(exportDir, `${baseFilename}.pdf`);

    const combinedPdf = await PDFDocument.create();
    const monoFont = await combinedPdf.embedFont(StandardFonts.Courier);
    // Add patient form first
    try {
      const pfDoc = await PDFDocument.load(patientFormBytes);
      const pfPages = await combinedPdf.copyPages(pfDoc, pfDoc.getPageIndices());
      pfPages.forEach(p => combinedPdf.addPage(p));
    } catch (e) {
      return res.status(500).json({ success: false, error: 'Failed to build patient form PDF' });
    }

    // Sanitize incoming OCR text (strip logs/JSON wrappers)
    const rawTextIn = typeof text === 'string' ? text : '';
    function sanitizeOcrText(t) {
      if (!t) return '';
      const trimmed = t.trim();
      if (trimmed.startsWith('{')) {
        try {
          const j = JSON.parse(trimmed);
          if (j && typeof j.text === 'string') return j.text;
        } catch (_) { /* not JSON, continue */ }
      }
      const lines = t.split(/\r?\n/);
      let start = 0;
      while (
        start < lines.length &&
        !/^\s*Page\s*\d+\s*:/i.test(lines[start]) &&
        !lines[start].trim().startsWith('A') // common first line in our OCR previews
      ) {
        start++;
      }
      return lines.slice(start).join('\n');
    }
    const textSan = sanitizeOcrText(rawTextIn);

    // Optionally add OCR TEXT pages (split by form feed or explicit page markers)
    if (textSan && textSan.trim()) {
      // Build highlight terms from flags/actions and key extracted fields
      const shouldHighlight = (req.body.highlight !== false); // default to true unless explicitly disabled
      const collectTerms = () => {
        const terms = new Set();
        const add = (v) => { if (!v) return; const s = String(v).trim(); if (s.length >= 3) terms.add(s); };
        (flags || []).forEach(add);
        (actions || []).forEach(add);
        try {
          const p = (enhancedData && enhancedData.patient) || {};
          add(p.first_name); add(p.last_name); add(p.mrn); add(p.dob); add(p.phone_home);
          const ins = (enhancedData && enhancedData.insurance && enhancedData.insurance.primary) || {};
          add(ins.carrier); add(ins.member_id); add(ins.authorization_number); add(ins.group);
          const phy = (enhancedData && enhancedData.physician) || {};
          add(phy.name); add(phy.npi); add(phy.clinic_phone); add(phy.fax);
          const proc = (enhancedData && enhancedData.procedure) || {};
          if (Array.isArray(proc.cpt)) proc.cpt.forEach(add); else add(proc.cpt);
          add(proc.study_requested); add(proc.indication);
          const clin = (enhancedData && enhancedData.clinical) || {};
          add(clin.primary_diagnosis);
        } catch (_) {}
        // Limit size to avoid huge regexps
        return Array.from(terms).slice(0, 50);
      };
      const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const highlightTerms = shouldHighlight ? collectTerms() : [];
      const highlightRe = (highlightTerms && highlightTerms.length)
        ? new RegExp(`(${highlightTerms.map(escapeRe).join('|')})`, 'ig')
        : null;

      const addOcrPage = (doc, header, lines) => {
        const page = doc.addPage([612, 792]);
        const { height } = page.getSize();
        const margin = 40;
        let y = height - margin;
        const lineGap = 14;
        const draw = (t, size = 10) => {
          if (y < margin + 40) { y = height - margin; doc.addPage([612,792]); return draw(t, size); }
          const pg = doc.getPages()[doc.getPageCount()-1];
          pg.drawText(String(t||''), { x: margin, y: y - size, size, font: monoFont });
          y -= lineGap;
        };
        const drawSegmented = (prefix, content, size = 10) => {
          if (y < margin + 40) { y = height - margin; doc.addPage([612,792]); }
          const pg = doc.getPages()[doc.getPageCount()-1];
          let x = margin;
          // draw prefix first (line number, etc.)
          if (prefix) {
            pg.drawText(prefix, { x, y: y - size, size, font: monoFont });
            x += monoFont.widthOfTextAtSize(prefix, size);
          }
          if (!highlightRe) {
            pg.drawText(content, { x, y: y - size, size, font: monoFont });
            y -= lineGap;
            return;
          }
          let idx = 0;
          content.replace(highlightRe, (m, _g1, offset) => {
            const before = content.slice(idx, offset);
            if (before) {
              pg.drawText(before, { x, y: y - size, size, font: monoFont });
              x += monoFont.widthOfTextAtSize(before, size);
            }
            // highlighted match
            pg.drawText(m, { x, y: y - size, size, font: monoFont, color: rgb(0.85, 0.1, 0.1) });
            x += monoFont.widthOfTextAtSize(m, size);
            idx = offset + m.length;
            return m;
          });
          const rest = content.slice(idx);
          if (rest) pg.drawText(rest, { x, y: y - size, size, font: monoFont });
          y -= lineGap;
        };

        draw(header, 12);
        draw('');
        let n = 1;
        for (const rawLine of lines) {
          const line = String(rawLine || '');
          if (!line.trim()) { draw(''); continue; }
          // Basic wrap at ~90 chars
          const max = 90;
          const chunks = line.match(new RegExp(`.{1,${max}}`, 'g')) || [line];
          let first = true;
          for (const c of chunks) {
            const prefix = first ? String(n).padStart(3,' ') + ': ' : '     ';
            drawSegmented(prefix, c, 10);
            first = false;
          }
          n++;
        }
      };

      // Helper to split text into page-like segments
      const splitIntoPages = (txt) => {
        // Highest priority: explicit form-feed characters
        const ffSegs = String(txt).split('\f');
        if (ffSegs.length > 1) {
          return ffSegs.map((seg, i) => ({ header: `OCR Page ${i+1}`, lines: String(seg).split(/\r?\n/) }));
        }
        // Next: lines that begin with "Page N:" which our OCR emits for PDFs
        const lines = String(txt).split(/\r?\n/);
        const pages = [];
        let cur = [];
        let curHeader = null;
        let sawMarker = false;
        for (const ln of lines) {
          const m = /^\s*Page\s*(\d+)\s*:\s*(.*)$/i.exec(ln);
          if (m) {
            // flush previous page
            if (cur.length) pages.push({ header: curHeader || `OCR Page ${pages.length+1}`, lines: cur });
            cur = [];
            curHeader = `OCR Page ${m[1]}`;
            if (m[2]) cur.push(m[2]);
            sawMarker = true;
          } else {
            cur.push(ln);
          }
        }
        if (cur.length) pages.push({ header: curHeader || (sawMarker ? `OCR Page ${pages.length+1}` : 'OCR Text'), lines: cur });
        if (sawMarker && pages.length) return pages;
        // Next: split on decorative page marker lines like === Page N ===
        const parts = String(txt).split(/\n\s*[-=]{3,}\s*Page\s*\d+\s*[-=]{3,}\s*\n/i);
        if (parts.length > 1) {
          return parts.map((seg, i) => ({ header: `OCR Page ${i+1}`, lines: String(seg).split(/\r?\n/) }));
        }
        // Fallback: single page
        return [{ header: 'OCR Text', lines: String(txt).split(/\r?\n/) }];
      };

      const pages = splitIntoPages(textSan);
      pages.forEach(p => addOcrPage(combinedPdf, p.header, p.lines));
    }

    // Add original file pages
    if (originalFilename) {
      const originalFilePath = path.join(uploadsDir, originalFilename);
      if (fs.existsSync(originalFilePath)) {
        try {
          const ext = path.extname(originalFilename).toLowerCase();
          if (ext === '.pdf') {
            const origBytes = fs.readFileSync(originalFilePath);
            const origDoc = await PDFDocument.load(origBytes);
            const origPages = await combinedPdf.copyPages(origDoc, origDoc.getPageIndices());
            origPages.forEach(p => combinedPdf.addPage(p));
          } else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
            const imgPdfBytes = await convertImageToPdf(originalFilePath);
            const imgDoc = await PDFDocument.load(imgPdfBytes);
            const imgPages = await combinedPdf.copyPages(imgDoc, imgDoc.getPageIndices());
            imgPages.forEach(p => combinedPdf.addPage(p));
          }
        } catch (e) {
          console.log('Could not append original file:', e.message);
        }
      }
    }

    const outBytes = await combinedPdf.save();
    fs.writeFileSync(outputPath, outBytes);

    // Append checklist ledger record
    try {
      const id = randomBytes(8).toString('hex');
      const ledgerDir = getLedgerDir();
      const rec = {
        id,
        export_time: new Date().toISOString(),
        patient: { first_name: p.first_name || '', last_name: p.last_name || '', dob: p.dob || '' },
        insurance: { carrier: ins.carrier || '', member_id: ins.member_id || '' },
        document_date: enhancedData.document_date || '',
        avg_conf: typeof avgConf === 'number' ? avgConf : null,
        flags, actions,
        status: 'new',
        color: 'gray',
        checklist: [
          { key: 'verify_demographics', label: 'Verify demographics', done: false },
          { key: 'verify_insurance', label: 'Verify insurance', done: false },
          { key: 'submit_auth', label: 'Submit prior authorization', done: false },
          { key: 'attach_chart_notes', label: 'Attach chart notes', done: false },
          { key: 'upload_emr', label: 'Upload to EMR', done: false },
          { key: 'schedule_patient', label: 'Schedule patient', done: false },
          { key: 'patient_contacted', label: 'Patient contacted', done: false },
          // Common additional actions
          { key: 'gen_ins_verification_form', label: 'Generate insurance verification form', done: false },
          { key: 'sleep_questionnaire_call', label: 'Insufficient information - sleep questionnaire required, call patient', done: false },
          { key: 'order_correct_study', label: 'Wrong test ordered - need order for complete sleep study due to no testing in last 5 years', done: false },
          { key: 'fax_uts', label: 'Out of network - fax UTS → Generate UTS referral form', done: false },
          { key: 'auth_submit_fax', label: 'Authorization required - submit/fax request → Generate authorization form', done: false },
          { key: 'call_provider_demographics', label: 'Missing demographics - call provider for complete patient information', done: false },
          { key: 'provider_followup_docs', label: 'Provider follow-up required - obtain additional clinical documentation', done: false },
          { key: 'verify_coverage_current', label: 'Insurance expired/terminated - verify current coverage', done: false },
          { key: 'pediatric_specialist', label: 'Pediatric specialist referral required', done: false },
          { key: 'dme_evaluation_needed', label: 'DME evaluation needed before testing', done: false }
        ],
        file: { filename: `${baseFilename}.pdf`, path: outputPath, carrier_folder: safeCarrier }
      };
      fs.writeFileSync(path.join(ledgerDir, `${id}.json`), JSON.stringify(rec, null, 2), 'utf8');
    } catch (e) {
      console.warn('Checklist ledger write failed:', e.message);
    }

    res.json({ success: true, filename: `${baseFilename}.pdf`, path: outputPath, method: 'server-generated' });
  } catch (err) {
    console.error('Server export-combined-data error:', err);
    res.status(500).json({ success: false, error: 'Internal error creating PDF' });
  }
});

// OCR-Only Flag Analysis endpoint - applies flags directly to OCR text without template extraction
app.post('/ocr-flag-analysis', async (req, res) => {
  try {
    const { text, avgConf } = req.body;
    
    if (!text) {
      return res.status(400).json({ success: false, error: 'No OCR text provided' });
    }
    
    const pythonCmd = process.env.PYTHON || "python3";
    const ocrWorkerDir = path.join(__dirname, '..', 'ocr-worker');
    
    // Create temporary file for OCR text
    const tempId = randomBytes(8).toString('hex');
    const tempTextPath = path.join(uploadsDir, `${tempId}_ocr_text.txt`);
    
    try {
      // Write OCR text to temporary file
      fs.writeFileSync(tempTextPath, text);
      
      // Run flag analysis on OCR text
      const flagResult = await runCommand(
        pythonCmd, 
        ['enhanced_extract.py', '--text-only-flags', tempTextPath, '--confidence', String(avgConf || 0.8)],
        { cwd: ocrWorkerDir }
      );
      
      let flagData = {};
      if (flagResult.code === 0) {
        try {
          flagData = JSON.parse(flagResult.out || '{}');
        } catch (e) {
          console.error('Failed to parse flag analysis result:', e);
          flagData = { flags: [], actions: [], confidence: 'Medium' };
        }
      } else {
        console.error('Flag analysis failed:', flagResult.err);
        flagData = { flags: [], actions: [], confidence: 'Medium' };
      }
      
      // Clean up temp file
      fs.unlink(tempTextPath, () => {});
      
      res.json({
        success: true,
        flags: flagData.flags || [],
        actions: flagData.actions || [],
        confidence: flagData.confidence || 'Medium'
      });
      
    } catch (error) {
      // Clean up temp file on error
      if (fs.existsSync(tempTextPath)) {
        fs.unlink(tempTextPath, () => {});
      }
      throw error;
    }
    
  } catch (error) {
    console.error('OCR flag analysis error:', error);
    res.status(500).json({ success: false, error: 'Failed to analyze OCR text for flags' });
  }
});

// Mass export endpoint - creates individual PDFs for each document
app.post('/export-mass-combined', async (req, res) => {
  try {
    const { documents } = req.body;
    
    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ success: false, error: 'No documents provided for mass export' });
    }
    
    const results = [];
    let successCount = 0;
    let errorCount = 0;
    
    // Process each document individually
    for (const doc of documents) {
      try {
        const { originalFilename, enhancedData, avgConf, flags = [], actions = [], text } = doc;
        
        if (!enhancedData && !text) {
          results.push({ 
            filename: originalFilename, 
            success: false, 
            error: 'Missing both enhancedData and OCR text' 
          });
          errorCount++;
          continue;
        }
        
        // Derive patientData for filename
        const p = enhancedData.patient || {};
        const ins = (enhancedData.insurance && enhancedData.insurance.primary) || {};
        const patientData = {
          last_name: p.last_name || 'Unknown',
          first_name: p.first_name || 'Unknown',
          insurance: ins.plan || ins.carrier || 'UnknownIns'
        };
        
        // Create desktop export directory
        const desktopPath = path.join(os.homedir(), 'Desktop');
        const exportRoot = process.env.EXPORT_DIR || path.join(desktopPath, 'MEDOCR-Exports');
        const safeCarrier = String(patientData.insurance).replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_').trim() || 'UnknownIns';
        const exportDir = path.join(exportRoot, safeCarrier);
        if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
        
        // Generate patient-based filename
        const baseFilename = createPatientFilename(patientData);
        const outputPath = path.join(exportDir, `${baseFilename}.pdf`);
        
        // Create combined PDF for this document
        const combinedPdf = await PDFDocument.create();
        const monoFont = await combinedPdf.embedFont(StandardFonts.Courier);

        // Generate patient form PDF using server-side rendering
        const page = combinedPdf.addPage([612, 792]);
        const { width, height } = page.getSize();
        const margin = 50;
        const lineGap = 20;
        let y = height - margin;

        const newPage = () => { combinedPdf.addPage([612, 792]); y = height - margin; };

        const drawLine = (text, fontSize = 11, opts = {}) => {
          if (y < margin + 40) { newPage(); }
          const pageRef = combinedPdf.getPages()[combinedPdf.getPageCount() - 1];
          pageRef.drawText(String(text || ''), {
            x: margin,
            y: y - fontSize,
            size: fontSize,
            font: monoFont,
            ...opts
          });
          y -= lineGap;
        };

        // Optional highlight terms pulled from flags/actions and key fields
        const shouldHighlight = (doc.highlight !== false);
        const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const collectTerms = () => {
          const terms = new Set();
          const add = (v) => { if (!v) return; const s = String(v).trim(); if (s.length >= 3) terms.add(s); };
          (flags || []).forEach(add);
          (actions || []).forEach(add);
          try {
            const p = (enhancedData && enhancedData.patient) || {};
            add(p.first_name); add(p.last_name); add(p.mrn); add(p.dob); add(p.phone_home);
            const ins = (enhancedData && enhancedData.insurance && enhancedData.insurance.primary) || {};
            add(ins.carrier); add(ins.member_id); add(ins.authorization_number); add(ins.group);
            const phy = (enhancedData && enhancedData.physician) || {};
            add(phy.name); add(phy.npi); add(phy.clinic_phone); add(phy.fax);
            const proc = (enhancedData && enhancedData.procedure) || {};
            if (Array.isArray(proc.cpt)) proc.cpt.forEach(add); else add(proc.cpt);
            add(proc.study_requested); add(proc.indication);
          } catch (_) {}
          return Array.from(terms).slice(0, 50);
        };
        const highlightTerms = shouldHighlight ? collectTerms() : [];
        const highlightRe = (highlightTerms && highlightTerms.length)
          ? new RegExp(`(${highlightTerms.map(escapeRe).join('|')})`, 'ig')
          : null;

        const drawSegmented = (prefix, content, size = 10) => {
          if (y < margin + 40) { newPage(); }
          const pageRef = combinedPdf.getPages()[combinedPdf.getPageCount() - 1];
          let x = margin;
          if (prefix) {
            pageRef.drawText(prefix, { x, y: y - size, size, font: monoFont });
            x += monoFont.widthOfTextAtSize(prefix, size);
          }
          if (!highlightRe) {
            pageRef.drawText(content, { x, y: y - size, size, font: monoFont });
            y -= lineGap;
            return;
          }
          let idx = 0;
          content.replace(highlightRe, (m, _g1, offset) => {
            const before = content.slice(idx, offset);
            if (before) {
              pageRef.drawText(before, { x, y: y - size, size, font: monoFont });
              x += monoFont.widthOfTextAtSize(before, size);
            }
            pageRef.drawText(m, { x, y: y - size, size, font: monoFont, color: rgb(0.85, 0.1, 0.1) });
            x += monoFont.widthOfTextAtSize(m, size);
            idx = offset + m.length;
            return m;
          });
          const rest = content.slice(idx);
          if (rest) pageRef.drawText(rest, { x, y: y - size, size, font: monoFont });
          y -= lineGap;
        };
        
        const section = (title) => {
          drawLine('');
          drawLine(title, 12, {});
        };
        
        // Title and content - Use raw OCR text with better formatting
        drawLine('OCR TEXT EXTRACTION', 18, { color: rgb(0.1, 0.3, 0.8) });
        drawLine(`Generated: ${new Date().toLocaleString()}`, 10, { color: rgb(0.5, 0.5, 0.5) });
        drawLine('', 12); // spacing
        
        // Check if we have raw OCR text available
        if (text) {
          // Helper to split into page-like segments
          const splitIntoPages = (txt) => {
            const ffSegs = String(txt).split('\f');
            if (ffSegs.length > 1) return ffSegs.map((seg, i) => ({ header: `OCR Page ${i+1}`, lines: String(seg).split(/\r?\n/) }));
            const linesSrc = String(txt).split(/\r?\n/);
            const pages = [];
            let cur = [];
            let curHeader = null;
            let sawMarker = false;
            for (const ln of linesSrc) {
              const m = /^\s*Page\s*(\d+)\s*:\s*(.*)$/i.exec(ln);
              if (m) {
                if (cur.length) pages.push({ header: curHeader || `OCR Page ${pages.length+1}`, lines: cur });
                cur = [];
                curHeader = `OCR Page ${m[1]}`;
                if (m[2]) cur.push(m[2]);
                sawMarker = true;
              } else {
                cur.push(ln);
              }
            }
            if (cur.length) pages.push({ header: curHeader || (sawMarker ? `OCR Page ${pages.length+1}` : 'OCR Text'), lines: cur });
            if (sawMarker && pages.length) return pages;
            const parts = String(txt).split(/\n\s*[-=]{3,}\s*Page\s*\d+\s*[-=]{3,}\s*\n/i);
            if (parts.length > 1) return parts.map((seg, i) => ({ header: `OCR Page ${i+1}`, lines: String(seg).split(/\r?\n/) }));
            return [{ header: 'OCR Text', lines: String(txt).split(/\r?\n/) }];
          };

          const pages = splitIntoPages(text);
          pages.forEach((seg, i) => {
            if (i === 0) {
              // Header for OCR section on first page
              drawLine('RAW OCR TEXT (Unprocessed)', 14, { color: rgb(0.8, 0.3, 0.1) });
              drawLine(''.padEnd(60, '='), 10, { color: rgb(0.8, 0.3, 0.1) });
              drawLine('', 8);
            } else {
              // Force a new PDF page for each OCR page segment
              combinedPdf.addPage([612, 792]);
              // Reset Y for the newly added page
              y = height - margin;
              drawLine('RAW OCR TEXT (Unprocessed)', 14, { color: rgb(0.8, 0.3, 0.1) });
              drawLine(''.padEnd(60, '='), 10, { color: rgb(0.8, 0.3, 0.1) });
              drawLine('', 8);
            }
            // Per-page header
            drawLine(seg.header, 12, { color: rgb(0.2, 0.2, 0.2) });
            drawLine('', 6);
            let lineNumber = 1;
            for (const raw of seg.lines) {
              const line = String(raw || '');
              if (line.trim()) {
                const linePrefix = `${lineNumber.toString().padStart(3, ' ')}: `;
                const cleanLine = line.replace(/[\u{1F000}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '');
                const maxCharsPerLine = 65;
                if (cleanLine.length > maxCharsPerLine) {
                  const wrappedLines = cleanLine.match(new RegExp(`.{1,${maxCharsPerLine}}`, 'g')) || [];
                  let isFirstLine = true;
                  for (const wrappedLine of wrappedLines) {
                    const prefix = isFirstLine ? linePrefix : '     ';
                    drawSegmented(prefix, wrappedLine, 9);
                    isFirstLine = false;
                  }
                } else {
                  drawSegmented(linePrefix, cleanLine, 9);
                }
                lineNumber++;
              } else {
                drawLine('', 6);
              }
            }
          });
          // Footer for OCR section (counts for entire text body)
          drawLine('', 8);
          drawLine(''.padEnd(60, '='), 10, { color: rgb(0.8, 0.3, 0.1) });
      drawLine(`Characters: ${textSan.length}`, 10, { color: rgb(0.5, 0.5, 0.5) });
          
        } else if (enhancedData.ocr_text || enhancedData.raw_text) {
          const ocrText = enhancedData.ocr_text || enhancedData.raw_text;
          
          // Header for OCR section
          drawLine('RAW OCR TEXT (From Enhanced Data)', 14, { color: rgb(0.8, 0.3, 0.1) });
          drawLine(''.padEnd(60, '='), 10, { color: rgb(0.8, 0.3, 0.1) });
          drawLine('', 8); // spacing
          
          // Split OCR text into lines and render each line
          const textLines = ocrText.split('\n');
          let lineNumber = 1;
          
          for (const line of textLines) {
            if (line.trim()) {
              const linePrefix = `${lineNumber.toString().padStart(3, ' ')}: `;
              
              // Clean the line of problematic Unicode characters
              const cleanLine = line.replace(/[\u{1F000}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '');
              
              // Wrap long lines if needed
              const maxCharsPerLine = 65;
              if (cleanLine.length > maxCharsPerLine) {
                const wrappedLines = cleanLine.match(new RegExp(`.{1,${maxCharsPerLine}}`, 'g')) || [];
                let isFirstLine = true;
                for (const wrappedLine of wrappedLines) {
                  const prefix = isFirstLine ? linePrefix : '     ';
                  drawSegmented(prefix, wrappedLine, 9);
                  isFirstLine = false;
                }
              } else {
                drawSegmented(linePrefix, cleanLine, 9);
              }
              lineNumber++;
            } else {
              drawLine('', 6);
            }
          }
          
          drawLine('', 8);
          drawLine(''.padEnd(60, '='), 10, { color: rgb(0.8, 0.3, 0.1) });
          drawLine(`Total OCR Lines: ${lineNumber - 1} | Characters: ${ocrText.length}`, 10, { color: rgb(0.5, 0.5, 0.5) });
          
        } else {
          // Fallback to structured data if no raw OCR text
          drawLine('NO RAW OCR TEXT AVAILABLE - USING STRUCTURED DATA', 14, { color: rgb(0.8, 0.1, 0.1) });
          drawLine('', 8);
          
          section('PATIENT');
          drawLine(`Name: ${p.first_name || 'Not found'} ${p.last_name || ''}`);
          drawLine(`DOB: ${p.dob || 'Not found'}`);
          drawLine(`MRN: ${p.mrn || 'Not found'}`);
          drawLine(`Phone(Home): ${p.phone_home || 'Not found'}`);
          drawLine(`Blood Pressure: ${p.blood_pressure || 'Not found'}`);
          drawLine(`BMI: ${p.bmi || 'Not found'} | Height: ${p.height || '—'} | Weight: ${p.weight || '—'}`);
          
          section('INSURANCE');
          drawLine(`Carrier: ${ins.carrier || 'Not found'}`);
          drawLine(`Member ID: ${ins.member_id || 'Not found'}`);
          drawLine(`Authorization #: ${ins.authorization_number || 'Not found'}`);
          drawLine(`Verified: ${ins.insurance_verified || 'No'}`);
          
          const phy = enhancedData.physician || {};
          section('PHYSICIAN');
          drawLine(`Name: ${phy.name || 'Not found'}`);
          drawLine(`Specialty: ${phy.specialty || 'Not found'}`);
          drawLine(`NPI: ${phy.npi || 'Not found'}`);
          drawLine(`Clinic Phone: ${phy.clinic_phone || 'Not found'}`);
          
          const proc = enhancedData.procedure || {};
          section('PROCEDURE');
          drawLine(`Test: ${proc.test_type || 'Not found'}`);
          drawLine(`ICD-10: ${proc.icd_10 || 'Not found'}`);
          drawLine(`CPT: ${proc.cpt || 'Not found'}`);
        }
        // Add original file pages if available
        if (originalFilename) {
          const originalFilePath = path.join(uploadsDir, originalFilename);
          if (fs.existsSync(originalFilePath)) {
            try {
              const ext = path.extname(originalFilename).toLowerCase();
              if (ext === '.pdf') {
                const origBytes = fs.readFileSync(originalFilePath);
                const origDoc = await PDFDocument.load(origBytes);
                const origPages = await combinedPdf.copyPages(origDoc, origDoc.getPageIndices());
                origPages.forEach(p => combinedPdf.addPage(p));
              } else if (['.png', '.jpg', '.jpeg', '.tiff'].includes(ext)) {
                const imgPdfBytes = await convertImageToPdf(originalFilePath);
                const imgDoc = await PDFDocument.load(imgPdfBytes);
                const imgPages = await combinedPdf.copyPages(imgDoc, imgDoc.getPageIndices());
                imgPages.forEach(p => combinedPdf.addPage(p));
              }
            } catch (error) {
              console.log('Could not load original file for', originalFilename, ':', error.message);
            }
          }
        }
        
        // Save individual PDF
        const combinedPdfBytes = await combinedPdf.save();
        fs.writeFileSync(outputPath, combinedPdfBytes);
        
        results.push({
          filename: originalFilename,
          success: true,
          exportedAs: `${baseFilename}.pdf`,
          path: outputPath,
          carrier: safeCarrier
        });
        successCount++;
        
      } catch (error) {
        console.error('Error processing document:', error);
        results.push({
          filename: doc.originalFilename || 'Unknown',
          success: false,
          error: error.message
        });
        errorCount++;
      }
    }
    
    res.json({
      success: true,
      message: `Mass export completed: ${successCount} successful, ${errorCount} failed`,
      results,
      summary: {
        total: documents.length,
        successful: successCount,
        failed: errorCount
      }
    });
    
  } catch (error) {
    console.error('Mass export error:', error);
    res.status(500).json({ success: false, error: 'Failed to perform mass export' });
  }
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Backend running on http://localhost:${port}`));
