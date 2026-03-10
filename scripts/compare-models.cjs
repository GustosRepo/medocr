#!/usr/bin/env node
const sharp = require('sharp');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const TEST_PDF = process.argv[2] || '/Users/agyhernandez/Desktop/bench/Broadie, Pascha_95806,95810.pdf';
const outDir = '/tmp/vlm-test';

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// Clean old files
for (const f of fs.readdirSync(outDir)) {
  fs.unlinkSync(path.join(outDir, f));
}

console.log('Converting PDF page 1 to image...');
execSync(`pdftoppm -jpeg -f 1 -l 1 -r 150 "${TEST_PDF}" ${outDir}/page`);

const files = fs.readdirSync(outDir).filter(f => f.endsWith('.jpg'));
if (files.length === 0) {
  console.error('No images generated');
  process.exit(1);
}

const imgPath = path.join(outDir, files[0]);
const finalPath = path.join(outDir, 'page_final.jpg');

async function prepareImage() {
  const meta = await sharp(imgPath).metadata();
  console.log(`Original: ${meta.width}x${meta.height}`);

  const targetW = 1120;
  const scale = targetW / meta.width;
  const targetH = Math.round((meta.height * scale) / 28) * 28;

  await sharp(imgPath)
    .resize(targetW, targetH, { fit: 'fill' })
    .jpeg({ quality: 85 })
    .toFile(finalPath);

  console.log(`Resized: ${targetW}x${targetH}`);
  return finalPath;
}

function callOllama(model, imageBase64, prompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model,
      prompt,
      images: [imageBase64],
      stream: false,
      options: { temperature: 0.1 }
    });

    const start = Date.now();
    const req = http.request({
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/generate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 300000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        try {
          const parsed = JSON.parse(data);
          resolve({ response: parsed.response, elapsed, model });
        } catch (e) {
          resolve({ response: data.slice(0, 500), elapsed, model, error: 'parse_failed' });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => reject(new Error('timeout')));
    req.write(payload);
    req.end();
  });
}

const PROMPT = `Extract patient demographics from this medical document page. Return ONLY valid JSON:
{
  "patient": { "first": "", "last": "", "dob": "", "phones": [], "address": { "street": "", "city": "", "state": "", "zip": "" } },
  "insurance": [{ "carrier": "", "memberId": "" }],
  "referringProvider": { "name": "", "phone": "", "fax": "", "practice": "" },
  "procedure": { "cpt": "", "description": "" },
  "diagnoses": [{ "code": "", "description": "" }]
}
Rules: phones as digits only, dates as MM/DD/YYYY, separate patient phone from provider phone.`;

async function main() {
  const imgFile = await prepareImage();
  const imageBase64 = fs.readFileSync(imgFile).toString('base64');

  const models = ['qwen2.5vl:7b', 'granite3.2-vision'];

  for (const model of models) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`MODEL: ${model}`);
    console.log('='.repeat(60));
    console.log('Calling Ollama... (this may take 1-2 min)');

    try {
      const result = await callOllama(model, imageBase64, PROMPT);
      console.log(`Time: ${result.elapsed}s`);
      console.log('Response:');
      console.log(result.response);
    } catch (err) {
      console.error(`Error: ${err.message}`);
    }
  }
}

main().catch(console.error);
