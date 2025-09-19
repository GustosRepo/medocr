import React, { useMemo, useState, useEffect } from 'react';
import FeedbackPanel from './panels/FeedbackPanel';
import ExportPanel from './panels/ExportPanel';

function mergeDeep(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return target;
  Object.entries(source).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      if (!Array.isArray(target[key]) || target[key].length === 0) {
        target[key] = value.slice();
      } else {
        const existing = new Set(target[key].map((item) => JSON.stringify(item)));
        const merged = target[key].slice();
        value.forEach((item) => {
          const sig = JSON.stringify(item);
          if (!existing.has(sig)) {
            existing.add(sig);
            merged.push(item);
          }
        });
        target[key] = merged;
      }
    } else if (typeof value === 'object') {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) {
        target[key] = {};
      }
      mergeDeep(target[key], value);
    } else if (target[key] === undefined || target[key] === null || target[key] === '') {
      target[key] = value;
    }
  });
  return target;
}

function buildStructured(result) {
  const sources = [
    result?.enhanced_data,
    result?.analysis?.enhanced_data,
    result?.analysis?.extracted_data,
    result?.analysis?.normalized,
    result?.analysis?.ocr_analysis,
    result?.analysis,
    result?.filled_template,
  ];
  return sources.reduce((acc, src) => mergeDeep(acc, src), {});
}

function pickValue(structured, paths) {
  for (const path of paths) {
    const value = path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), structured);
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length) return trimmed;
    } else if (typeof value === 'number') {
      return value;
    } else if (Array.isArray(value)) {
      if (value.length) return value;
    } else if (typeof value === 'object' && Object.keys(value).length) {
      return value;
    }
  }
  return '';
}

function formatList(value) {
  if (!value) return 'Not provided';
  if (Array.isArray(value)) {
    const filtered = value.map((v) => (typeof v === 'string' ? v.trim() : v)).filter(Boolean);
    return filtered.length ? filtered.join(', ') : 'Not provided';
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : 'Not provided';
  }
  return String(value);
}

function computeConfidence(result, structured) {
  const label = pickValue(structured, [[ 'confidence_label' ], [ 'client_features', 'status' ]])
    || result?.client_features?.status
    || result?.processing_status
    || 'Unknown';
  const rawScore = pickValue(structured, [
    ['confidence_scores', 'overall_confidence'],
    ['overall_confidence'],
  ]) || result?.avg_conf;
  let pct = null;
  if (typeof rawScore === 'number' && !Number.isNaN(rawScore)) {
    pct = rawScore <= 1 ? rawScore * 100 : rawScore;
  }
  return { label, pct };
}

