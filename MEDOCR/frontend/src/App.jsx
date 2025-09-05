import { useState } from 'react';

import './App.css';

// --- OCR Normalization & Client-side Extraction Helpers ---
function normalizeOcrText(text) {
  if (!text) return '';
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\bIbs\b/gi, 'lbs')
    .replace(/\bPuimonary\b/gi, 'Pulmonary')
    .replace(/\bSpeciallst\b/gi, 'Specialist')
    .replace(/\bDeseription\b/gi, 'Description')
    .replace(/\bOlstructive\b/gi, 'Obstructive')
    .replace(/circumferance/gi, 'circumference')
    .replace(/-\n/g, '')
    .replace(/(\b\d{1,2}\/\d{1,2}\/)+00(\d{4}\b)/g, (m) => m.replace('/00', '/'))
    .replace(/(\b\d{1,2}\/\d{1,2}\/)+0(\d{4}\b)/g, (m) => m.replace('/0', '/'))
    // Fix glued MMDD with extra zeros in year: 00402/002024 -> 04/02/2024
    .replace(/(Referral\/order\s*date:\s*)0?(\d{2})(\d{2})\/0{1,2}(\d{4})/i, (_, p, mm, dd, yyyy) => `${p}${mm}/${dd}/${yyyy}`)
    .replace(/(\d)[ \t]*\n[ \t]*(\d)/g, '$1$2');
}

const rx = {
  dob: /\b(?:DOB|Date of Birth)[:\s]*([01]?\d\/[0-3]?\d\/\d{4})\b/i,
  bp: /\b(?:Blood Pressure|BP)[:\s]*([0-2]?\d{2}\/[0-2]?\d{2})\b/i,
  mrn: /\bMRN[:\s]*([A-Z0-9\-]{3,})\b/i,
  phone: /\b(?:Phone|Phone \(Home\)|Clinic phone)[:\s]*([()\-\s\.\d]{10,20})/i,
  fax: /\bFax[:\s]*([()\-\s\.\d]{10,20})/i,
  providerBlock: /Provider:\s*([^\n]+?)\s+Specialty:\s*([^\n]+?)(?:\s+NPI:|\n|$)/i,
  npi: /\bNPI[:\s]*([0-9]{8,15})\b/i,
  vitalsLine: /Height[:\s]*([^B\n]+?)\s+(\d+\s?lbs)[^\n]*?BMI[:\s]*([\d.]+)[^\n]*?(?:Blood Pressure|BP)[:\s]*([0-2]?\d{2}\/[0-2]?\d{2})/i,
  cptAll: /\b(9\d{4})\b/g,
  epworth: /\bEpworth(?:\s*score(?:s)?)?[:\s]*([0-2]?\d)(?:\s*\/\s*24)?\b/i,
  insurancePrimaryBlock: /Insurance\s*\(Primary\)[\s\S]{0,220}/i,
  carrier: /Carrier[:\s]*([^\n:]+)/i,
  memberId: /Member\s*ID[:\s]*([A-Z0-9\-]+)/i,
  auth: /Authorization(?:\s*number)?[:\s]*([A-Z0-9\-]+)/i,
  studyRequested: /(?:Study|Requested)\s*[:\s]*([A-Za-z ]+Study|Sleep study|Overnight Sleep Study)/i,
  patientName: /Patient[:\s]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/,
  indication: /(?:Indication|Primary\s*Diagnosis)[:\s]*([^\n]+)/i,
  neck: /Neck(?:\s*circumference)?[:\s]*([0-9]{1,2}(?:\s*in(?:ches)?)?)/i,
  // --- Additional regexes for document/intake dates, extraction method, insurance verified ---
  documentDate: /(?:Referral\s*\/?\s*order\s*date|Document\s*Date)[:\s]*([01]?\d\/[0-3]?\d\/\d{4})/i,
  intakeDate: /(?:Intake\s*\/?\s*processing|Intake\s*Date)[:\s]*([01]?\d\/[0-3]?\d\/\d{4})/i,
  extractionMethod: /Extraction\s*method[:\s]*([^\n\r]+?)(?=\s*(?:Overall\s*confidence|Flags|Confidence|Ready\-to\-schedule|$))/i,
  verifiedFlag: /\bVerified\b|\bConfirmed\b/i
};

