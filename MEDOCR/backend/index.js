import express from "express";
import cors from "cors";
import multer from "multer";
import { spawn } from "child_process";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { EventEmitter } from "events";
import { randomBytes } from "crypto";
import os from "os";
import { fileURLToPath } from "url";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Text normalization to improve downstream extraction ---
function normalizeOcrServer(text = '') {
  let t = String(text || '');
  t = t.replace(/\r/g, '\n');
  t = t.replace(/[ \t]+\n/g, '\n');
  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/[’‘]/g, "'");
  t = t.replace(/[“”]/g, '"');
  t = t.replace(/\bIbs\b/gi, 'lbs');
  t = t.replace(/\bPuimonary\b/gi, 'Pulmonary');
  t = t.replace(/\bSpeciallst\b/gi, 'Specialist');
  t = t.replace(/\bDeseription\b/gi, 'Description');
  t = t.replace(/\bOlstructive\b/gi, 'Obstructive');
  t = t.replace(/circumferance/gi, 'circumference');
  // Fix glued MMDD and year like 00402/002024 -> 04/02/2024
  t = t.replace(/(Referral\/?order\s*date:\s*)0?(\d{2})(\d{2})\/0{1,2}(\d{4})/i, (_, p, mm, dd, yyyy) => `${p}${mm}/${dd}/${yyyy}`);
  t = t.replace(/(\b\d{1,2}\/\d{1,2}\/)+00(\d{4}\b)/g, (m) => m.replace('/00', '/'));
  t = t.replace(/(\b\d{1,2}\/\d{1,2}\/)+0(\d{4}\b)/g, (m) => m.replace('/0', '/'));

  // newline before likely section heads to break run-ons
  const heads = [
    'Referral Form','Patient:','DOB','MRN','Insurance (Primary)','Provider:','Specialty:','NPI','Clinic phone','Fax',
    'Procedure / Study','Requested','CPT','Priority','Indication','Clinical:','Symptoms','Epworth','Mallampati','Tonsil size',
    'Document / Metadata','Referral/order date','Intake/processing','Extraction method','Flags / Routing'
  ];
  const headUnion = heads.map(h => h.replace(/[-/\\^$*+?.()|[\]{}]/g, r => `\\${r}`)).join('|');
  t = t.replace(new RegExp(`\\s*(?=(?:${headUnion})\\b)`, 'g'), '\n');

  // Fix numbers split across lines
  t = t.replace(/(\d)[ \t]*\n[ \t]*(\d)/g, '$1$2');

  return t.trim();
}

const backendDir = path.resolve(__dirname);
const ocrWorkerDir = path.resolve(backendDir, "..", "ocr-worker");
const workerPath = path.join(ocrWorkerDir, "main.py");
const fillTemplatePath = path.join(ocrWorkerDir, "fill_template.py");
const templatePath = path.join(ocrWorkerDir, "template.txt");

const app = express();
const allowed = (process.env.CORS_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors(allowed.length ? { origin: allowed } : {}));
app.use(express.json());

