// Minimal API client wrapping backend endpoints
const API_BASE = (typeof window !== 'undefined' && (window.__API_BASE__ || window.API_BASE))
  || (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE)
  || (typeof process !== 'undefined' && process.env && (process.env.REACT_APP_API_BASE || process.env.VITE_API_BASE))
  || 'http://localhost:5001';

async function toJson(resp) {
  let data;
  try { data = await resp.json(); }
  catch { data = { success: false, error: 'Invalid JSON response' }; }
  if (!resp.ok && !data.error) data.error = `HTTP ${resp.status}`;
  return data;
}

export async function ocr(formData) {
  const resp = await fetch(`${API_BASE}/ocr?lang=eng`, { method: 'POST', body: formData });
  return toJson(resp);
}

export async function batchOcr(formData) {
  const resp = await fetch(`${API_BASE}/batch-ocr`, { method: 'POST', body: formData });
  return toJson(resp);
}

export async function reextractText(payload) {
  const resp = await fetch(`${API_BASE}/reextract-text`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  return toJson(resp);
}

export async function exportCombinedData(payload) {
  const resp = await fetch(`${API_BASE}/export-combined-data`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  return toJson(resp);
}

export async function exportMassCombined(payload) {
  const resp = await fetch(`${API_BASE}/export-mass-combined`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  return toJson(resp);
}

export async function rulesListFields() {
  const resp = await fetch(`${API_BASE}/rules/list`);
  return toJson(resp);
}

export async function listAllowedFields() {
  const resp = await fetch(`${API_BASE}/rules/list-fields`);
  return toJson(resp);
}

export async function addRule(payload) {
  const resp = await fetch(`${API_BASE}/rules/add`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  return toJson(resp);
}

export async function checklistList() {
  const resp = await fetch(`${API_BASE}/checklist/list`);
  return toJson(resp);
}

export async function checklistUpdate(payload) {
  const resp = await fetch(`${API_BASE}/checklist/update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  return toJson(resp);
}

export async function checklistImportScan() {
  const resp = await fetch(`${API_BASE}/checklist/import-scan`, { method: 'POST' });
  return toJson(resp);
}

export async function feedback(payload) {
  const resp = await fetch(`${API_BASE}/feedback`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  return toJson(resp);
}

export async function ocrFlagAnalysis(payload) {
  const resp = await fetch(`${API_BASE}/ocr-flag-analysis`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  return toJson(resp);
}

export default {
  ocr, batchOcr,
  reextractText,
  exportCombinedData, exportMassCombined,
  rulesListFields, listAllowedFields, addRule,
  checklistList, checklistUpdate, checklistImportScan,
  feedback, ocrFlagAnalysis,
};
