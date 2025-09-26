import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

export function listBatchDates(docs) {
  const set = new Set();
  for (const [, entry] of docs.entries()) {
    const d = entry?.result?.documentMeta?.intakeDate;
    if (d) set.add(d);
  }
  return Array.from(set).sort();
}

export function collectBatchDocs(docs, date) {
  const out = [];
  for (const [id, entry] of docs.entries()) {
    const intakeDate = entry?.result?.documentMeta?.intakeDate;
    if (intakeDate === date) {
      out.push({ id, entry });
    }
  }
  return out;
}

export function summarizeActions(entries) {
  const counts = new Map();
  for (const { entry } of entries) {
    const acts = entry?.result?.alerts?.actions || [];
    for (const a of acts) counts.set(a, (counts.get(a) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({ action: k, count: v }));
}

export function buildCoverJson(docs, date) {
  const entries = collectBatchDocs(docs, date);
  const total = entries.length;
  let done = 0, errors = 0, inprogress = 0, manual = 0;
  const patients = [];
  for (const { id, entry } of entries) {
    if (entry.status === 'done') done++; else if (entry.status === 'error') errors++; else inprogress++;
    if (entry?.result?.flags?.verifyManually) manual++;
    const p = entry?.result?.patient || {};
    patients.push({
      id,
      name: [p.last, p.first].filter(Boolean).join(', ') || 'Unknown',
      dob: p.dob || null,
      insurance: entry?.result?.insurance?.carrier || null,
      memberId: entry?.result?.insurance?.memberId || null,
      actions: entry?.result?.alerts?.actions || []
    });
  }
  return {
    date,
    totals: { processed: total, done, errors, inprogress, manual },
    topActions: summarizeActions(entries),
    patients
  };
}

export function buildProblemLogJson(docs, date) {
  const entries = collectBatchDocs(docs, date);
  const problemEntries = entries.filter(({ entry }) => entry?.result?.flags?.verifyManually || (entry?.result?.alerts?.actions || []).length);
  const items = problemEntries.map(({ id, entry }) => {
    const p = entry?.result?.patient || {};
    return {
      id,
      name: [p.last, p.first].filter(Boolean).join(', ') || 'Unknown',
      dob: p.dob || null,
      insurance: entry?.result?.insurance?.carrier || null,
      insuranceStatus: entry?.result?.insurance?.status || 'unknown',
      cpt: entry?.result?.procedure?.cpt || null,
      reasons: entry?.result?.flags?.reasons || [],
      actions: entry?.result?.alerts?.actions || [],
      suggestedFilename: entry?.result?.documentMeta?.suggestedFilename || null
    };
  });
  return { date, count: items.length, items };
}

function drawHeader(doc, title, logoPath) {
  const top = 36;
  const left = 36;
  if (logoPath && fs.existsSync(logoPath)) {
    try { doc.image(logoPath, left, top, { height: 32 }); } catch {}
  }
  doc.fontSize(16).text(title, logoPath ? 36 + 140 : left, top + 8, { continued: false });
  doc.moveTo(left, top + 44).lineTo(doc.page.width - left, top + 44).strokeColor('#999').stroke();
  doc.moveDown();
}

export function renderCoverPdf(res, coverJson, logoPath) {
  const doc = new PDFDocument({ margin: 36, autoFirstPage: true });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);
  drawHeader(doc, 'Batch Cover Sheet', logoPath);

  const { date, totals, topActions, patients } = coverJson;
  doc.fontSize(12).fillColor('#000');
  doc.text(`Date: ${date}`);
  doc.text(`Processed: ${totals.processed}  Done: ${totals.done}  Error: ${totals.errors}  In-Progress: ${totals.inprogress}  Manual Review: ${totals.manual}`);
  doc.moveDown();

  doc.fontSize(13).text('Top Actions');
  doc.fontSize(11);
  for (const t of topActions.slice(0, 20)) {
    doc.text(`${t.action}: ${t.count}`);
  }
  doc.addPage();

  doc.fontSize(13).text('Patients');
  doc.fontSize(10);
  // Simple tabular columns
  const colWidths = [200, 100, 150, 100];
  const headers = ['Name', 'DOB', 'Insurance', 'Actions'];
  const startX = doc.x, startY = doc.y + 6;
  const drawRow = (cells) => {
    let x = startX;
    for (let i = 0; i < cells.length; i++) {
      const w = colWidths[i] || 120;
      doc.text(String(cells[i] || ''), x, doc.y, { width: w });
      x += w + 8;
    }
    doc.moveDown(0.5);
  };
  doc.font('Helvetica-Bold'); drawRow(headers); doc.font('Helvetica');
  for (const p of patients) {
    const acts = (p.actions || []).slice(0, 3).join(', ');
    drawRow([p.name, p.dob || '', p.insurance || '', acts]);
    // Pagination
    if (doc.y > doc.page.height - 72) { doc.addPage(); doc.font('Helvetica-Bold'); drawRow(headers); doc.font('Helvetica'); }
  }
  doc.end();
}

export function renderProblemLogPdf(res, problemJson, logoPath) {
  const doc = new PDFDocument({ margin: 36, autoFirstPage: true });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);
  drawHeader(doc, 'Problem Log', logoPath);

  const { date, items } = problemJson;
  doc.fontSize(12).fillColor('#000');
  doc.text(`Date: ${date}`);
  doc.moveDown();

  doc.fontSize(10);
  const colWidths = [200, 80, 120, 70, 150];
  const headers = ['Patient', 'DOB', 'Insurance(Status)', 'CPT', 'Reasons'];
  const startX = doc.x;
  const drawRow = (cells) => {
    let x = startX;
    for (let i = 0; i < cells.length; i++) {
      const w = colWidths[i] || 120;
      doc.text(String(cells[i] || ''), x, doc.y, { width: w });
      x += w + 8;
    }
    doc.moveDown(0.5);
  };
  doc.font('Helvetica-Bold'); drawRow(headers); doc.font('Helvetica');
  for (const it of items) {
    const ins = it.insurance ? `${it.insurance} (${it.insuranceStatus || 'unknown'})` : '';
    const reasons = (it.reasons || []).slice(0, 4).join(', ');
    drawRow([it.name, it.dob || '', ins, it.cpt || '', reasons]);
    const actions = (it.actions || []).slice(0, 4).join(', ');
    doc.text(`Actions: ${actions}`);
    doc.moveDown(0.35);
    if (doc.y > doc.page.height - 72) { doc.addPage(); doc.font('Helvetica-Bold'); drawRow(headers); doc.font('Helvetica'); }
  }
  doc.end();
}