const upload = multer({
  dest: path.join(os.tmpdir(), "medocr-uploads"),
  limits: { fileSize: 15 * 1024 * 1024, files: 50 },
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

// simple in-memory progress map: uploadId -> EventEmitter
const progressMap = new Map();

app.get("/health", (_req, res) => res.json({ ok: true }));


app.post("/ocr", upload.array("file"), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No files uploaded" });
  }

  const pythonCmd = process.env.PYTHON || "python3";

  // Create an upload id for progress tracking
  const uploadId = randomBytes(6).toString("hex");
  const emitter = new EventEmitter();
  progressMap.set(uploadId, emitter);

  // helper to run a child process and capture stdout/stderr
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

  // process a single file (async)
  async function processFile(file, idx) {
    const imgPath = path.resolve(file.path);
    const baseName = `ocr_result_${Date.now()}_${idx}`;
    const ocrOutPath = path.resolve(`uploads/${baseName}.txt`);
    const ocrRawPath = `${ocrOutPath}.raw`;
    const analysisPath = `${ocrOutPath}.analysis`;
    const filledPath = `${ocrOutPath}.filled`;
    const ocrTextPath = `${ocrOutPath}.enhanced_input`;
    emitter.emit('progress', { stage: 'queued', filename: file.originalname, idx });

    const cleanup = () => {
      [imgPath, ocrOutPath, analysisPath, filledPath, ocrTextPath, ocrRawPath].forEach(f => {
        if (!f) return;
        fs.unlink(f, () => {});
      });
    };

    try {
      // run OCR worker
      emitter.emit('progress', { stage: 'ocr_start', filename: file.originalname, idx });
      // if user-words/patterns exist in ocr-worker, pass them to the CLI
      const userWords = path.join(ocrWorkerDir, 'config', 'user-words.txt');
      const userPatterns = path.join(ocrWorkerDir, 'config', 'user-patterns.txt');
      const args = ['main.py', imgPath];
      if (fs.existsSync(userWords)) args.push('--user-words', userWords);
      if (fs.existsSync(userPatterns)) args.push('--user-patterns', userPatterns);
      const ocrRes = await runCommand(pythonCmd, args, { cwd: ocrWorkerDir });
      emitter.emit('progress', { stage: 'ocr_done', filename: file.originalname, idx, code: ocrRes.code });
      if (ocrRes.code !== 0) {
        emitter.emit('progress', { stage: 'error', filename: file.originalname, idx, error: ocrRes.err.trim() });
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
      emitter.emit('progress', { stage: 'analyze_start', filename: file.originalname, idx });
      try {
        const aRes = await runCommand(pythonCmd, ['analyze.py', ocrOutPath, '--avg_conf', String(ocrResult.avg_conf || -1)], { cwd: ocrWorkerDir });
        if (aRes.code === 0) {
          try { ocrResult.analysis = JSON.parse(aRes.out || '{}'); }
          catch { ocrResult.analysis = {}; }
        } else {
          ocrResult.analysis = {};
        }
        emitter.emit('progress', { stage: 'analyze_done', filename: file.originalname, idx, code: aRes.code });
      } catch (e) {
        ocrResult.analysis = {};
        emitter.emit('progress', { stage: 'analyze_error', filename: file.originalname, idx, error: String(e) });
      }

      // Enhanced extraction with intelligent flagging and client requirements
      emitter.emit('progress', { stage: 'enhanced_extract_start', filename: file.originalname, idx });
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
        
        emitter.emit('progress', { stage: 'enhanced_extract_done', filename: file.originalname, idx, code: clientRes.code });
      } catch (e) {
        enhancedData = {};
        emitter.emit('progress', { stage: 'enhanced_extract_error', filename: file.originalname, idx, error: String(e) });
      }

      // fill template
      emitter.emit('progress', { stage: 'fill_start', filename: file.originalname, idx });
      
      // Save analysis to temp file for template filler
      fs.writeFileSync(analysisPath, JSON.stringify(ocrResult.analysis || {}));
      
      const fillRes = await runCommand(pythonCmd, ['fill_template.py', ocrOutPath, filledPath, analysisPath], { cwd: ocrWorkerDir });
      emitter.emit('progress', { stage: 'fill_done', filename: file.originalname, idx, code: fillRes.code });
      let filledText = '';
      try {
        filledText = fs.readFileSync(filledPath, 'utf8');
      } catch {
        filledText = '';
      }

      const resultObj = {
        filename: file.originalname,
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
      return resultObj;
    } finally {
      cleanup();
    }
  }

  const results = await Promise.all(req.files.map((f, i) => processFile(f, i)));
  const errorsCount = results.filter(r => r && r.error).length;

  // after completion, emit complete and remove emitter after short timeout
  const em = progressMap.get(uploadId);
  if (em) {
    em.emit("progress", { stage: "complete", resultsCount: results.length });
    setTimeout(() => progressMap.delete(uploadId), 60 * 1000);
  }

  res.json({ uploadId, results, errorsCount });
});

// New endpoint for batch processing with client requirements (cover sheets, etc.)
app.post("/batch-ocr", upload.array("file"), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No files uploaded" });
  }

  const pythonCmd = process.env.PYTHON || "python3";
  const intakeDate = req.body.intake_date || new Date().toLocaleDateString('en-US');

  try {
    const filePaths = req.files.map(file => path.resolve(file.path));
    const batchArgs = [
      'backend_integration.py', '--mode', 'batch', '--files', ...filePaths,
      '--intake-date', intakeDate
    ];
    const batchRes = await runCommand(pythonCmd, batchArgs, { cwd: ocrWorkerDir });
    if (batchRes.code !== 0) {
      return res.status(500).json({ error: 'Batch processing failed', details: batchRes.err.trim() });
    }
    let batchResults;
    try { batchResults = JSON.parse(batchRes.out); }
    catch (e) { return res.status(500).json({ error: 'Failed to parse batch results', details: e.message }); }
    if (!batchResults.success) {
      return res.status(500).json({ error: batchResults.error || 'Batch processing failed' });
    }
    res.json({
      success: true,
      batch_type: 'client_requirements',
      intake_date: intakeDate,
      total_documents: batchResults.batch_summary.total_documents,
      ready_to_schedule: batchResults.batch_summary.ready_to_schedule,
      additional_actions_required: batchResults.batch_summary.additional_actions_required,
      individual_results: batchResults.individual_results,
      cover_sheet_content: batchResults.cover_sheet_content,
      filename_suggestions: batchResults.filename_suggestions,
      client_features: batchResults.client_features,
      processing_statistics: batchResults.batch_summary.statistics
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error during batch processing', details: error.message });
  } finally {
    req.files.forEach(file => { fs.unlink(file.path, () => {}); });
  }
});



// SSE endpoint to stream progress for an uploadId
app.get('/progress/:id', (req, res) => {
  const id = req.params.id;
  const em = progressMap.get(id);
  if (!em) {
    return res.status(404).json({ error: 'Upload id not found' });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  const onProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  const heartbeat = setInterval(() => res.write(`: ping\n\n`), 25000);
  em.on('progress', onProgress);
  req.on('close', () => {
    clearInterval(heartbeat);
    em.off('progress', onProgress);
  });
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Backend running on http://localhost:${port}`));
