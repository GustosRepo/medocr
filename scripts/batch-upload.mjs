#!/usr/bin/env node

// Upload all PDFs from a directory to the medocr backend
import fs from 'fs';
import path from 'path';
import http from 'http';

const BENCH_DIR = process.argv[2] || '/Users/agyhernandez/Desktop/bench';
const API_HOST = '127.0.0.1';
const API_PORT = 4387;

const files = fs.readdirSync(BENCH_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
console.log(`Found ${files.length} PDFs in ${BENCH_DIR}`);

async function uploadFile(filePath, filename) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const fileBuffer = fs.readFileSync(filePath);
    
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/pdf\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, fileBuffer, footer]);

    const req = http.request({
      hostname: API_HOST,
      port: API_PORT,
      path: '/api/documents',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ raw: data, status: res.statusCode });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const startTime = Date.now();
  const results = [];

  for (const file of files) {
    const filePath = path.join(BENCH_DIR, file);
    console.log(`Uploading: ${file}`);
    try {
      const resp = await uploadFile(filePath, file);
      const id = resp.id || resp.docId || 'unknown';
      console.log(`  → ID: ${id}, status: ${resp.status || 'ok'}`);
      results.push({ file, id, ok: true });
    } catch (err) {
      console.error(`  → ERROR: ${err.message}`);
      results.push({ file, id: null, ok: false, error: err.message });
    }
  }

  console.log(`\nAll ${files.length} files uploaded in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`Success: ${results.filter(r => r.ok).length}, Failed: ${results.filter(r => !r.ok).length}`);
  console.log('\nProcessing will take ~4 min per doc. Monitor with:');
  console.log('  tail -f data/logs/backend.log | grep vlm_direct');
}

main().catch(console.error);