export default function ResultCard({
  r,
  idx,
  files,
  collapsedRows,
  toggleRowCollapse,
  handleFeedback,
  handleExportCombinedPdf,
  openHtmlInNewWindow,
  setEditTarget,
  setEditText,
}) {
  const resultId = r.id || r.suggested_filename || r.filename || `res-${idx}`;
  const isCollapsed = !!(collapsedRows && collapsedRows[resultId]);
  const [showDebug, setShowDebug] = useState(false);

  const structured = useMemo(() => buildStructured(r), [r]);

  const templateHtml =
    r?.filled_template
    || structured?.filled_template
    || r?.individual_pdf_content
    || r?.client_features?.individual_pdf_content
    || r?.client_features?.pdf_content
    || structured?.pdf_content
    || structured?.template_html;

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editedHtml, setEditedHtml] = useState('');
  const [localTemplateHtml, setLocalTemplateHtml] = useState(templateHtml);

  // keep local copy in sync when backend result changes
  useEffect(() => {
    setLocalTemplateHtml(templateHtml);
  }, [templateHtml]);

  const patient = structured?.patient || {};
  const insurancePrimary = structured?.insurance?.primary || {};
  const insuranceSecondary = structured?.insurance?.secondary || {};
  const procedure = structured?.procedure || {};
  const physician = structured?.physician || {};
  const clinical = structured?.clinical || {};

  const cleanString = (value) => {
    if (!value) return '';
    return String(value)
      .replace(/\r|\n|\t|\f/g, ' ')
      .replace(/\\N/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const collapseCarrier = (value) => {
    const str = cleanString(value);
    if (!str) return str;
    return str.split(/\b(?:Subscriber|Member|Address|Phone)\b/)[0].replace(/[,;:]$/, '').trim();
  };

  const collapsePhysician = (value) => {
    const str = cleanString(value);
    if (!str) return str;
    return str
      .split(/\bProvider\s+(?:Facility|Speciality|NPI|UPIN|1D Number)\b/)[0]
      .split(/\bAddress\b/)[0]
      .replace(/[,;:]$/, '')
      .trim();
  };

  const patientFirst = pickValue(structured, [['patient', 'first_name'], ['patient', 'first'], ['patient', 'given_name']]);
  const patientLast = pickValue(structured, [['patient', 'last_name'], ['patient', 'last'], ['patient', 'family_name']]);
  const patientName = cleanString(
    pickValue(structured, [['patient', 'name'], ['patient_name']])
    || [patientFirst, patientLast].filter(Boolean).join(' ')
  );
  const patientDob = pickValue(structured, [['patient', 'dob'], ['dob'], ['patient', 'date_of_birth']]);
  const referralDate = pickValue(structured, [['document_date'], ['referral', 'date'], ['referral_date']]);
  const mrn = pickValue(structured, [['patient', 'mrn'], ['mrn']]);
  const patientPhone = cleanString(pickValue(structured, [['patient', 'phone_home'], ['patient', 'phone'], ['phone_number']])) || 'Not provided';
  const patientEmail = pickValue(structured, [['patient', 'email'], ['email']]);

  const insuranceCarrierRaw = pickValue(structured, [['insurance', 'primary', 'carrier'], ['insurance_carrier'], ['carrier']]);
  const insuranceCarrier = collapseCarrier(insuranceCarrierRaw) || insuranceCarrierRaw;
  const insuranceMemberId = cleanString(pickValue(structured, [['insurance', 'primary', 'member_id'], ['member_id']])) || ''; 
  const insuranceGroup = cleanString(pickValue(structured, [['insurance', 'primary', 'group'], ['group']])) || '';
  const insuranceAuth = cleanString(pickValue(structured, [['insurance', 'primary', 'authorization_number'], ['authorization_number']])) || '';

  const cptCodes = Array.isArray(procedure?.cpt) ? procedure.cpt : (procedure?.cpt ? [procedure.cpt] : []);
  const cptDescription = pickValue(structured, [
    ['procedure', 'description_text'],
    ['procedure', 'description'],
    ['procedure', 'study_requested'],
    ['procedure', 'study'],
  ]);
  const procedureNotes = pickValue(structured, [['procedure', 'notes'], ['provider_notes']]);

  const physicianNameRaw = pickValue(structured, [['physician', 'name'], ['referring_provider'], ['provider_name']]);
  const physicianName = collapsePhysician(physicianNameRaw) || physicianNameRaw;
  const physicianNpi = pickValue(structured, [['physician', 'npi'], ['provider_npi']]);
  const physicianPracticeRaw = pickValue(structured, [['physician', 'practice'], ['physician', 'clinic']]);
  const physicianPractice = collapsePhysician(physicianPracticeRaw) || physicianPracticeRaw;
  const physicianPhone = cleanString(pickValue(structured, [['physician', 'clinic_phone'], ['physician', 'phone']])) || '';
  const physicianFax = cleanString(pickValue(structured, [['physician', 'fax']])) || '';

  const primaryDiagnosis = pickValue(structured, [['clinical', 'primary_diagnosis'], ['diagnosis'], ['primary_diagnosis']]);
  const symptoms = clinical?.symptoms || structured?.symptoms || [];
  const bmi = pickValue(structured, [['patient', 'bmi'], ['clinical', 'bmi'], ['vitals', 'bmi']]);
  const bp = pickValue(structured, [['patient', 'blood_pressure'], ['clinical', 'blood_pressure'], ['vitals', 'bp']]);

  const { label: confidenceLabel, pct: confidencePct } = computeConfidence(r, structured);
  const flags = Array.isArray(r?.flags) ? r.flags : [];
  const actions = Array.isArray(r?.actions) ? r.actions : [];

  const ocrText = r?.text || structured?.ocr_text || '';
  const fileName = r?.filename || r?.suggested_filename || files?.[idx]?.name || `Document ${idx + 1}`;

  const secondaryCarrier = collapseCarrier(insuranceSecondary?.carrier) || cleanString(insuranceSecondary?.carrier) || 'Not provided';
  const secondaryMemberId = cleanString(insuranceSecondary?.member_id);
  const secondaryGroup = cleanString(insuranceSecondary?.group);

  const confidenceClass = (() => {
    if (confidenceLabel && confidenceLabel.toLowerCase().includes('manual')) return 'confidence-low';
    if (typeof confidencePct === 'number') {
      if (confidencePct >= 90) return 'confidence-high';
      if (confidencePct >= 75) return 'confidence-medium';
      return 'confidence-low';
    }
    return 'confidence-medium';
  })();

  return (
    <div className={`document-card ${isCollapsed ? 'collapsed' : ''}`} style={{ width: '100%' }}>
      <div className="p-5 bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200 relative">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center text-xl">📄</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-gray-800 text-lg truncate" title={fileName}>{patientName || fileName}</h3>
              <button
                className="btn-small btn-outline"
                onClick={() => toggleRowCollapse(resultId)}
                title={isCollapsed ? 'Expand row' : 'Collapse row'}
              >
                {isCollapsed ? 'Expand' : 'Collapse'}
              </button>
            </div>
            <div className="text-sm text-gray-500 mt-1 flex gap-3">
              {patientDob ? <span>DOB: {patientDob}</span> : null}
              {referralDate ? <span>Referral: {referralDate}</span> : null}
              {confidenceLabel ? (
                <span className={`confidence-badge ${confidenceClass}`}>
                  {confidenceLabel}{typeof confidencePct === 'number' ? ` · ${confidencePct.toFixed(0)}%` : ''}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {!isCollapsed && (
        <div className="p-6 space-y-6 bg-white">
          <div className="flex flex-wrap gap-6 items-start">
            <FeedbackPanel resultId={resultId} onFeedback={handleFeedback} />
            <ExportPanel
              resultId={resultId}
              r={r}
              templateHtml={templateHtml}
              onExport={handleExportCombinedPdf}
              openHtmlInNewWindow={openHtmlInNewWindow}
            />
            <button
              type="button"
              className="btn-outline btn-small"
              onClick={() => { setEditTarget({ idx, resultId, text: ocrText }); setEditText(ocrText); }}
            >
              Edit OCR
            </button>
            <button
              type="button"
              className="btn-outline btn-small"
              onClick={() => setShowDebug((v) => !v)}
            >
              {showDebug ? 'Hide Debug' : 'Show Debug'}
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <div className="text-xs uppercase text-gray-500">Patient</div>
              <div className="text-sm text-gray-800 mt-1">{patientName || 'Not found'}</div>
              <div className="text-xs text-gray-500 mt-2 space-y-1">
                {patientDob ? <div>DOB: {patientDob}</div> : null}
                {mrn ? <div>MRN: {mrn}</div> : null}
                {patientPhone ? <div>Phone: {patientPhone}</div> : null}
                {patientEmail ? <div>Email: {patientEmail}</div> : null}
              </div>
            </div>
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <div className="text-xs uppercase text-gray-500">Insurance (Primary)</div>
          <div className="text-sm text-gray-800 mt-1">{insuranceCarrier || 'Not found'}</div>
              <div className="text-xs text-gray-500 mt-2 space-y-1">
                {insuranceMemberId ? <div>Member ID: {insuranceMemberId}</div> : null}
                {insuranceGroup ? <div>Group: {insuranceGroup}</div> : null}
                {insuranceAuth ? <div>Authorization: {insuranceAuth}</div> : null}
                {insurancePrimary?.insurance_verified ? <div>Verified: {insurancePrimary.insurance_verified}</div> : null}
              </div>
            </div>
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <div className="text-xs uppercase text-gray-500">Procedure</div>
              <div className="text-sm text-gray-800 mt-1">{cptCodes.length ? cptCodes.join(', ') : 'Not found'}</div>
              <div className="text-xs text-gray-500 mt-2 space-y-1">
                {cptDescription ? <div>{cptDescription}</div> : null}
                {procedureNotes ? <div>{procedureNotes}</div> : null}
              </div>
            </div>
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <div className="text-xs uppercase text-gray-500">Clinical</div>
              <div className="text-sm text-gray-800 mt-1">{primaryDiagnosis || 'Not found'}</div>
              <div className="text-xs text-gray-500 mt-2 space-y-1">
                {symptoms && symptoms.length ? <div>Symptoms: {formatList(symptoms)}</div> : null}
                {bmi ? <div>BMI: {bmi}</div> : null}
                {bp ? <div>BP: {bp}</div> : null}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="text-xs uppercase text-gray-500">Physician</div>
              <div className="text-sm text-gray-800 mt-1">{physicianName || 'Not found'}</div>
              <div className="text-xs text-gray-500 mt-2 space-y-1">
                {physicianNpi ? <div>NPI: {physicianNpi}</div> : null}
                {physicianPractice ? <div>Practice: {physicianPractice}</div> : null}
                {physicianPhone ? <div>Phone: {physicianPhone}</div> : null}
                {physicianFax ? <div>Fax: {physicianFax}</div> : null}
              </div>
            </div>
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="text-xs uppercase text-gray-500">Secondary Insurance</div>
              <div className="text-sm text-gray-800 mt-1">{secondaryCarrier}</div>
              <div className="text-xs text-gray-500 mt-2 space-y-1">
                {secondaryMemberId ? <div>Member ID: {secondaryMemberId}</div> : null}
                {secondaryGroup ? <div>Group: {secondaryGroup}</div> : null}
              </div>
            </div>
          </div>

          {templateHtml ? (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b bg-gray-50 text-sm font-medium text-gray-700 flex items-center justify-between">
                <span>Template Preview</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-outline btn-small"
                    onClick={() => { setEditedHtml(localTemplateHtml || templateHtml || ''); setIsEditOpen(true); }}
                  >
                    Edit Template
                  </button>
                </div>
              </div>
              <div className="p-0 bg-white">
                {/* Security note: avoid combining allow-scripts + allow-same-origin to prevent sandbox escape warning.
                    Scripts can run but the frame remains in a unique origin. Add allow-popups to let links open new tabs. */}
                <iframe
                  title={`TemplatePreview-${resultId}`}
                  srcDoc={localTemplateHtml || templateHtml}
                  sandbox="allow-scripts allow-popups"
                  style={{ width: '100%', minHeight: 900, border: 0, background: 'white' }}
                />
              </div>
            </div>
          ) : null}


          {(flags.length > 0 || actions.length > 0) && (
            <div className="grid gap-4 md:grid-cols-2">
              {flags.length > 0 && (
                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="text-xs uppercase text-gray-500">Flags</div>
                  <ul className="mt-2 text-sm text-gray-700 list-disc list-inside space-y-1">
                    {flags.map((flag, i) => <li key={i}>{flag}</li>)}
                  </ul>
                </div>
              )}
              {actions.length > 0 && (
                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="text-xs uppercase text-gray-500">Actions</div>
                  <ul className="mt-2 text-sm text-gray-700 list-disc list-inside space-y-1">
                    {actions.map((action, i) => <li key={i}>{action}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {showDebug && (
            <pre className="bg-gray-900 text-gray-100 text-xs p-4 rounded-lg overflow-auto" style={{ maxHeight: 320 }}>
              {JSON.stringify({ structured, result: r }, null, 2)}
            </pre>
          )}

          {isEditOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.45)' }}
              role="dialog"
              aria-modal="true"
            >
              <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl mx-4 overflow-hidden">
                <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-700">Edit Template HTML</div>
                  <button className="btn-small" onClick={() => setIsEditOpen(false)}>✕</button>
                </div>
                <div className="p-4">
                  <textarea
                    value={editedHtml}
                    onChange={(e) => setEditedHtml(e.target.value)}
                    className="w-full border rounded-md p-3 font-mono text-xs"
                    style={{ minHeight: 420 }}
                    spellCheck={false}
                  />
                </div>
                <div className="px-4 py-3 border-t bg-gray-50 flex items-center gap-2 justify-end">
                  <button
                    type="button"
                    className="btn-outline btn-small"
                    onClick={() => setEditedHtml(templateHtml || '')}
                    title="Restore the original HTML returned by the backend"
                  >
                    Restore Original
                  </button>
                  <button
                    type="button"
                    className="btn-outline btn-small"
                    onClick={() => setIsEditOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-small"
                    onClick={() => { setLocalTemplateHtml(editedHtml); setIsEditOpen(false); }}
                  >
                    Save Preview
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
