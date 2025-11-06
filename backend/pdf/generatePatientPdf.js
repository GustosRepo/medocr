// Generate patient PDF from runExtraction() result using EJS and an external pdfWriter(html)
// Production-safe: no logs; throw helpful error if pdfWriter not provided

import fs from 'fs/promises';
import path from 'path';
import ejs from 'ejs';
import { fileURLToPath } from 'url';
import { buildPatientReport } from '../rules/reportBuilder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function generatePatientPdf(extractionResult, options = {}) {
  const report = buildPatientReport(extractionResult || {});
  const templatePath = options.templatePath || path.resolve(__dirname, './templates/patientReport.ejs');
  const templateStr = await fs.readFile(templatePath, 'utf8');
  const html = ejs.render(templateStr, { report }, { rmWhitespace: true });

  const pdfWriter = options.pdfWriter || null;
  if (typeof pdfWriter !== 'function') {
    throw new Error('Missing pdfWriter(html) function. Provide options.pdfWriter that returns a PDF Buffer.');
  }
  const pdfBuffer = await pdfWriter(html);

  if (options.outputPath) {
    await fs.writeFile(options.outputPath, pdfBuffer);
    return options.outputPath;
  }
  return pdfBuffer; // Buffer
}

/*
Usage example (after runExtraction or runExtractionWithDates):

import { generatePatientPdf } from './backend/pdf/generatePatientPdf.js';
import { runExtractionWithDates } from './backend/rules/index.js';

// Example pdfWriter using Puppeteer (ensure dependency installed in your project):
// const pdfWriter = async (html) => {
//   const puppeteer = await import('puppeteer');
//   const browser = await puppeteer.launch({ headless: 'new' });
//   const page = await browser.newPage();
//   await page.setContent(html, { waitUntil: 'networkidle0' });
//   const buffer = await page.pdf({ format: 'Letter', printBackground: true, margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' } });
//   await browser.close();
//   return buffer;
// };

// (async () => {
//   // obtain OCR pages, e.g., from your OCR pipeline
//   const ocrPages = [];
//   const { result } = await runExtractionWithDates(ocrPages);
//   const pdfBufferOrPath = await generatePatientPdf(result, { pdfWriter });
// })();
*/
