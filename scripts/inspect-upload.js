#!/usr/bin/env node
// Upload a PDF to the local API, poll status, fetch result with debug trace, and save to data/results/<id>.json
// Usage: node scripts/inspect-upload.js /absolute/path/to/file.pdf [apiBase]

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

const apiBase = process.argv[3] || process.env.API_BASE || 'http://127.0.0.1:4387';
const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node scripts/inspect-upload.js /path/to/file.pdf [apiBase]');
  process.exit(1);
}

async function main() {
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
  }
  const buf = await fsp.readFile(filePath);
  const form = new FormData();
  const blob = new Blob([buf], { type: 'application/pdf' });
  form.append('file', blob, path.basename(filePath));

  const up = await fetch(`${apiBase}/api/documents`, { method: 'POST', body: form });
  if (!up.ok) {
    console.error('Upload failed:', up.status, await up.text());
    process.exit(1);
  }
  const { id } = await up.json();
  console.log('Enqueued id:', id);

  // Poll status
  let attempts = 0;
  let status = 'queued';
  while (attempts < 60) {
    const st = await fetch(`${apiBase}/api/documents/${id}/status`);
    const sj = await st.json();
    status = sj.status;
    process.stdout.write(`\rStatus: ${status}   `);
    if (status === 'done' || status === 'error') break;
    await new Promise(r => setTimeout(r, 500));
    attempts++;
  }
  console.log();

  const res = await fetch(`${apiBase}/api/documents/${id}/result?debug=1`);
  if (!res.ok) {
    console.error('Result error:', res.status, await res.text());
    process.exit(1);
  }
  const data = await res.json();

  const outDir = path.join(process.cwd(), 'data', 'results');
  await fsp.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${id}.json`);
  await fsp.writeFile(outPath, JSON.stringify(data, null, 2));
  console.log('Saved result:', outPath);

  // Print a tiny summary
  const p = data.patient || {};
  const ins = (data.insurance || [])[0] || {};
  const dx = (data.diagnoses || []).map(d => d.code).join(', ');
  const dme = data.dme || {};
  const traceCount = (data.debug?.trace || []).length;
  console.log('\nSummary:');
  console.log('-', 'Name:', [p.last, p.first].filter(Boolean).join(', '));
  console.log('-', 'DOB:', p.dob || '');
  console.log('-', 'CPT:', data.procedure?.cpt || '');
  console.log('-', 'ICDs:', dx || '');
  console.log('-', 'Insurance:', [ins.carrier, ins.status].filter(Boolean).join(' / ') || '');
  console.log('-', 'DME codes/providers:', (dme.codes || []).join(', '), '/', (dme.providers || []).join(', '));
  console.log('-', 'Confidence:', data.confidence || '');
  console.log('-', 'Rules fired:', traceCount);
}

main().catch(err => { console.error(err); process.exit(1); });