function formatPhoneSmart(input) {
  const d = (input || '').replace(/\D/g, '');
  if (!d) return '';

  // 1) Prefer 10 digits starting at the first digit (common case like (602)555-00147)
  const first10 = d.slice(0, 10);
  const last10 = d.slice(-10);

  const validArea = (x) => /^[2-9][0-8]\d$/.test(x);
  const validExchange = (x) => /^[2-9]\d\d$/.test(x);
  const isNanp = (ten) => ten.length === 10 && validArea(ten.slice(0,3)) && validExchange(ten.slice(3,6));
  const fmt = (x) => x.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');

  if (isNanp(first10)) return fmt(first10);

  // 2) If 11 digits starting with 1, prefer the middle 10
  if (d.length === 11 && d[0] === '1' && isNanp(d.slice(1))) return fmt(d.slice(1));

  // 3) Slide a 10-digit window left-to-right to find the first plausible number
  for (let i = 0; i + 10 <= d.length; i++) {
    const w = d.slice(i, i + 10);
    if (isNanp(w)) return fmt(w);
  }

  // 4) Last resort: format the last 10 digits (even if NANP check fails)
  return last10 ? fmt(last10) : '';
}

function formatPhoneSmartRight(input) {
  const d = (input || '').replace(/\D/g, '');
  if (!d) return '';
  const validArea = (x) => /^[2-9][0-8]\d$/.test(x);
  const validExchange = (x) => /^[2-9]\d\d$/.test(x);
  const isNanp = (ten) => ten.length === 10 && validArea(ten.slice(0,3)) && validExchange(ten.slice(3,6));
  const fmt = (x) => x.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');

  // Prefer last 10 first
  if (d.length >= 10 && isNanp(d.slice(-10))) return fmt(d.slice(-10));
  // Slide right-to-left
  for (let i = d.length - 10; i >= 0; i--) {
    const w = d.slice(i, i + 10);
    if (isNanp(w)) return fmt(w);
  }
  return d.length >= 10 ? fmt(d.slice(-10)) : '';
}

