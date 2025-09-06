import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, 'uploads');
const exportDir = path.join(__dirname, 'test-exports');
if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

function digits(s) { return String(s || '').replace(/\D/g, ''); }
function last10(s) { const d = digits(s); return d.length >= 10 ? d.slice(-10) : d; }
function dedupePhoneFax(phone, fax) {
  const p10 = last10(phone);
  const f10 = last10(fax);
  if (p10 && f10 && p10 === f10) return phone || fax || 'Not found';
  if (phone && fax) return `${phone} | Fax: ${fax}`;
  return phone || fax || 'Not found';
}
function formatPercent(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 'N/A';
  const val = v <= 1 ? v * 100 : v;
  return `${val.toFixed(1)}%`;
}

async function convertImageToPdf(imagePath) {
  const imageBytes = fs.readFileSync(imagePath);
  const pdf = await PDFDocument.create();
  let image;
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === '.png') image = await pdf.embedPng(imageBytes);
  else if (ext === '.jpg' || ext === '.jpeg') image = await pdf.embedJpg(imageBytes);
  else throw new Error(`Unsupported image format: ${ext}`);
  const { width, height } = image;
  const maxWidth = 595, maxHeight = 842; // A4
  let pageWidth = width, pageHeight = height;
  if (width > maxWidth || height > maxHeight) {
    const scale = Math.min(maxWidth / width, maxHeight / height);
    pageWidth = width * scale; pageHeight = height * scale;
  }
  const page = pdf.addPage([pageWidth, pageHeight]);
  page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  return await pdf.save();
}

async function buildPatientFormPdf(enhancedData, avgConf) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const { height } = page.getSize();
  const margin = 40; let y = height - margin; const lineGap = 16;
  const drawLine = (text, fontSize = 11, opts = {}) => {
    if (y < margin + 40) { y = height - margin; pdf.addPage([612, 792]); return drawLine(text, fontSize, opts); }
    const pageRef = pdf.getPages()[pdf.getPageCount() - 1];
    pageRef.drawText(String(text || ''), { x: margin, y: y - fontSize, size: fontSize, ...opts });
    y -= lineGap;
  };
  const section = (title) => { drawLine(''); drawLine(title, 12, {}); };

  const p = enhancedData.patient || {}; const ins = (enhancedData.insurance && enhancedData.insurance.primary) || {}; const phy = enhancedData.physician || {}; const proc = enhancedData.procedure || {}; const clin = enhancedData.clinical || {};
  drawLine('Individual Patient PDF Form', 16);
  drawLine(`Generated: ${new Date().toLocaleString()}`, 8);
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
  section('PHYSICIAN');
  drawLine(`Name: ${phy.name || 'Not found'}`);
  drawLine(`Specialty: ${phy.specialty || 'Not found'}`);
  drawLine(`NPI: ${phy.npi || 'Not found'}`);
  drawLine(`Clinic Phone: ${dedupePhoneFax(phy.clinic_phone, phy.fax)}`);
  section('PROCEDURE');
  drawLine(`Study Requested: ${proc.study_requested || 'Not found'}`);
  drawLine(`CPT: ${(proc.cpt && proc.cpt.join(', ')) || 'Not found'}`);
  drawLine(`Indication: ${proc.indication || proc.study_requested || 'Not found'}`);
  section('CLINICAL');
  drawLine(`Primary Dx: ${clin.primary_diagnosis || 'Not found'}`);
  drawLine(`Epworth: ${clin.epworth_score || 'Not found'}`);
  drawLine(`Symptoms: ${(clin.symptoms && clin.symptoms.join(', ')) || 'Not found'}`);
  drawLine(`Neck Circumference: ${clin.neck_circumference || 'Not found'}`);
  section('METADATA');
  drawLine(`Document Date: ${enhancedData.document_date || 'Not found'}`);
  drawLine(`Intake Date: ${enhancedData.intake_date || 'Not found'}`);
  drawLine(`Extraction Method: ${enhancedData.extraction_method || 'Not found'}`);
  const ocVal = (typeof enhancedData.overall_confidence === 'number') ? enhancedData.overall_confidence : (typeof avgConf === 'number' ? (avgConf > 1 ? avgConf / 100 : avgConf) : null);
  drawLine(`Overall Confidence: ${ocVal === null ? 'N/A' : formatPercent(ocVal)}`);
  return await pdf.save();
}

async function main() {
  // Copy a known test image into uploads
  const sourceImg = path.join(__dirname, '..', 'ocr-worker', 'testv3.png');
  const savedName = 'devtest_testv3.png';
  const destImg = path.join(uploadsDir, savedName);
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  fs.copyFileSync(sourceImg, destImg);

  const enhancedData = {
    document_date: '04/02/2024',
    intake_date: '04/04/2024',
    extraction_method: 'Overall',
    patient: { first_name: 'John', last_name: 'Miller', dob: '03/15/1970', mrn: '128097', phone_home: '', blood_pressure: '124/80', bmi: '27.5', height: "5'5\"" },
    insurance: { primary: { carrier: 'HealthPlanCo', member_id: '8473920101', authorization_number: '12345', insurance_verified: 'Yes' } },
    physician: { name: 'Dr. Brian Hayes', specialty: 'Pulmonary', npi: '2173659837', clinic_phone: '(602) 555-0014', fax: '(602) 555-0014' },
    procedure: { study_requested: 'Sleep study', cpt: ['95810'], indication: 'Obstructive sleep apnea' },
    clinical: { primary_diagnosis: 'Obstructive sleep apnea', epworth_score: '16/24', symptoms: ['snoring', 'gasping'] }
  };
  const avgConf = 0.92;

  const combinedPdf = await PDFDocument.create();
  const pfBytes = await buildPatientFormPdf(enhancedData, avgConf);
  const pfDoc = await PDFDocument.load(pfBytes);
  const pfPages = await combinedPdf.copyPages(pfDoc, pfDoc.getPageIndices());
  pfPages.forEach(p => combinedPdf.addPage(p));

  const imgPdfBytes = await convertImageToPdf(destImg);
  const imgDoc = await PDFDocument.load(imgPdfBytes);
  const imgPages = await combinedPdf.copyPages(imgDoc, imgDoc.getPageIndices());
  imgPages.forEach(p => combinedPdf.addPage(p));

  const outPath = path.join(exportDir, 'devtest_combined.pdf');
  const bytes = await combinedPdf.save();
  fs.writeFileSync(outPath, bytes);
  console.log('Combined PDF written to:', outPath);
}

main().catch(err => { console.error(err); process.exit(1); });

