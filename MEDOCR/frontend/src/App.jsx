import { useState, useRef, useEffect } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import './App.css';

// --- OCR Normalization & Client-side Extraction Helpers ---
function normalizeOcrText(text) {
  if (!text) return '';
  let norm = text
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
    .replace(/\bVkrified\b/gi, 'Verified')
    .replace(/circumferance/gi, 'circumference')
    .replace(/-\n/g, '')
    .replace(/\|/g, '')
    .replace(/(\b\d{1,2}[\/\-]\d{1,2}[\/\-])+00(\d{4}\b)/g, (m) => m.replace(/\/(?:00)/, '/').replace(/\-(?:00)/, '-'))
    .replace(/(\b\d{1,2}[\/\-]\d{1,2}[\/\-])+0(\d{4}\b)/g, (m) => m.replace(/\/(?:0)/, '/').replace(/\-(?:0)/, '-'))
    // Fix glued MMDD with extra zeros in year: 00402/002024 -> 04/02/2024
    .replace(/(Referral\/order\s*date:\s*)0?(\d{2})(\d{2})\/0{1,2}(\d{4})/i, (_, p, mm, dd, yyyy) => `${p}${mm}/${dd}/${yyyy}`)
    // General fix for dates with a 5-digit year like mm/dd/0yyyy -> mm/dd/yyyy (covers DOB etc.)
    .replace(/\b([01]?\d\/[0-3]?\d\/)0(\d{4}\b)/g, '$1$2')
    // Normalize labeled dates with extra leading zeros before 4-digit year
    .replace(/((?:DOB|Date of Birth|Document\s*Date|Referral\s*Date|Intake(?:\s*\/\s*processing|\s*Date)?)\s*:\s*[01]?\d[\/\-][0-3]?\d[\/\-])0+(\d{4}\b)/gi, '$1$2')
    // Map mm/dd/00yy -> mm/dd/19yy or 20yy based on threshold (<=30 => 20yy)
    .replace(/([01]?\d[\/\-][0-3]?\d[\/\-])0+(\d{2}\b)/g, (_, p, yy) => {
      const n = parseInt(yy, 10);
      const century = n <= 30 ? '20' : '19';
      return `${p}${century}${yy}`;
    })
    .replace(/(\d)[ \t]*\n[ \t]*(\d)/g, '$1$2');

  // Collapse spaced-out letters forming words (e.g., "B l o o d   P r e s s u r e")
  norm = norm.replace(/((?:\b[A-Za-z]\s){2,}[A-Za-z]\b)/g, (seq) => seq.replace(/\s+/g, ''));
  // Restore known two-word phrases accidentally glued
  norm = norm.replace(/Authorizationnumber/gi, 'Authorization number')
             .replace(/BloodPressure/gi, 'Blood Pressure')
             .replace(/VerifiedConfirmed/gi, 'Verified Confirmed');
  // Normalize BP spacing like 124 / 80 -> 124/80
  norm = norm.replace(/(\b\d{2,3})\s*\/\s*(\d{2,3}\b)/g, '$1/$2');
  // Fix common OCR slip for CPT 95811 -> 958711
  norm = norm.replace(/\b958711\b/g, '95811');
  // Height artifact cleanup like 5'5'0" -> 5'0"
  norm = norm.replace(/(\d)'\d'(\d)\"/g, "$1'$2\"");
  return norm;
}

const rx = {
  dob: /\b(?:DOB|Date of Birth)[:\s]*([01]?\d\/[0-3]?\d\/\d{4})\b/i,
  bp: /\b(?:Blood Pressure|BP)[:\s]*([0-2]?\d{2}\/[0-2]?\d{2})\b/i,
  mrn: /\bMRN[:\s]*([A-Z0-9\-]{3,})\b/i,
  phone: /\b(?:Phone|Phone \(Home\))[:\s]*([()\-\s\.\d]{10,20})/i,
  fax: /\bFax[:\s]*([()\-\s\.\d]{10,20})/i,
  providerBlock: /Provider:\s*([^\n]+?)\s+Specialty:\s*([^\n]+?)(?:\s+NPI:|\n|$)/i,
  referringProvider: /Referring\s+Provider\s*:\s*([^\n]+)/i,
  npi: /\bNPI[:\s]*([0-9]{8,15})\b/i,
  vitalsLine: /Height[:\s]*([^B\n]+?)\s+(\d+\s?lbs)[^\n]*?BMI[:\s]*([\d.]+)[^\n]*?(?:Blood Pressure|BP)[:\s]*([0-2]?\d{2}\/[0-2]?\d{2})/i,
  cptAll: /\b(9\d{4})\b/g,
  epworth: /\bEpworth(?:\s*score(?:s)?)?[:\s]*([0-2]?\d)(?:\s*\/\s*24)?\b/i,
  insurancePrimaryBlock: /Insurance\s*\(Primary\)[\s\S]{0,220}/i,
  carrier: /Carrier[:\s]*([^\n:]+)/i,
  // Capture Member ID up to a clear boundary (newline or next label); allow spaces then strip later
  memberId: /Member\s*ID[:\s]*([A-Z0-9\- ]{2,})(?=\s*(?:\r?\n|$|Coverage|Authorization|Auth|Carrier|Group|Plan|Policy))/i,
  auth: /Authorization(?:\s*number)?[:\s]*([A-Z0-9\-]+)/i,
  studyRequested: /(?:Study|Requested)\s*[:\s]*([A-Za-z ]+Study|Sleep study|Overnight Sleep Study)/i,
  patientName: /Patient[:\s]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?=\s*(?:[-–]\s*DOB|DOB|$))/i,
  indication: /(?:Indication|Primary\s*Diagnosis)[:\s]*([^\n]+)/i,
  neck: /Neck(?:\s*circumference)?[:\s]*([0-9]{1,2}(?:\s*in(?:ches)?)?)/i,
  // --- Additional regexes for document/intake dates, extraction method, insurance verified ---
  documentDate: /(?:Referral\s*\/?\s*order\s*date|Referral\s*Date|Document\s*Date)[:\s]*([01]?\d\/[0-3]?\d\/\d{4})/i,
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
    // Original broad capture sometimes stuffs weight into height; refine parsing
    let rawHeight = vl[1].trim();
    const weightCap = vl[2].trim();
    // If rawHeight still contains an embedded weight token, strip it
    if (/\b\d{2,3}\s?lbs\b/i.test(rawHeight)) {
      rawHeight = rawHeight.replace(/\b\d{2,3}\s?lbs\b/i, '').trim();
    }
    // Normalize compact height like 55" => 5'5"
    if (/^[4-7][0-9]"$/.test(rawHeight)) {
      rawHeight = rawHeight.replace(/^([4-7])([0-9])"$/, "$1'$2\"");
    }
    out.patient.height = rawHeight;
    out.patient.weight = weightCap;
    out.patient.bmi = vl[3].trim();
    out.patient.blood_pressure = vl[4].trim();
  } else {
    const bp = t.match(rx.bp)?.[1];
    if (bp) out.patient.blood_pressure = bp;
    // If weight appears on same malformed Blood Pressure line (e.g., "Blood Pressure: 165 lbs") treat lbs value as weight
    if (!out.patient.weight) {
      const bpLineWeight = /Blood Pressure[:\s]*([0-9]{2,3})\s?lbs/i.exec(t);
      if (bpLineWeight) out.patient.weight = `${bpLineWeight[1]} lbs`;
    }
  // Fallback parsing for separated vitals if combined line regex missed
  const hMatch = /Height[:\s]*([0-9]{1,2}\'?\d{0,2}\"?\s*(?:in|ft)?)/i.exec(t);
  if (hMatch && !out.patient.height) out.patient.height = hMatch[1].trim();
  const wMatch = /(?:Weight|Wt)[:\s]*([0-9]{2,3}\s?lbs?)/i.exec(t);
  if (wMatch && !out.patient.weight) out.patient.weight = wMatch[1].replace(/\s+/g,' ').trim();
  const bmiMatch = /BMI[:\s]*([0-9]{2}\.?[0-9]{0,2})/i.exec(t);
  if (bmiMatch && !out.patient.bmi) out.patient.bmi = bmiMatch[1];
    // Height cleanup: convert patterns like 5 5" or 55" to 5'5" when original apostrophe lost and looks like feet+inches
    if (out.patient.height && /^([4-7])\s?([0-9])\"$/.test(out.patient.height)) {
      const m = out.patient.height.match(/^([4-7])\s?([0-9])\"$/);
      if (m) out.patient.height = `${m[1]}'${m[2]}"`;
    }
    // Final pass: if height captured as just two digits without quote fix (e.g. 55" already handled) ensure trailing double-quote preserved
    if (out.patient.height && /^(\d)'(\d)$/.test(out.patient.height)) {
      const m = out.patient.height.match(/^(\d)'(\d)$/);
      if (m) out.patient.height = `${m[1]}'${m[2]}"`;
    }
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
  if (!out.physician.name) {
    const rp = t.match(rx.referringProvider)?.[1];
    if (rp) out.physician.name = rp.trim();
  }
  const npi = t.match(rx.npi)?.[1];
  if (npi) out.physician.npi = npi;
  const clinicPhone = (t.match(/Clinic phone[:\s]*([()\-\s\.\d]{10,20})/i)?.[1]) || null;
  if (clinicPhone) out.physician.clinic_phone = formatPhoneSmart(clinicPhone);

  // Insurance
  const ib = t.match(rx.insurancePrimaryBlock)?.[0] || '';
  let carrier = ib.match(rx.carrier)?.[1]?.trim();
  if (!carrier) {
    const inl = /Insurance\s*\(Primary\)\s*:?\s*([^\n:]+)(?::[^\n]*)?/i.exec(t);
    if (inl) carrier = inl[1].trim();
  }
  if (carrier) out.insurance.primary.carrier = carrier.replace(/Member\s*Id$/i, '').trim();
  const memberId = ib.match(rx.memberId)?.[1];
  if (memberId) out.insurance.primary.member_id = memberId.replace(/\s+/g, '');
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

// Merge helper: prefer server values, fill gaps from client
function mergePreferServer(server, client) {
  const isEmpty = (val) => (
    val === undefined || val === null || (typeof val === 'string' && val.trim() === '')
  );

  if (Array.isArray(server) || Array.isArray(client)) {
    const sa = Array.isArray(server) ? server : [];
    const ca = Array.isArray(client) ? client : [];
    return sa && sa.length ? sa : ca;
  }

  if (typeof server === 'object' && server !== null || typeof client === 'object' && client !== null) {
    const out = {};
    const keys = new Set([
      ...Object.keys(server || {}),
      ...Object.keys(client || {}),
    ]);
    keys.forEach((k) => {
      const sv = server ? server[k] : undefined;
      const cv = client ? client[k] : undefined;
      if (typeof sv === 'object' && sv !== null && typeof cv === 'object' && cv !== null && !Array.isArray(sv) && !Array.isArray(cv)) {
        out[k] = mergePreferServer(sv, cv);
      } else if (Array.isArray(sv) || Array.isArray(cv)) {
        const sa = Array.isArray(sv) ? sv : [];
        const ca = Array.isArray(cv) ? cv : [];
        out[k] = sa && sa.length ? sa : ca;
      } else {
        out[k] = !isEmpty(sv) ? sv : cv;
      }
    });
    return out;
  }

  // primitives
  return isEmpty(server) ? client : server;
}

// Lightweight client-side template renderer for side-by-side preview
// (Client template removed in favor of server-rendered template)

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
  const [activeView, setActiveView] = useState('process'); // 'process' | 'checklist'
  // Always show server data; no client extraction toggle
  // (Template toggles removed; always use server-rendered template when available)
  // --- Feedback system state ---
  const [feedbackSubmitting, setFeedbackSubmitting] = useState({}); // resultId -> boolean
  const [feedbackSent, setFeedbackSent] = useState({}); // resultId -> 'up' | 'down'
  const [commentTarget, setCommentTarget] = useState(null); // { resultId, payload }
  const [commentText, setCommentText] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  // --- Export system state ---
  const [exportingPdf, setExportingPdf] = useState({}); // resultId -> boolean
  // --- Edit OCR state ---
  const [editTarget, setEditTarget] = useState(null); // { idx, resultId, text }
  const [editText, setEditText] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleField, setRuleField] = useState('insurance.primary.carrier');
  const [ruleFields, setRuleFields] = useState([
    // Fallback options if backend not reachable
    'insurance.primary.carrier', 'insurance.primary.member_id', 'insurance.primary.authorization_number', 'insurance.primary.group',
    'insurance.secondary.carrier', 'insurance.secondary.member_id',
    'patient.blood_pressure', 'patient.phone_home', 'patient.dob', 'patient.mrn', 'patient.email',
    'physician.npi', 'physician.clinic_phone', 'physician.practice', 'physician.supervising',
    'procedure.study_requested', 'procedure.cpt', 'procedure.indication', 'procedure.description',
    'clinical.primary_diagnosis', 'clinical.epworth_score', 'clinical.neck_circumference',
    'document_date', 'intake_date'
  ]);
  const [rulePattern, setRulePattern] = useState('');
  const [ruleSection, setRuleSection] = useState('');
  const [rulePost, setRulePost] = useState('trim');
  const editTextAreaRef = useRef(null);
  const [showRuleAdvanced, setShowRuleAdvanced] = useState(false);
  const [recentChanges, setRecentChanges] = useState({}); // resultId -> [strings]
  const [checklistItems, setChecklistItems] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [carrierFilter, setCarrierFilter] = useState('');
  const [groupBy, setGroupBy] = useState('none'); // 'none' | 'carrier'
  const [noteDrafts, setNoteDrafts] = useState({}); // id -> note text

  async function loadChecklist() {
    try {
      const resp = await fetch('http://localhost:5000/checklist/list');
      const js = await resp.json();
      if (js.success) setChecklistItems(js.items || []);
    } catch(_) {}
  }

  useEffect(() => {
    if (activeView === 'checklist') loadChecklist();
  }, [activeView]);

  // Sync view with URL hash so it survives reloads/bookmarks
  useEffect(() => {
    const applyHash = () => {
      const h = (window.location.hash || '').replace('#', '');
      if (h === 'checklist' || h === 'process') {
        setActiveView(h);
      }
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  useEffect(() => {
    const desired = `#${activeView}`;
    if (window.location.hash !== desired) {
      // Avoid adding history entries on every tab switch
      window.history.replaceState(null, '', desired);
    }
  }, [activeView]);

  function mapActionToCommon(a) {
    const s = String(a || '').toLowerCase();
    if (!s) return null;
    if (s.includes('verification') || (s.includes('no chart') && s.includes('insurance'))) return 'Generate insurance verification form';
    if (s.includes('questionnaire') || (s.includes('insufficient') && s.includes('information')) || s.includes('call patient')) return 'Insufficient information - sleep questionnaire required, call patient';
    if (s.includes('wrong test')) return 'Wrong test ordered - need order for complete sleep study due to no testing in last 5 years';
    if (s.includes('out of network') || s.includes('uts')) return 'Out of network - fax UTS → Generate UTS referral form';
    if (s.includes('authorization')) return 'Authorization required - submit/fax request → Generate authorization form';
    if (s.includes('missing demographics') || s.includes('demographic')) return 'Missing demographics - call provider for complete patient information';
    if (s.includes('provider follow')) return 'Provider follow-up required - obtain additional clinical documentation';
    if (s.includes('expired') || s.includes('terminated')) return 'Insurance expired/terminated - verify current coverage';
    if (s.includes('pediatric')) return 'Pediatric specialist referral required';
    if (s.includes('dme')) return 'DME evaluation needed before testing';
    return a;
  }

  function renderChecklist() {
    // Use persisted ledger if available; fallback to current results if none
    let items = checklistItems.length ? checklistItems.map(rec => ({
      id: rec.id,
      last: rec.patient?.last_name || 'Not found',
      first: rec.patient?.first_name || 'Not found',
      dob: rec.patient?.dob || 'Not found',
      carrier: rec.insurance?.carrier || 'Not found',
      member: rec.insurance?.member_id || 'Not found',
      actions: Array.isArray(rec.actions) ? rec.actions.map(mapActionToCommon).filter(Boolean) : [],
      status: rec.status || 'new',
      color: rec.color || 'gray',
      checklist: Array.isArray(rec.checklist) ? rec.checklist : []
    })) : (results || []).map((r) => {
      const ed = r.enhanced_data || {};
      const p = ed.patient || {};
      const ins = (ed.insurance && ed.insurance.primary) || {};
      const last = p.last_name || 'Not found';
      const first = p.first_name || 'Not found';
      const dob = p.dob || 'Not found';
      const carrier = ins.carrier || 'Not found';
      const member = ins.member_id || 'Not found';
      const act = Array.isArray(r.actions) && r.actions.length ? r.actions.map(mapActionToCommon).filter(Boolean) : [];
      return { id: r.id || `res-${Math.random()}`, last, first, dob, carrier, member, actions: act, status: 'new', color: 'gray', checklist: [] };
    });

    // Filters
    const st = searchTerm.toLowerCase();
    items = items.filter(it => {
      if (statusFilter !== 'all' && it.status !== statusFilter) return false;
      if (carrierFilter && !String(it.carrier||'').toLowerCase().includes(carrierFilter.toLowerCase())) return false;
      if (!st) return true;
      return [it.last, it.first, it.member, it.carrier].some(v => String(v||'').toLowerCase().includes(st));
    });

    return (
      <section className="card" style={{whiteSpace:'normal'}}>
        <h2>Checklist</h2>
        <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:8}}>
          <input placeholder="Search patient, member, carrier" value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} style={{padding:'6px 8px'}} />
          <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="new">New</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
          <input placeholder="Carrier filter" value={carrierFilter} onChange={e=>setCarrierFilter(e.target.value)} style={{padding:'6px 8px'}} />
          <button type="button" onClick={loadChecklist}>Refresh</button>
          <button type="button" onClick={async ()=>{ try { await fetch('http://localhost:5000/checklist/import-scan', { method:'POST' }); await loadChecklist(); alert('Imported from export folder'); } catch(_){ alert('Import failed'); } }}>Import From Exports</button>
          <select value={groupBy} onChange={e=>setGroupBy(e.target.value)}>
            <option value="none">Group: None</option>
            <option value="carrier">Group: Insurance</option>
          </select>
        </div>
        <div className="template-html" style={{maxHeight:'unset'}}>
          <div style={{fontWeight:700, marginBottom:8}}>PATIENT CHECKLIST:</div>
          <div>
            {items.length === 0 && (
              <div style={{margin:'8px 0', color:'#666', fontSize:13}}>
                No checklist records yet. Export a combined PDF, or click "Import From Exports" to scan your Desktop/MEDOCR-Exports folder.
              </div>
            )}
            {groupBy === 'carrier' ? (
              (() => {
                const groups = items.reduce((acc, it) => { const k = it.carrier || 'Unknown'; (acc[k] = acc[k] || []).push(it); return acc; }, {});
                return Object.keys(groups).sort().map((k) => (
                  <div key={k} style={{marginBottom:16}}>
                    <div style={{fontWeight:700, margin:'6px 0'}}>{k}</div>
                    {groups[k].map((it, i) => (
                      <div key={it.id || i} style={{marginBottom:12, backgroundColor:(it.color==='yellow'?'#fffde7':it.color==='green'?'#e8f5e9':it.color==='red'?'#ffebee':it.color==='blue'?'#e3f2fd':'#f5f5f5'), borderLeft:`6px solid ${it.color==='yellow'?'#ffeb3b':it.color==='green'?'#2e7d32':it.color==='red'?'#c62828':it.color==='blue'?'#1976d2':'#9e9e9e'}`, padding:8, borderRadius:6}}>
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8}}>
                          <div>□ {it.last}, {it.first} | DOB: {it.dob} | Insurance: {it.carrier} | ID: {it.member}</div>
                          {checklistItems.length>0 && (
                            <div style={{display:'flex', gap:8, alignItems:'center'}}>
                              <select value={it.status} onChange={async (e)=>{
                                try { await fetch('http://localhost:5000/checklist/update', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: it.id, status: e.target.value })}); loadChecklist(); } catch(_){}}
                              }>
                                <option value="new">New</option>
                                <option value="in_progress">In Progress</option>
                                <option value="completed">Completed</option>
                              </select>
                              <select value={it.color} onChange={async (e)=>{ try { await fetch('http://localhost:5000/checklist/update', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: it.id, color: e.target.value })}); loadChecklist(); } catch(_){}}}>
                                <option value="gray">Gray</option>
                                <option value="yellow">Yellow</option>
                                <option value="green">Green</option>
                                <option value="red">Red</option>
                                <option value="blue">Blue</option>
                              </select>
                            </div>
                          )}
                        </div>
                        {it.actions && it.actions.length > 0 && (
                          <div style={{marginLeft:18}}>Additional Actions Required: {it.actions.join('; ')}</div>
                        )}
                  {checklistItems.length>0 && (
                    <div style={{marginLeft:18, marginTop:6}}>
                      {(it.checklist||[]).map(ch => (
                              <label key={ch.key} style={{display:'inline-flex', alignItems:'center', gap:6, marginRight:12}}>
                                <input
                                  type="checkbox"
                                  checked={!!ch.done}
                                  onChange={async (e) => {
                                    const payload = { id: it.id, checklist: [{ key: ch.key, done: e.target.checked }] };
                                    try {
                                      await fetch('http://localhost:5000/checklist/update', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify(payload)
                                      });
                                      loadChecklist();
                                    } catch (_) {}
                                  }}
                                />
                                {ch.label}
                              </label>
                            ))}
                          </div>
                        )}
                        {checklistItems.length>0 && (
                          <div style={{marginLeft:18, marginTop:8}}>
                            <input
                              placeholder="Add note..."
                              value={noteDrafts[it.id] || ''}
                              onChange={e=>setNoteDrafts(d=>({ ...d, [it.id]: e.target.value }))}
                              style={{padding:'6px 8px', width:'100%', boxSizing:'border-box'}}
                            />
                            <div style={{marginTop:6, textAlign:'right'}}>
                              <button type="button" onClick={async ()=>{
                                const txt = (noteDrafts[it.id] || '').trim();
                                if (!txt) return;
                                try {
                                  await fetch('http://localhost:5000/checklist/update', {
                                    method:'POST', headers:{'Content-Type':'application/json'},
                                    body: JSON.stringify({ id: it.id, note: txt })
                                  });
                                  setNoteDrafts(d=>({ ...d, [it.id]: '' }));
                                  loadChecklist();
                                } catch(_) {}
                              }}>Add Note</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ));
              })()
            ) : (
              items.map((it, i) => (
                <div key={it.id || i} style={{marginBottom:12, backgroundColor:(it.color==='yellow'?'#fffde7':it.color==='green'?'#e8f5e9':it.color==='red'?'#ffebee':it.color==='blue'?'#e3f2fd':'#f5f5f5'), borderLeft:`6px solid ${it.color==='yellow'?'#ffeb3b':it.color==='green'?'#2e7d32':it.color==='red'?'#c62828':it.color==='blue'?'#1976d2':'#9e9e9e'}`, padding:8, borderRadius:6}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8}}>
                  <div>□ {it.last}, {it.first} | DOB: {it.dob} | Insurance: {it.carrier} | ID: {it.member}</div>
                  {checklistItems.length>0 && (
                    <div style={{display:'flex', gap:8, alignItems:'center'}}>
                      <select value={it.status} onChange={async (e)=>{
                        try { await fetch('http://localhost:5000/checklist/update', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: it.id, status: e.target.value })}); loadChecklist(); } catch(_){}}
                      }>
                        <option value="new">New</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                      </select>
                      <select value={it.color} onChange={async (e)=>{ try { await fetch('http://localhost:5000/checklist/update', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: it.id, color: e.target.value })}); loadChecklist(); } catch(_){}}}>
                        <option value="gray">Gray</option>
                        <option value="yellow">Yellow</option>
                        <option value="green">Green</option>
                        <option value="red">Red</option>
                        <option value="blue">Blue</option>
                      </select>
                    </div>
                  )}
                  {checklistItems.length>0 && (
                    <div style={{marginLeft:18, marginTop:8}}>
                      <input
                        placeholder="Add note..."
                        value={noteDrafts[it.id] || ''}
                        onChange={e=>setNoteDrafts(d=>({ ...d, [it.id]: e.target.value }))}
                        style={{padding:'6px 8px', width:'100%', boxSizing:'border-box'}}
                      />
                      <div style={{marginTop:6, textAlign:'right'}}>
                        <button type="button" onClick={async ()=>{
                          const txt = (noteDrafts[it.id] || '').trim();
                          if (!txt) return;
                          try {
                            await fetch('http://localhost:5000/checklist/update', {
                              method:'POST', headers:{'Content-Type':'application/json'},
                              body: JSON.stringify({ id: it.id, note: txt })
                            });
                            setNoteDrafts(d=>({ ...d, [it.id]: '' }));
                            loadChecklist();
                          } catch(_) {}
                        }}>Add Note</button>
                      </div>
                    </div>
                  )}
                </div>
                {it.actions && it.actions.length > 0 && (
                  <div style={{marginLeft:18}}>Additional Actions Required: {it.actions.join('; ')}</div>
                )}
                {checklistItems.length>0 && (
                  <div style={{marginLeft:18, marginTop:6}}>
                    {(it.checklist||[]).map(ch => (
                      <label key={ch.key} style={{display:'inline-flex', alignItems:'center', gap:6, marginRight:12}}>
                        <input
                          type="checkbox"
                          checked={!!ch.done}
                          onChange={async (e) => {
                            const payload = { id: it.id, checklist: [{ key: ch.key, done: e.target.checked }] };
                            try {
                              await fetch('http://localhost:5000/checklist/update', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(payload)
                              });
                              loadChecklist();
                            } catch (_) {}
                          }}
                        />
                        {ch.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))
            )}
            
          </div>
          {/* Removed static COMMON ADDITIONAL ACTIONS reference list per request */}
        </div>
        <div style={{display:'flex', gap:8, marginTop:8}}>
          <button type="button" onClick={()=>{
            try{
              const el = document.querySelector('.card .template-html');
              const text = el ? el.innerText : '';
              navigator.clipboard.writeText(text);
              alert('Checklist copied to clipboard');
            }catch(_){/* ignore */}
          }}>Copy Checklist</button>
          <button type="button" onClick={()=>window.print()}>Print</button>
        </div>
      </section>
    );
  }

  function setRecommendedForField(field) {
    // Defaults per field
    if (field === 'insurance.primary.member_id') {
      setRulePattern('Member\\s*ID[:\\s]*([A-Za-z0-9- ]{3,})');
      setRuleSection('Insurance\\s*\\(Primary\\)');
      setRulePost('strip_spaces');
    } else if (field === 'insurance.primary.carrier') {
      setRulePattern('Carrier[:\\s]*([A-Za-z][A-Za-z0-9 &\\-]{2,})');
      setRuleSection('Insurance\\s*\\(Primary\\)');
      setRulePost('collapse_duplicate_tokens');
    } else if (field === 'insurance.primary.authorization_number') {
      setRulePattern('Authorization(?:\\s*number)?[:\\s]*([A-Za-z0-9\\-]+)');
      setRuleSection('Insurance\\s*\\(Primary\\)');
      setRulePost('trim');
    } else if (field === 'patient.blood_pressure') {
      setRulePattern('(?:Blood\\s*Pressure|BP)[:\\s]*([0-2]?\\d{2}/[0-2]?\\d{2})');
      setRuleSection('');
      setRulePost('trim');
    } else if (field === 'patient.phone_home' || field === 'physician.clinic_phone') {
      const lbl = field === 'patient.phone_home' ? 'Phone(?:\\s*\\(Home\\))?' : 'Clinic\\s*phone';
      setRulePattern(`${lbl}[:\\s]*([()\\-\\.\\s\\d]{10,20})`);
      setRuleSection('');
      setRulePost('nanp_phone');
    } else if (field === 'physician.npi') {
      setRulePattern('NPI[:\\s]*([0-9]{8,15})');
      setRuleSection('');
      setRulePost('trim');
    } else if (field === 'procedure.cpt') {
      setRulePattern('\\b(9\\\\d{4})\\b');
      setRuleSection('');
      setRulePost('trim');
    } else if (field === 'insurance.primary.group') {
      setRulePattern('Group[:\\s]*([A-Za-z0-9- ]{2,})');
      setRuleSection('Insurance\\s*\\(Primary\\)');
      setRulePost('trim');
    } else if (field === 'insurance.secondary.carrier') {
      setRulePattern('Carrier[:\\s]*([A-Za-z][A-Za-z0-9 &\\-]{2,})');
      setRuleSection('Insurance\\s*\\(Secondary\\)');
      setRulePost('collapse_duplicate_tokens');
    } else if (field === 'insurance.secondary.member_id') {
      setRulePattern('Member\\s*ID[:\\s]*([A-Za-z0-9- ]{3,})');
      setRuleSection('Insurance\\s*\\(Secondary\\)');
      setRulePost('strip_spaces');
    } else if (field === 'procedure.description') {
      setRulePattern('Description[:\\s]*([^\\n]+)');
      setRuleSection('');
      setRulePost('trim');
    } else if (field === 'physician.practice') {
      setRulePattern('Practice[:\\s]*([^\\n]+)');
      setRuleSection('');
      setRulePost('trim');
    } else if (field === 'physician.supervising') {
      setRulePattern('Supervising\\s*Physician[^:]*[:\\s]*([^\\n]+)');
      setRuleSection('');
      setRulePost('trim');
    } else if (field === 'document_date') {
      setRulePattern('(?:Referral\\s*Date|Document\\s*Date)[:\\s]*([01]?\\d\\/[0-3]?\\d\\/\\d{4})');
      setRuleSection('');
      setRulePost('trim');
    } else if (field === 'intake_date') {
      setRulePattern('(?:Intake\\s*(?:processing|Date))[:\\s]*([01]?\\d\\/[0-3]?\\d\\/\\d{4})');
      setRuleSection('');
      setRulePost('trim');
    } else {
      setRulePattern('');
      setRuleSection('');
      setRulePost('trim');
    }
  }

  function escapeRegex(s) {
    return (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Load allowed fields from backend (once)
  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch('http://localhost:5000/rules/list-fields');
        const js = await resp.json();
        if (js && Array.isArray(js.fields) && js.fields.length) {
          setRuleFields(js.fields);
          if (!js.fields.includes(ruleField)) setRuleField(js.fields[0]);
        }
      } catch (_) { /* ignore; fallback list remains */ }
    })();
  }, []);

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

  const pick = (value, fb) => (value === undefined || value === null || value === '' ? 'Not found' : value);

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
            <li><a href="#process" onClick={() => setActiveView('process')}>Processing</a></li>
            <li><a href="#checklist" onClick={() => setActiveView('checklist')}>Checklist</a></li>
          </ul>
        </nav>
      </aside>
      <main className="main-content">
        <header className="header">
          <h1>{activeView==='checklist' ? 'Patient Checklist' : 'Medical OCR Dashboard'}</h1>
        </header>
        {activeView==='process' && (
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
              
              {/* Dev toggles removed */}
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
        )}
        
        {/* Batch Results with Client Requirements */}
        {activeView==='process' && batchResults && (
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
        {activeView==='process' && results.length > 0 && !batchMode && (
          <section className="card result-card">
            <h2>Individual Processing Results</h2>
            {typeof errorsCount === 'number' && (
              <div className="aggregate-status">
                <span className="pill">Errors in batch: <b>{errorsCount}</b></span>
              </div>
            )}
            <div className="compare-list">
              {results.map((r, idx) => {
                  const effectiveEnhanced = r.enhanced_data || {};
                  const resultId = r.id || r.suggested_filename || r.filename || `res-${idx}`;
                  const fbState = feedbackSent[resultId];
                  let avgConfText = null;
                  if (r.avg_conf !== undefined) {
                    const v = Number(r.avg_conf);
                    avgConfText = Number.isNaN(v) ? String(r.avg_conf) : `${(v > 1 ? v : v * 100).toFixed(1)}%`;
                  }
                  async function handleFeedback(kind) {
                    if (fbState || feedbackSubmitting[resultId]) return;
                    const basePayload = {
                      result_id: resultId,
                      feedback: kind,
                      filename: r.filename,
                      flags: r.flags || [],
                      actions: r.actions || [],
                      avg_conf: r.avg_conf,
                      enhanced_data: kind === 'down' ? effectiveEnhanced : undefined
                    };
                    if (kind === 'down') {
                      setCommentTarget({ resultId, payload: basePayload });
                      return;
                    }
                    setFeedbackSubmitting(s => ({ ...s, [resultId]: true }));
                    try {
                      const resp = await fetch('http://localhost:5000/feedback', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(basePayload)
                      });
                      const js = await resp.json();
                      if (js.ok) setFeedbackSent(s => ({ ...s, [resultId]: kind }));
                    } catch (_) {} finally {
                      setFeedbackSubmitting(s => ({ ...s, [resultId]: false }));
                    }
                  }

  async function handleExportCombinedPdf() {
                    if (exportingPdf[resultId]) return;
                    setExportingPdf(s => ({ ...s, [resultId]: true }));
                    try {
                      const payload = {
                        originalFilename: r.original_saved_name || r.filename,
                        enhancedData: effectiveEnhanced,
                        avgConf: r.avg_conf,
                        flags: r.flags || [],
                        actions: r.actions || []
                      };
                      console.log('[Export Combined PDF] request', payload, { resultId });
                      const response = await fetch('http://localhost:5000/export-combined-data', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                      });
                      const result = await response.json();
                      console.log('[Export Combined PDF] response', { status: response.status, ok: response.ok, result });
                      if (result.success) {
                        alert(`Combined PDF exported (server-rendered)!\nSaved as: ${result.filename}`);
                        // refresh checklist ledger if user switches to checklist
                        try { await fetch('http://localhost:5000/checklist/list'); } catch(_){}
                      } else {
                        alert(`Export failed: ${result.error}`);
                      }
                    } catch (e) {
                      console.error('[Export Combined PDF] Server export error', e);
                      alert('Failed to export combined PDF (server error)');
                    } finally {
                      setExportingPdf(s => ({ ...s, [resultId]: false }));
                    }
                  }
                  
                  return (
                    <div key={idx} className="compare-row">
                      {/* Scan Preview */}
                      <div className="compare-preview">
                        <b>{r.filename || files[idx]?.name || `File ${idx+1}`}</b>
                        <div className="preview-box">
                          {files[idx] && files[idx].type?.startsWith('image/') ? (
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
                      
                      {/* OCR Text + Client PDF */}
                      {(() => {
                        const hasTemplate = !!r.individual_pdf_content;
                        return (
                          <div className={`compare-ocr${hasTemplate ? ' has-template' : ''}`}>
                            {/* Left column: OCR + details */}
                            <div className="ocr-pane">
                              {r.error ? (
                                <div className="ocr-error">Error: {r.details || r.error}</div>
                              ) : (
                                <>
                                  <div className="ocr-col">
                                  <div className="col-title" style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8}}>
                                    <span>OCR Text</span>
                                    <button type="button" onClick={()=>{ setEditTarget({ idx, resultId, text: r.text||'' }); setEditText(r.text||''); }} style={{fontSize:12, padding:'2px 8px', border:'1px solid #ccc', borderRadius:4, background:'#fff', cursor:'pointer'}}>Edit OCR</button>
                                  </div>
                                  <pre className="ocr-text">{r.text}</pre>
                                    {recentChanges[resultId] && recentChanges[resultId].length > 0 && (
                                      <div style={{background:'#e8f5e9', border:'1px solid #a5d6a7', padding:'6px 8px', borderRadius:4, margin:'6px 0'}}>
                                        <div style={{fontSize:12, fontWeight:600, marginBottom:4}}>Updated fields:</div>
                                        <ul style={{margin:0, paddingLeft:'1rem'}}>
                                          {recentChanges[resultId].map((t,i)=> <li key={i} style={{fontSize:12}}>{t}</li>)}
                                        </ul>
                                      </div>
                                    )}
                                    {avgConfText !== null && (
                                      <div className="confidence">Average Confidence: <b>{avgConfText}</b></div>
                                    )}
                                    {progress[idx] && (
                                      <div className="progress-box">Status: {progress[idx].stage || 'processing'}</div>
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

                                    {/* Feedback Controls */}
                                    <div style={{marginTop:12, display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
                                      <span style={{fontSize:12, fontWeight:600, letterSpacing:0.5, color:'#555'}}>Feedback:</span>
                                      <button
                                        type="button"
                                        onClick={() => handleFeedback('up')}
                                        disabled={!!fbState || feedbackSubmitting[resultId]}
                                        style={{
                                          padding:'4px 10px', borderRadius:4, cursor: fbState ? 'default':'pointer',
                                          border: fbState==='up' ? '2px solid #2e7d32':'1px solid #ccc',
                                          background: fbState==='up' ? '#e8f5e9':'#fff', fontSize:12
                                        }}
                                      >👍 {fbState==='up' ? 'Recorded':'Looks Good'}</button>
                                      <button
                                        type="button"
                                        onClick={() => handleFeedback('down')}
                                        disabled={!!fbState || feedbackSubmitting[resultId]}
                                        style={{
                                          padding:'4px 10px', borderRadius:4, cursor: fbState ? 'default':'pointer',
                                          border: fbState==='down' ? '2px solid #c62828':'1px solid #ccc',
                                          background: fbState==='down' ? '#ffebee':'#fff', fontSize:12
                                        }}
                                      >👎 {fbState==='down' ? 'Captured':'Needs Fix'}</button>
                                      {feedbackSubmitting[resultId] && <span style={{fontSize:12, color:'#888'}}>Submitting...</span>}
                                      {fbState && <span style={{fontSize:12, color:'#666'}}>Thank you!</span>}
                                    </div>

                                    {/* Export Controls */}
                                    <div style={{marginTop:8, display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
                                      <span style={{fontSize:12, fontWeight:600, letterSpacing:0.5, color:'#555'}}>Export:</span>
                                      <button
                                        type="button"
                                        onClick={handleExportCombinedPdf}
                                        disabled={exportingPdf[resultId]}
                                        style={{
                                          padding:'6px 12px', borderRadius:4, cursor:exportingPdf[resultId] ? 'default':'pointer',
                                          border:'1px solid #1976d2', background:'#1976d2', color:'#fff', fontSize:12,
                                          opacity: exportingPdf[resultId] ? 0.6 : 1
                                        }}
                                      >
                                        {exportingPdf[resultId] ? '📄 Exporting...' : '📄 Export Combined PDF'}
                                      </button>
                                    </div>

                                    {/* Optional: developer-only raw OCR for debugging */}
                                    <details style={{ marginTop: 12 }}>
                                      <summary>Raw OCR (debug)</summary>
                                      <pre className="ocr-text">{r.text || ''}</pre>
                                    </details>
                                  </div>

                                  {/* Side column: Flags and Actions */}
                                  <div className="side-col">
                                    {Array.isArray(r.flags) && r.flags.length > 0 && (
                                      <div className="flags-section">
                                        <div className="col-title">Intelligent Flags</div>
                                        <div className="flags-grid">
                                          {r.flags.map((flag, i) => (
                                            <span key={i} className="flag-badge">{flag}</span>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {Array.isArray(r.actions) && r.actions.length > 0 && (
                                      <div className="actions-section">
                                        <div className="col-title">Required Actions</div>
                                        <ul className="actions-list">
                                          {r.actions.map((action, i) => (
                                            <li key={i}>{action}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>

                            {/* Right column: Server-rendered template only */}
                            {hasTemplate && (
                              <div className="template-html client-pdf-format" dangerouslySetInnerHTML={{ __html: r.individual_pdf_content }} />
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
            })}
            </div>
          </section>
        )}
        {activeView==='checklist' && renderChecklist()}
      </main>
      
      {/* Comment Modal for Down Feedback */}
      {commentTarget && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', 
          display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000
        }}>
          <div style={{
            background:'#fff', width:'min(560px,90%)', borderRadius:8, padding:'1.5rem',
            boxShadow:'0 4px 18px rgba(0,0,0,0.25)', fontSize:14
          }}>
            <h3 style={{marginTop:0, marginBottom:8}}>Help Improve Extraction</h3>
            <p style={{marginTop:0, fontSize:12, color:'#555'}}>
              Optional: describe what's incorrect or missing to help us improve.
            </p>
            <textarea
              value={commentText}
              onChange={e=>setCommentText(e.target.value)}
              rows={5}
              style={{
                width:'100%', resize:'vertical', padding:8, fontFamily:'inherit', 
                fontSize:13, border:'1px solid #ccc', borderRadius:4, boxSizing:'border-box'
              }}
              placeholder="e.g. DOB wrong; missing secondary insurance; CPT should be 95811 not 95810"
            />
            <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:12}}>
              <button
                type="button"
                onClick={()=>{ setCommentTarget(null); setCommentText(''); }}
                disabled={commentSending}
                style={{background:'#eee', border:'1px solid #ccc', padding:'6px 14px', borderRadius:4, cursor:'pointer'}}
              >Cancel</button>
              <button
                type="button"
                disabled={commentSending}
                style={{background:'#c62828', color:'#fff', border:'1px solid #b71c1c', padding:'6px 14px', borderRadius:4, cursor:'pointer'}}
                onClick={async ()=>{
                  if (!commentTarget) return;
                  setCommentSending(true);
                  try {
                    const body = { ...commentTarget.payload, comment: commentText || undefined };
                    const resp = await fetch('http://localhost:5000/feedback', { 
                      method:'POST', 
                      headers:{'Content-Type':'application/json'}, 
                      body: JSON.stringify(body) 
                    });
                    const js = await resp.json();
                    if (js.ok) {
                      setFeedbackSent(s => ({ ...s, [commentTarget.resultId]: 'down' }));
                      setCommentTarget(null); setCommentText('');
                    }
                  } catch(_) { /* ignore */ } 
                  finally { setCommentSending(false); }
                }}
              >{commentSending ? 'Submitting...' : 'Submit Feedback'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit OCR Modal */}
      {editTarget && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,0.45)',
          display:'flex', alignItems:'center', justifyContent:'center', zIndex:2100
        }}>
          <div style={{ background:'#fff', width:'min(760px,92%)', maxHeight:'90vh', overflow:'auto', borderRadius:8, padding:'1.25rem', boxShadow:'0 4px 18px rgba(0,0,0,0.25)' }}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8}}>
              <h3 style={{marginTop:0, marginBottom:8}}>Edit OCR Text</h3>
              <button type="button" onClick={()=>setShowRuleForm(s=>!s)} style={{fontSize:12, padding:'4px 10px', border:'1px solid #ccc', borderRadius:4, background:'#fff', cursor:'pointer'}}>
                {showRuleForm ? 'Hide Add Rule' : 'Add Rule'}
              </button>
              <button type="button" onClick={()=>{
                // Clean: drop leading junk lines until a plausible label/line
                const lines = (editText||'').split(/\r?\n/);
                const isJunk = (ln) => {
                  const s = (ln||'').trim();
                  if (!s) return true;
                  // very short or mostly symbols
                  const letters = (s.match(/[A-Za-z]/g)||[]).length;
                  const digits = (s.match(/\d/g)||[]).length;
                  const alnum = letters + digits;
                  if (alnum <= 2) return true;
                  // known good prefixes
                  if (/\b(PATIENT|INSURANCE|REFERRAL|NPI|DOB|PROCEDURE|CLINICAL|VITALS|HEIGHT|WEIGHT|BMI|Provider|Referring)\b/i.test(s)) return false;
                  // lines with many specials and few alnums
                  const specials = (s.match(/[^\w\s]/g)||[]).length;
                  return specials > alnum * 2;
                };
                let i=0; while(i<lines.length && isJunk(lines[i])) i++;
                const cleaned = lines.slice(i).join('\n');
                setEditText(cleaned);
              }} style={{fontSize:12, padding:'4px 10px', border:'1px solid #ccc', borderRadius:4, background:'#fff', cursor:'pointer'}}>Clean OCR</button>
            </div>
            {showRuleForm && (
              <div style={{border:'1px solid #e0e0e0', borderRadius:6, padding:10, margin:'6px 0 10px 0', background:'#fafafa'}}>
                <div style={{display:'flex', flexWrap:'wrap', gap:8}}>
                  <label style={{fontSize:12}}>Field:&nbsp;
                    <select value={ruleField} onChange={e=>{ setRuleField(e.target.value); setRecommendedForField(e.target.value); }} style={{fontSize:12}}>
                      {ruleFields.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </label>
                  <button type="button" onClick={()=>setRecommendedForField(ruleField)} style={{fontSize:12, padding:'4px 8px', border:'1px solid #ccc', borderRadius:4, background:'#fff', cursor:'pointer'}}>Use Recommended</button>
                  <button type="button" onClick={()=>{
                    const el = editTextAreaRef.current; if (!el) return; const start = el.selectionStart||0; const end = el.selectionEnd||0; const sel = (el.value||'').slice(start, end).trim(); if (!sel) { alert('Select text in the OCR box below first.'); return; }
                    setRulePattern(`(${escapeRegex(sel)})`);
                  }} style={{fontSize:12, padding:'4px 8px', border:'1px solid #ccc', borderRadius:4, background:'#fff', cursor:'pointer'}}>Use Selection</button>
                  <button type="button" onClick={()=>setShowRuleAdvanced(s=>!s)} style={{fontSize:12, padding:'4px 8px', border:'1px solid #ccc', borderRadius:4, background:'#fff', cursor:'pointer'}}>{showRuleAdvanced ? 'Hide Advanced' : 'Advanced'}</button>
                  {showRuleAdvanced && (
                    <>
                      <label style={{fontSize:12, flex:'1 1 260px'}}>Pattern (group 1 is value):
                        <input value={rulePattern} onChange={e=>setRulePattern(e.target.value)} placeholder={"e.g. Member\\s*ID[:\\s]*([A-Za-z0-9- ]{3,})"} style={{width:'100%'}} />
                      </label>
                      <label style={{fontSize:12, flex:'1 1 220px'}}>Section (optional):
                        <input value={ruleSection} onChange={e=>setRuleSection(e.target.value)} placeholder={'e.g. Insurance\\s*\\(Primary\\)'} style={{width:'100%'}} />
                      </label>
                      <label style={{fontSize:12}}>Postprocess:
                        <select value={rulePost} onChange={e=>setRulePost(e.target.value)} style={{fontSize:12}}>
                          <option value="trim">trim</option>
                          <option value="collapse_spaces">collapse_spaces</option>
                          <option value="digits_only">digits_only</option>
                          <option value="strip_spaces">strip_spaces</option>
                          <option value="upper">upper</option>
                          <option value="nanp_phone">nanp_phone</option>
                          <option value="collapse_duplicate_tokens">collapse_duplicate_tokens</option>
                        </select>
                      </label>
                    </>
                  )}
                  <button type="button" style={{fontSize:12, padding:'4px 10px', border:'1px solid #1976d2', background:'#1976d2', color:'#fff', borderRadius:4}}
                    onClick={async ()=>{
                      if (!rulePattern.trim()) { alert('Enter a regex pattern'); return; }
                      try {
                        const resp = await fetch('http://localhost:5000/rules/add', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ field: ruleField, pattern: rulePattern, flags:'i', section: ruleSection||null, window: 500, postprocess: rulePost? [rulePost]:[], priority: 100 }) });
                        const js = await resp.json();
                        if (js.success) {
                          alert('Rule saved. Re-run extraction to test.');
                        } else { alert(js.error || 'Failed to save rule'); }
                      } catch (e) { alert('Network error saving rule'); }
                    }}>Save Rule</button>
                </div>
                <div style={{fontSize:11, color:'#666', marginTop:6}}>Tip: Use a single capture group for the value. Section limits where we search.</div>
              </div>
            )}
            <p style={{marginTop:0, fontSize:12, color:'#555'}}>Modify the OCR text below and re-run extraction to update the template and fields.</p>
            <textarea ref={editTextAreaRef} value={editText} onChange={e=>setEditText(e.target.value)} rows={16} style={{width:'100%', boxSizing:'border-box', fontFamily:'monospace', fontSize:13, border:'1px solid #ccc', borderRadius:4, padding:8}} />
            <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:12}}>
              <button type="button" onClick={()=>{ setEditTarget(null); setEditText(''); }} disabled={editSubmitting} style={{background:'#eee', border:'1px solid #ccc', padding:'6px 14px', borderRadius:4, cursor:'pointer'}}>Cancel</button>
              <button type="button" disabled={editSubmitting} style={{background:'#1976d2', color:'#fff', border:'1px solid #1565c0', padding:'6px 14px', borderRadius:4, cursor:'pointer'}} onClick={async ()=>{
                if (!editTarget) return;
                setEditSubmitting(true);
                try {
                  const resp = await fetch('http://localhost:5000/reextract-text', {
                    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text: editText, avg_conf: results[editTarget.idx]?.avg_conf })
                  });
                  const js = await resp.json();
                  if (js.success) {
                    setResults(prev => {
                      const copy = prev.slice();
                      const cur = { ...(copy[editTarget.idx] || {}) };
                      // compute diff on fields before update
                      const before = (cur.enhanced_data || {});
                      cur.text = editText;
                      if (js.enhanced_data) cur.enhanced_data = js.enhanced_data;
                      if (js.individual_pdf_content) cur.individual_pdf_content = js.individual_pdf_content;
                      if (js.flags) cur.flags = js.flags;
                      if (js.actions) cur.actions = js.actions;
                      if (js.qc_results) cur.qc_results = js.qc_results;
                      if (js.suggested_filename) {
                        cur.suggested_filename = js.suggested_filename;
                      }
                      copy[editTarget.idx] = cur;
                      // record changes for quick feedback
                      try {
                        const after = js.enhanced_data || {};
                        const keys = [
                          'patient.first_name','patient.last_name','patient.dob','patient.phone_home','patient.height','patient.weight','patient.bmi','patient.blood_pressure',
                          'insurance.primary.carrier','insurance.primary.member_id','insurance.primary.authorization_number',
                          'physician.name','physician.npi','physician.clinic_phone',
                          'procedure.study_requested','procedure.cpt','procedure.indication',
                          'clinical.primary_diagnosis','clinical.epworth_score','clinical.neck_circumference',
                          'document_date','intake_date'
                        ];
                        const get = (obj, path) => path.split('.').reduce((o,k)=> (o&&o[k]!=null)? o[k]: undefined, obj);
                        const fmt = (v) => Array.isArray(v) ? v.join(', ') : (v==null? '' : String(v));
                        const ch = [];
                        keys.forEach(k=>{
                          const b = fmt(get(before,k));
                          const a = fmt(get(after,k));
                          if ((b||'') !== (a||'')) ch.push(`${k}: ${b||'—'} → ${a||'—'}`);
                        });
                        if (ch.length) setRecentChanges(m=> ({...m, [editTarget.resultId]: ch.slice(0,8)}));
                      } catch(_) {}
                      return copy;
                    });
                    setEditTarget(null); setEditText('');
                  } else {
                    alert(js.error || 'Failed to re-extract');
                  }
                } catch (e) {
                  alert('Network error re-extracting');
                } finally {
                  setEditSubmitting(false);
                }
              }}>{editSubmitting ? 'Re-extracting...' : 'Apply & Re-run'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