function clientExtractEnhancedData(rawText) {
  const t = normalizeOcrText(rawText || '');
  const out = { patient: {}, insurance: { primary: {} }, physician: {}, procedure: {}, clinical: {} };

  // Patient basics
  const dob = t.match(rx.dob)?.[1]; if (dob) out.patient.dob = dob;
  const mrn = t.match(rx.mrn)?.[1]; if (mrn) out.patient.mrn = mrn;
  const pn = t.match(rx.patientName)?.[1];
  if (pn) {
    const parts = pn.trim().split(/\s+/);
    out.patient.first_name = parts[0];
    out.patient.last_name = parts.slice(1).join(' ');
  }

  // Vitals in one line
  const vl = t.match(rx.vitalsLine);
  if (vl) {
    out.patient.height = vl[1].trim();
    out.patient.weight = vl[2].trim();
    out.patient.bmi = vl[3].trim();
    out.patient.blood_pressure = vl[4].trim();
  } else {
    const bp = t.match(rx.bp)?.[1];
    if (bp) out.patient.blood_pressure = bp;
  }

  // Phones / Fax
  const phoneMatch = t.match(rx.phone)?.[1];
  if (phoneMatch) out.patient.phone_home = formatPhoneSmart(phoneMatch);
  const faxMatch = t.match(rx.fax)?.[1];
  if (faxMatch) out.physician.fax = formatPhoneSmartRight(faxMatch);

  // Provider block
  const pb = t.match(rx.providerBlock);
  if (pb) {
    out.physician.name = pb[1].trim().replace(/\s+Specialty$/i, '');
    out.physician.specialty = pb[2].trim();
  }
  const npi = t.match(rx.npi)?.[1];
  if (npi) out.physician.npi = npi;
  const clinicPhone = (t.match(/Clinic phone[:\s]*([()\-\s\.\d]{10,20})/i)?.[1]) || null;
  if (clinicPhone) out.physician.clinic_phone = formatPhoneSmart(clinicPhone);

  // Insurance
  const ib = t.match(rx.insurancePrimaryBlock)?.[0] || '';
  const carrier = ib.match(rx.carrier)?.[1]?.trim();
  if (carrier) out.insurance.primary.carrier = carrier.replace(/Member\s*Id$/i, '').trim();
  const memberId = ib.match(rx.memberId)?.[1];
  if (memberId) out.insurance.primary.member_id = memberId;
  const auth = ib.match(rx.auth)?.[1];
  if (auth) out.insurance.primary.authorization_number = auth;

  // --- Document / Metadata ---
  const docD = t.match(rx.documentDate)?.[1];
  if (docD) out.document_date = docD;
  const inD = t.match(rx.intakeDate)?.[1];
  if (inD) out.intake_date = inD;
  const em = t.match(rx.extractionMethod)?.[1];
  if (em) out.extraction_method = em.trim();

  // --- Insurance verified ---
  if (rx.verifiedFlag.test(t)) {
    out.insurance.primary = out.insurance.primary || {};
    out.insurance.primary.insurance_verified = 'Yes';
  }

  // Procedure / CPT
  const cpts = Array.from(t.matchAll(rx.cptAll)).map(m => m[1]);
  if (cpts.length) out.procedure.cpt = cpts;
  const study = t.match(rx.studyRequested)?.[1];
  if (study) out.procedure.study_requested = study;
  const ind = t.match(rx.indication)?.[1];
  if (ind) {
    const cleaned = ind.replace(/\bOlstructive\b/i, 'Obstructive').trim();
    out.procedure.indication = cleaned;
    out.clinical.primary_diagnosis = cleaned;
  }

  // Clinical
  const ep = t.match(rx.epworth)?.[1];
  if (ep) out.clinical.epworth_score = `${ep}/24`;
  const symLine = /Symptoms?[:\s]*([^\n]+)/i.exec(t)?.[1] || '';
  if (symLine) {
    out.clinical.symptoms = symLine
      .replace(/\bnoring\b/gi, 'snoring')
      .split(/[;,]/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  const neck = t.match(rx.neck)?.[1];
  if (neck) out.clinical.neck_circumference = neck.includes('in') ? neck : `${neck} in`;

  return out;
}


// --- Client-format helpers ---
function confidenceLabel(r, eff) {
  if (r?.analysis?.confidence_bucket) return r.analysis.confidence_bucket;
  const v = (eff?.overall_confidence ?? eff?.confidence_scores?.overall_confidence);
  if (typeof v === 'number') {
    if (v >= 0.8) return 'High';
    if (v >= 0.5) return 'Medium';
    return 'Low';
  }
  return 'Manual Review Required';
}

function App() {
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [uploadId, setUploadId] = useState(null);
  const [progress, setProgress] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [batchResults, setBatchResults] = useState(null);
  const [intakeDate, setIntakeDate] = useState(new Date().toLocaleDateString('en-US'));
  const [errorsCount, setErrorsCount] = useState(0);
  const [devMode, setDevMode] = useState(true);
  const [useClientExtraction, setUseClientExtraction] = useState(true);
  const [showFallbacks, setShowFallbacks] = useState(false);

  // ---- Demo fallback values for template fill (ensures every field is populated for OCR/testing) ----
  const demoFallback = {
    physician: {
      name: 'Dr. Alan Roberts',
      specialty: 'Pulmonology',
      npi: '1122334455',
      clinic_phone: '(555) 444-5555',
      fax: '(555) 444-6666',
    },
    document_date: '02/15/2024',
    intake_date: '02/16/2024',
    patient: {
      first_name: 'Emily',
      last_name: 'Johnson',
      dob: '04/14/1978',
      mrn: 'A123456',
      phone_home: '(555) 987-6543',
      height: "5'5\"",
      weight: '150 lbs',
      bmi: '24.9',
      blood_pressure: '120/78',
    },
    insurance: {
      primary: {
        carrier: 'WellCare Health',
        member_id: 'WC987654321',
        authorization_number: 'AUTH12345',
        insurance_verified: 'Yes',
      },
      secondary: {
        carrier: 'BlueCross',
        member_id: 'BC1234567',
      },
    },
    procedure: {
      study_requested: 'Overnight Sleep Study',
      cpt: ['95810', '95811'],
      description: ['Polysomnography', 'Sleep Study with CPAP'],
      priority: 'Routine',
      indication: 'Obstructive Sleep Apnea',
      inferred_cpt: false,
    },
    clinical: {
      symptoms: ['Snoring', 'Apnea episodes', 'Morning headaches'],
      epworth_score: '16/24',
      neck_circumference: '16 inches',
      mallampati: 'Class III',
      tonsil_size: '2+',
      impression: 'Moderate OSA',
      medications: ['Lisinopril', 'Metformin'],
      icd10_codes: ['G47.33', 'I10'],
    },
    flags: ['F1', 'F2'],
    actions: ['Route to scheduling', 'Notify provider'],
    confidence: 'High',
    ready_to_schedule: 'Yes',
    missing_critical_fields: [],
  };

  const pick = (value, fb) => (value === undefined || value === null || value === '' ? (showFallbacks ? fb : 'Not found') : value);

  const handleFileChange = (e) => {
    setFiles(Array.from(e.target.files));
    setResults([]);
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!files.length) return;
    setLoading(true);
    setResults([]);
    setBatchResults(null);
    setError(null);
    
    const formData = new FormData();
    files.forEach((file) => formData.append('file', file));
    
    // Add intake date for batch processing
    if (batchMode) {
      formData.append('intake_date', intakeDate);
    }
    
    const endpoint = batchMode ? '/batch-ocr' : '/ocr?lang=eng';
    
    try {
      const res = await fetch(`http://localhost:5000${endpoint}`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      
      if (batchMode) {
        // Handle batch processing results
        if (data.success) {
          setBatchResults(data);
        } else {
          setError(data.error || 'Batch processing failed');
        }
      } else {
        // Handle individual processing results
        if (data.uploadId) {
          setUploadId(data.uploadId);
          try {
            const es = new EventSource(`http://localhost:5000/progress/${data.uploadId}`);
            es.onmessage = (ev) => {
              try {
                const d = JSON.parse(ev.data);
                setProgress((p) => ({ ...p, [d.idx || 0]: d }));
              } catch (err) {
                // ignore parse errors
              }
            };
            es.onerror = () => es.close();
          } catch (e) {
            // ignore SSE setup errors
          }
        }
        if (typeof data.errorsCount === 'number') setErrorsCount(data.errorsCount);
        if (data.error) {
          setError(data.details || data.error);
        } else if (data.results) {
          setResults(data.results);
        } else {
          setResults([{ text: data.text }]);
        }
      }
    } catch (err) {
      setError('Network or server error');
    }
    setLoading(false);
  };

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <h2>MEDOCR</h2>
        <nav>
          <ul>
            <li><a href="#">Dashboard</a></li>
            <li><a href="#">Upload</a></li>
            <li><a href="#">Results</a></li>
          </ul>
        </nav>
      </aside>
      <main className="main-content">
        <header className="header">
          <h1>Medical OCR Dashboard</h1>
        </header>
        <section className="card upload-card">
          <h2>Upload Documents</h2>
          <form onSubmit={handleSubmit} className="ocr-form">
            <div className="form-controls">
              <div className="mode-selector">
                <label>
                  <input 
                    type="radio" 
                    name="mode" 
                    checked={!batchMode} 
                    onChange={() => setBatchMode(false)}
                  />
                  Individual Processing
                </label>
                <label>
                  <input 
                    type="radio" 
                    name="mode" 
                    checked={batchMode} 
                    onChange={() => setBatchMode(true)}
                  />
                  Batch Processing (Client Requirements)
                </label>
              </div>
              
              {batchMode && (
                <div className="batch-controls">
                  <label>
                    Intake Date:
                    <input 
                      type="date" 
                      value={intakeDate.split('/').reverse().join('-')} 
                      onChange={(e) => setIntakeDate(new Date(e.target.value).toLocaleDateString('en-US'))}
                    />
                  </label>
                </div>
              )}
              
              {devMode && (
                <div className="dev-toggles" style={{display:'flex', gap:12, alignItems:'center'}}>
                  <label style={{display:'flex', alignItems:'center', gap:6}}>
                    <input type="checkbox" checked={useClientExtraction} onChange={e=>setUseClientExtraction(e.target.checked)} />
                    Dev: Use Client Extraction
                  </label>
                  <label style={{display:'flex', alignItems:'center', gap:6}}>
                    <input type="checkbox" checked={showFallbacks} onChange={e=>setShowFallbacks(e.target.checked)} />
                    Dev: Render Fallbacks in Template
                  </label>
                </div>
              )}
              <input type="file" accept="image/*,.pdf" multiple onChange={handleFileChange} />
              <button type="submit" disabled={!files.length || loading}>
                {loading ? 'Processing...' : (batchMode ? 'Run Batch OCR with Client Requirements' : 'Run Individual OCR')}
              </button>
            </div>
          </form>
          {files.length > 0 && (
            <div className="selected-files">
              <b>Selected files:</b>
              <ul>
                {files.map((f) => (
                  <li key={f.name}>{f.name}</li>
                ))}
              </ul>
            </div>
          )}
          {error && <div className="ocr-error">Error: {error}</div>}
        </section>
        
        {/* Batch Results with Client Requirements */}
        {batchResults && (
          <section className="card batch-results-card">
            <h2>Batch Processing Results - Client Requirements</h2>
            
            <div className="batch-summary">
              <h3>Processing Summary - Intake Date: {batchResults.intake_date}</h3>
              <div className="stats-grid">
                <div className="stat-box">
                  <span className="stat-number">{batchResults.total_documents}</span>
                  <span className="stat-label">Total Documents</span>
                </div>
                <div className="stat-box ready">
                  <span className="stat-number">{batchResults.ready_to_schedule}</span>
                  <span className="stat-label">Ready to Schedule</span>
                </div>
                <div className="stat-box action-required">
                  <span className="stat-number">{batchResults.additional_actions_required}</span>
                  <span className="stat-label">Actions Required</span>
                </div>
              </div>
            </div>
            
            <div className="client-features">
              <h3>Client Requirements Status</h3>
              <div className="feature-grid">
                <div className={`feature-box ${batchResults.client_features?.batch_cover_sheet_ready ? 'ready' : 'pending'}`}>
                  <span>📄</span>
                  <span>Batch Cover Sheet</span>
                  <span>{batchResults.client_features?.batch_cover_sheet_ready ? 'Ready' : 'Pending'}</span>
                </div>
                <div className={`feature-box ${batchResults.client_features?.individual_pdfs_ready > 0 ? 'ready' : 'pending'}`}>
                  <span>📋</span>
                  <span>Individual PDFs</span>
                  <span>{batchResults.client_features?.individual_pdfs_ready || 0} Generated</span>
                </div>
                <div className={`feature-box ${batchResults.client_features?.quality_control_applied ? 'ready' : 'pending'}`}>
                  <span>✅</span>
                  <span>Quality Control</span>
                  <span>{batchResults.client_features?.quality_control_applied ? 'Applied' : 'Pending'}</span>
                </div>
                <div className={`feature-box ${batchResults.client_features?.file_naming_standardized ? 'ready' : 'pending'}`}>
                  <span>📁</span>
                  <span>File Naming</span>
                  <span>{batchResults.client_features?.file_naming_standardized ? 'Standardized' : 'Pending'}</span>
                </div>
              </div>
            </div>
            
            <div className="individual-results">
              <h3>Individual Document Results</h3>
              <div className="document-list">
                {batchResults.individual_results?.map((result, idx) => (
                  <div key={idx} className={`document-item ${result.status || 'unknown'}`}>
                    <div className="document-header">
                      <span className="document-name">{result.source_file || `Document ${idx + 1}`}</span>
                      <span className={`status-badge ${result.status || 'unknown'}`}>
                        {result.status === 'ready_to_schedule' ? 'Ready to Schedule' : 
                         result.status === 'additional_actions_required' ? 'Actions Required' : 
                         result.status || 'Unknown'}
                      </span>
                    </div>
                    
                    {result.success && (
                      <div className="document-details">
                        <div className="detail-row">
                          <strong>Suggested Filename:</strong> {result.filename}
                        </div>
                        <div className="detail-row">
                          <strong>Confidence:</strong> {(result.confidence_score * 100).toFixed(1)}%
                        </div>
                        {result.flags?.length > 0 && (
                          <div className="detail-row">
                            <strong>Flags:</strong> 
                            <div className="flags-list">
                              {result.flags.map((flag, i) => (
                                <span key={i} className="flag-badge">{flag}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {result.actions?.length > 0 && (
                          <div className="detail-row">
                            <strong>Required Actions:</strong>
                            <ul className="actions-list">
                              {result.actions.map((action, i) => (
                                <li key={i}>{action}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {result.qc_issues > 0 && (
                          <div className="detail-row warning">
                            <strong>QC Issues:</strong> {result.qc_issues} issues found
                          </div>
                        )}
                      </div>
                    )}
                    
                    {result.error && (
                      <div className="document-error">
                        Error: {result.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            
            {batchResults.cover_sheet_content && (
              <div className="cover-sheet-preview">
                <h3>Batch Cover Sheet Preview</h3>
                <div 
                  className="cover-sheet-content"
                  dangerouslySetInnerHTML={{ __html: batchResults.cover_sheet_content }}
                />
              </div>
            )}
          </section>
        )}
        {results.length > 0 && !batchMode && (
          <section className="card result-card">
            <h2>Individual Processing Results</h2>
            {typeof errorsCount === 'number' && (
              <div className="aggregate-status">
                <span className="pill">Errors in batch: <b>{errorsCount}</b></span>
              </div>
            )}
            <div className="compare-list">
              {results.map((r, idx) => (
                (() => {
                  const clientEnhanced = useClientExtraction ? clientExtractEnhancedData(r.text) : null;
                  const effectiveEnhanced = (useClientExtraction && clientEnhanced && Object.keys(clientEnhanced).length) ? clientEnhanced : r.enhanced_data;
                  return (
                    <div key={idx} className="compare-row">
                  {/* Scan Preview */}
                  <div className="compare-preview">
                    <b>{r.filename || files[idx]?.name || `File ${idx+1}`}</b>
                    <div className="preview-box">
                      {files[idx] && files[idx].type.startsWith('image/') ? (
                        <img
                          src={URL.createObjectURL(files[idx])}
                          alt={files[idx].name}
                          className="preview-img"
                        />
                      ) : (
                        <div className="pdf-icon">
                          <span role="img" aria-label="PDF">📄</span>
                        </div>
                      )}
                    </div>
                    
                    {/* Client Requirements Status */}
                    {r.client_features && (
                      <div className="client-status">
                        <h4>Client Requirements</h4>
                        <div className="status-items">
                          <div className={`status-item ${r.client_features.individual_pdf_ready ? 'ready' : 'pending'}`}>
                            📄 PDF Ready: {r.client_features.individual_pdf_ready ? 'Yes' : 'No'}
                          </div>
                          <div className={`status-item ${r.client_features.quality_checked ? 'ready' : 'pending'}`}>
                            ✅ QC Checked: {r.client_features.quality_checked ? 'Yes' : 'No'}
                          </div>
                          <div className="status-item">
                            🏷️ Suggested: {r.suggested_filename || 'None'}
                          </div>
                          <div className={`status-item ${r.ready_to_schedule ? 'ready' : 'pending'}`}>
                            📅 Status: {r.ready_to_schedule ? 'Ready to Schedule' : 'Actions Required'}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* OCR Text + Unified Client PDF */}
                  <div className="compare-ocr">
                    {r.error ? (
                      <div className="ocr-error">Error: {r.details || r.error}</div>
                    ) : (
                      <>
                        <div className="col-title">OCR Text</div>
                        <pre className="ocr-text">{r.text}</pre>
                        {r.avg_conf !== undefined && (
                          <div className="confidence">Average Confidence: <b>{r.avg_conf}</b></div>
                        )}
                        {progress[idx] && (
                          <div className="progress-box">Status: {progress[idx].stage || 'processing'}</div>
                        )}
                        
                        {/* Enhanced Flags and Actions */}
                        {r.flags?.length > 0 && (
                          <div className="flags-section">
                            <div className="col-title">Intelligent Flags</div>
                            <div className="flags-grid">
                              {r.flags.map((flag, i) => (
                                <span key={i} className="flag-badge">{flag}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {r.actions?.length > 0 && (
                          <div className="actions-section">
                            <div className="col-title">Required Actions</div>
                            <ul className="actions-list">
                              {r.actions.map((action, i) => (
                                <li key={i}>{action}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        
                        {r.qc_results && (
                          <div className="qc-section">
                            <div className="col-title">Quality Control</div>
                            {(r.qc_results.errors?.length > 0 || r.qc_results.warnings?.length > 0) ? (
                              <div className="qc-issues">
                                {r.qc_results.errors?.map((error, i) => (
                                  <div key={i} className="qc-error">❌ {error}</div>
                                ))}
                                {r.qc_results.warnings?.map((warning, i) => (
                                  <div key={i} className="qc-warning">⚠️ {warning}</div>
                                ))}
                              </div>
                            ) : (
                              <div className="qc-pass">✅ All quality checks passed</div>
                            )}
                          </div>
                        )}
                        
                        {/* ==== Unified: Individual Patient PDF (Client Format) ==== */}
                        <div className="template-html client-pdf-format" style={{marginTop:16, borderTop:'1px solid #eee', paddingTop:16}}>
                          <div className="document-template">
                            {/* HEADER */}
                            <div className="document-header">
                              <div className="header-info" style={{fontWeight:600}}>
                                {(() => {
                                  const last = effectiveEnhanced?.patient?.last_name || (showFallbacks ? demoFallback.patient.last_name : '');
                                  const first = effectiveEnhanced?.patient?.first_name || (showFallbacks ? demoFallback.patient.first_name : '');
                                  const dob = pick(effectiveEnhanced?.patient?.dob, demoFallback.patient.dob);
                                  const refDate = pick(effectiveEnhanced?.document_date, demoFallback.document_date);
                                  return (
                                    <span>
                                      PATIENT: {(last && first) ? `${last}, ${first}` : 'Not found'} | DOB: {dob} | REFERRAL DATE: {refDate}
                                    </span>
                                  );
                                })()}
                              </div>
                            </div>

                            {/* DEMOGRAPHICS */}
                            <section>
                              <h3>DEMOGRAPHICS:</h3>
                              <ul>
                                <li>
                                  Phone: {(() => {
                                    const primary = effectiveEnhanced?.patient?.phone_home || (showFallbacks ? demoFallback.patient.phone_home : '');
                                    const secondary = (effectiveEnhanced?.patient?.phones && effectiveEnhanced.patient.phones[1]) || '';
                                    return [primary || 'Not found', secondary].filter(Boolean).join(' / ');
                                  })()}
                                </li>
                                <li>Email: {pick(effectiveEnhanced?.patient?.email, 'Not found')}</li>
                                <li>Emergency Contact: {pick(effectiveEnhanced?.patient?.emergency_contact, 'Not found')}</li>
                              </ul>
                            </section>

                            {/* INSURANCE */}
                            <section>
                              <h3>INSURANCE:</h3>
                              <ul>
                                <li>
                                  Primary: {(() => {
                                    const carrier = pick(effectiveEnhanced?.insurance?.primary?.carrier, demoFallback.insurance.primary.carrier);
                                    const id = pick(effectiveEnhanced?.insurance?.primary?.member_id, demoFallback.insurance.primary.member_id);
                                    const group = pick(effectiveEnhanced?.insurance?.primary?.group, 'Not found');
                                    return `${carrier} | ID: ${id} | Group: ${group}`;
                                  })()}
                                </li>
                                <li>
                                  Secondary: {(() => {
                                    const sec = effectiveEnhanced?.insurance?.secondary;
                                    if (!sec && !showFallbacks) return 'Not found';
                                    const carrier = pick(sec?.carrier, demoFallback.insurance.secondary.carrier);
                                    const id = pick(sec?.member_id, demoFallback.insurance.secondary.member_id);
                                    const group = pick(sec?.group, 'Not found');
                                    return `${carrier} | ID: ${id} | Group: ${group}`;
                                  })()}
                                </li>
                              </ul>
                            </section>

                            {/* PROCEDURE ORDERED */}
                            <section>
                              <h3>PROCEDURE ORDERED:</h3>
                              <ul>
                                <li>
                                  CPT Code: {Array.isArray(effectiveEnhanced?.procedure?.cpt) && effectiveEnhanced.procedure.cpt.length
                                    ? effectiveEnhanced.procedure.cpt.join(', ')
                                    : (showFallbacks ? demoFallback.procedure.cpt.join(', ') : 'Not found')}
                                </li>
                                <li>
                                  Description: {Array.isArray(effectiveEnhanced?.procedure?.description) && effectiveEnhanced.procedure.description.length
                                    ? effectiveEnhanced.procedure.description.join(', ')
                                    : (showFallbacks ? demoFallback.procedure.description.join(', ') : 'Not found')}
                                </li>
                                <li>
                                  Provider Notes: {pick(effectiveEnhanced?.procedure?.notes, 'Not found')}
                                </li>
                              </ul>
                            </section>

                            {/* REFERRING PHYSICIAN */}
                            <section>
                              <h3>REFERRING PHYSICIAN:</h3>
                              <ul>
                                <li>Name: {pick((effectiveEnhanced?.physician?.name || effectiveEnhanced?.physician?.referring?.name), demoFallback.physician.name)}</li>
                                <li>NPI: {pick(effectiveEnhanced?.physician?.npi, demoFallback.physician.npi)}</li>
                                <li>Practice: {pick(effectiveEnhanced?.physician?.practice, 'Not found')}</li>
                                <li>Phone/Fax: {(() => {
                                  const phone = pick(effectiveEnhanced?.physician?.clinic_phone, demoFallback.physician.clinic_phone);
                                  const fax = pick(effectiveEnhanced?.physician?.fax, demoFallback.physician.fax);
                                  return `${phone} / ${fax}`;
                                })()}
                                </li>
                                <li>Supervising Physician if Listed: {pick(effectiveEnhanced?.physician?.supervising, 'Not found')}</li>
                              </ul>
                            </section>

                            {/* CLINICAL INFORMATION */}
                            <section>
                              <h3>CLINICAL INFORMATION:</h3>
                              <ul>
                                <li>
                                  Primary Diagnosis: {(() => {
                                    const icd = (effectiveEnhanced?.clinical?.icd10_codes && effectiveEnhanced.clinical.icd10_codes[0]) || '';
                                    const dx  = effectiveEnhanced?.clinical?.primary_diagnosis || effectiveEnhanced?.procedure?.indication;
                                    if (!icd && !dx && !showFallbacks) return 'Not found';
                                    if (icd && dx) return `${icd} — ${dx}`;
                                    return icd || dx || 'Not found';
                                  })()}
                                </li>
                                <li>
                                  Symptoms Present: {(() => {
                                    const arr = (effectiveEnhanced?.clinical?.symptoms && effectiveEnhanced.clinical.symptoms.length)
                                      ? effectiveEnhanced.clinical.symptoms
                                      : (showFallbacks ? demoFallback.clinical.symptoms : []);
                                    return arr.length ? arr.join(', ') : 'Not found';
                                  })()}
                                </li>
                                <li>
                                  BMI: {(() => {
                                    const bmi = effectiveEnhanced?.patient?.bmi;
                                    const ht = effectiveEnhanced?.patient?.height;
                                    const wt = effectiveEnhanced?.patient?.weight;
                                    if (bmi) return `${bmi}`;
                                    if (ht || wt) return `${ht || '—'} // ${wt || '—'}`;
                                    return showFallbacks ? `${demoFallback.patient.height} // ${demoFallback.patient.weight}` : 'Not found';
                                  })()} | BP: {pick(effectiveEnhanced?.patient?.blood_pressure, demoFallback.patient.blood_pressure)}
                                </li>
                              </ul>
                            </section>

                            {/* INFORMATION ALERTS */}
                            <section>
                              <h3>INFORMATION ALERTS:</h3>
                              <ul>
                                <li>PPE Requirements: {pick(effectiveEnhanced?.alerts?.ppe_required, 'Not found')}</li>
                                <li>Safety Precautions: {pick(effectiveEnhanced?.alerts?.safety_precautions, 'Not found')}</li>
                                <li>Communication Needs: {pick(effectiveEnhanced?.alerts?.communication_needs, 'Not found')}</li>
                                <li>Special Accommodations: {pick(effectiveEnhanced?.alerts?.accommodations, 'Not found')}</li>
                              </ul>
                            </section>

                            {/* PROBLEM FLAGS */}
                            <section>
                              <h3>PROBLEM FLAGS:</h3>
                              <div>
                                {(Array.isArray(r.flags) && r.flags.length)
                                  ? r.flags.join(', ')
                                  : (r.qc_results && (r.qc_results.errors?.length || r.qc_results.warnings?.length))
                                    ? [...(r.qc_results.errors || []), ...(r.qc_results.warnings || [])].join(' | ')
                                    : 'None'}
                              </div>
                            </section>

                            {/* AUTHORIZATION NOTES */}
                            <section>
                              <h3>AUTHORIZATION NOTES:</h3>
                              <div>
                                {(() => {
                                  const auth = effectiveEnhanced?.insurance?.primary?.authorization_number;
                                  const extra = (r.analysis?.insurance?.accepted && r.analysis.insurance.accepted.length)
                                    ? `Accepted: ${r.analysis.insurance.accepted.join(', ')}`
                                    : '';
                                  const out = [auth ? `Authorization #: ${auth}` : '', extra].filter(Boolean).join(' — ');
                                  return out || (showFallbacks ? `Authorization #: ${demoFallback.insurance.primary.authorization_number}` : 'Not found');
                                })()}
                              </div>
                            </section>

                            {/* CONFIDENCE LEVEL */}
                            <section>
                              <h3>CONFIDENCE LEVEL:</h3>
                              <div>{confidenceLabel(r, effectiveEnhanced)}</div>
                            </section>
                          </div>

                          {/* Optional: developer-only raw OCR for debugging */}
                          <details style={{ marginTop: 12 }}>
                            <summary>Raw OCR (debug)</summary>
                            <pre className="ocr-text">{r.text || ''}</pre>
                          </details>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })()
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;