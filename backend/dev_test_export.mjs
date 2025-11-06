#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { annotatePdfWithOcrSpans, DEFAULT_ANNOTATION_SCOPE_COLORS } from './utils/pdfAnnotation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function usage() {
  console.error('Usage: node backend/dev_test_export.mjs <result.json> [original.pdf] [output.pdf|output-directory]');
  console.error('When original.pdf is omitted, the script tries <result-basename>.pdf next to the JSON.');
  console.error('When output path is omitted, writes to backend/test-exports/<result-basename>-annotated.pdf');
}

function resolvePdfPath(jsonPath, candidate) {
  if (candidate) {
    const abs = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(abs)) return abs;
    throw new Error(`PDF file not found: ${abs}`);
  }
  const fallback = path.join(path.dirname(jsonPath), `${path.basename(jsonPath, path.extname(jsonPath))}.pdf`);
  if (fs.existsSync(fallback)) return fallback;
  throw new Error('Unable to locate original PDF. Provide path explicitly.');
}

function resolveOutputPath(outputArg, jsonPath) {
  if (outputArg) {
    const abs = path.resolve(process.cwd(), outputArg);
    if (abs.toLowerCase().endsWith('.pdf')) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      return abs;
    }
    fs.mkdirSync(abs, { recursive: true });
    return path.join(abs, `${path.basename(jsonPath, path.extname(jsonPath))}-annotated.pdf`);
  }
  const defaultDir = path.join(__dirname, 'test-exports');
  fs.mkdirSync(defaultDir, { recursive: true });
  return path.join(defaultDir, `${path.basename(jsonPath, path.extname(jsonPath))}-annotated.pdf`);
}

function normalizeSpans(spans) {
  if (!Array.isArray(spans)) return [];
  return spans
    .map(span => {
      const page = Number(span?.page) || 1;
      const bbox = span?.bbox || span?.bounds || null;
      const scopeId = span?.scopeId || span?.scope || 'default';
      const field = span?.field || span?.label || null;
      if (!bbox || typeof bbox.x !== 'number') {
        if (Array.isArray(bbox) && bbox.length >= 4) {
          const [x, y, w, h] = bbox.map(n => Number(n) || 0);
          return { page, scopeId, field, bbox: { x, y, width: w, height: h } };
        }
        const obj = {
          x: Number(span?.x) || 0,
          y: Number(span?.y) || 0,
          width: Number(span?.width) || 0,
          height: Number(span?.height) || 0
        };
        if (obj.width <= 0 || obj.height <= 0) return null;
        return { page, scopeId, field, bbox: obj };
      }
      const width = typeof bbox.width === 'number' ? bbox.width : Number(span?.width) || 0;
      const height = typeof bbox.height === 'number' ? bbox.height : Number(span?.height) || 0;
      if (width <= 0 || height <= 0) return null;
      return {
        page,
        scopeId,
        field,
        bbox: { x: bbox.x, y: bbox.y, width, height }
      };
    })
    .filter(Boolean);
}

async function main() {
  const [jsonArg, pdfArg, outputArg] = process.argv.slice(2);
  if (!jsonArg) {
    usage();
    process.exit(1);
  }

  const jsonPath = path.resolve(process.cwd(), jsonArg);
  if (!fs.existsSync(jsonPath)) {
    console.error(`Result JSON not found: ${jsonPath}`);
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    console.error(`Failed to parse JSON (${jsonPath}): ${err.message}`);
    process.exit(1);
  }

  let pdfPath;
  try {
    pdfPath = resolvePdfPath(jsonPath, pdfArg);
  } catch (err) {
    console.error(err.message);
    usage();
    process.exit(1);
  }

  let spans = normalizeSpans(payload?.debug?.spans || payload?.spans);
  const scopeColors = payload?.debug?.scopeColors || payload?.scopeColors || DEFAULT_ANNOTATION_SCOPE_COLORS;

  if (!spans.length) {
    console.warn('No highlight spans found in debug data. Output will be a copy of the original PDF.');
  }

  const outputPath = resolveOutputPath(outputArg, jsonPath);

  try {
    const pdfBytes = fs.readFileSync(pdfPath);
    let resultBytes;
    if (spans.length) {
      resultBytes = await annotatePdfWithOcrSpans(pdfBytes, spans, { scopeColors });
    } else {
      resultBytes = pdfBytes;
    }
    fs.writeFileSync(outputPath, resultBytes);
    console.log(`Annotated PDF written to ${outputPath}`);
    if (!spans.length) {
      console.log('Tip: ensure your JSON includes debug.spans for highlight overlay.');
    }
  } catch (err) {
    console.error(`Failed to build annotated PDF: ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
