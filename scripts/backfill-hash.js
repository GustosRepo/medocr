#!/usr/bin/env node
/**
 * Backfill fileHash into existing result JSONs.
 * Scans data/uploads/ to build a hash→filepath map, then for each result
 * missing documentMeta.fileHash, tries to match by multer filename embedded
 * in the upload path pattern.
 * 
 * Usage: node scripts/backfill-hash.js [--dry-run]
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESULTS_DIR = path.join(__dirname, '..', 'data', 'results');
const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');
const dryRun = process.argv.includes('--dry-run');

if (dryRun) console.log('=== DRY RUN ===');

// Step 1: Build hash index of all uploads
console.log('Indexing uploads...');
const uploadFiles = fs.readdirSync(UPLOADS_DIR).filter(f => {
  const fp = path.join(UPLOADS_DIR, f);
  return fs.statSync(fp).isFile();
});

const hashToPath = new Map();
const pathToHash = new Map();
for (const f of uploadFiles) {
  const fp = path.join(UPLOADS_DIR, f);
  const buf = fs.readFileSync(fp);
  const h = crypto.createHash('sha256').update(buf).digest('hex');
  hashToPath.set(h, fp);
  pathToHash.set(fp, h);
}
console.log(`Indexed ${hashToPath.size} uploads`);

// Step 2: Process result JSONs
const resultFiles = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));
let patched = 0;
let alreadyOk = 0;
let noMatch = 0;

for (const file of resultFiles) {
  const fp = path.join(RESULTS_DIR, file);
  const result = JSON.parse(fs.readFileSync(fp, 'utf8'));

  if (result.documentMeta && result.documentMeta.fileHash) {
    alreadyOk++;
    continue;
  }

  // Strategy: The upload path was data/uploads/<multerHash>
  // The doc ID is in the filename: doc_<timestamp>_<random>.json
  // We can try to find the upload by checking if originalFilePath is stored
  const storedPath = result.documentMeta && result.documentMeta.originalFilePath;
  if (storedPath && fs.existsSync(storedPath)) {
    const buf = fs.readFileSync(storedPath);
    const h = crypto.createHash('sha256').update(buf).digest('hex');
    if (!result.documentMeta) result.documentMeta = {};
    result.documentMeta.fileHash = h;
    if (!dryRun) {
      fs.writeFileSync(fp, JSON.stringify(result, null, 2));
    }
    patched++;
    console.log(`  Patched (via path): ${file}`);
    continue;
  }

  // Strategy 2: The filename in documentMeta might help us narrow down.
  // But multer names are random hashes - no direct link to original filename.
  // 
  // Strategy 3: Brute force - for each upload, check if it was recently modified
  // around the doc processing time. The doc timestamp is in the filename.
  const docId = file.replace('.json', '');
  const match = docId.match(/doc_(\d+)_/);
  if (match) {
    const docTimestamp = parseInt(match[1]);
    const docDate = new Date(docTimestamp);
    
    // Find uploads created within 60 seconds of the doc timestamp
    let bestMatch = null;
    let bestDiff = Infinity;
    
    for (const uf of uploadFiles) {
      const ufp = path.join(UPLOADS_DIR, uf);
      const stat = fs.statSync(ufp);
      const mtimeMs = stat.mtimeMs;
      // Use birthtime (creation time) if available, else mtime
      const createMs = stat.birthtimeMs || mtimeMs;
      const diff = Math.abs(createMs - docTimestamp);
      if (diff < bestDiff && diff < 120000) { // within 2 minutes
        bestDiff = diff;
        bestMatch = ufp;
      }
    }
    
    if (bestMatch) {
      const hash = pathToHash.get(bestMatch);
      if (!result.documentMeta) result.documentMeta = {};
      result.documentMeta.fileHash = hash;
      result.documentMeta.originalFilePath = bestMatch;
      if (!dryRun) {
        fs.writeFileSync(fp, JSON.stringify(result, null, 2));
      }
      patched++;
      console.log(`  Patched (via timestamp ${bestDiff}ms): ${file} -> ${path.basename(bestMatch)}`);
      continue;
    }
  }

  noMatch++;
  console.log(`  No match: ${file}`);
}

console.log(`\nDone: ${patched} patched, ${alreadyOk} already ok, ${noMatch} no match`);
