import { useState, useRef, useEffect } from 'react';
import './App.css';

import api, {
  ocr as apiOcr,
  batchOcr as apiBatchOcr,
  reextractText as apiReextractText,
  exportCombinedData as apiExportCombinedData,
  exportMassCombined as apiExportMassCombined,
  listAllowedFields as apiListAllowedFields,
  addRule as apiAddRule,
  feedback as apiFeedback,
  checklistList as apiChecklistList,
} from './lib/api';

import useHashSync from './hooks/useHashSync';
import useSectionCollapse from './hooks/useSectionCollapse';

import CommentModal from './components/CommentModal';
import EditOcrModal from './components/EditOcrModal';
import Checklist from './components/Checklist';
import ProcessingPage from './pages/ProcessingPage';

function App() {
  const [activeView, setActiveView] = useState('process');
  useHashSync(activeView, setActiveView);

  // OCR processing state
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [batchResults, setBatchResults] = useState(null);
  const [batchProgress, setBatchProgress] = useState(null);
  const batchProgressTimerRef = useRef(null);
  const [errorsCount, setErrorsCount] = useState(0);
  const [intakeDate] = useState(() => {
    const t = new Date();
    return `${String(t.getMonth() + 1).padStart(2, '0')}/${String(t.getDate()).padStart(2, '0')}/${t.getFullYear()}`;
  });

  // Collapse controls shared by Result rows
  const { collapsedRows, collapsedSections, toggleRowCollapse, toggleSectionCollapse, isSectionCollapsed } = useSectionCollapse();

  // Feedback state
  const [feedbackSubmitting, setFeedbackSubmitting] = useState({});
  const [feedbackSent, setFeedbackSent] = useState({});
  const [commentTarget, setCommentTarget] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [commentSending, setCommentSending] = useState(false);

  // Export state
  const [exportingPdf, setExportingPdf] = useState({});
  const [massExporting, setMassExporting] = useState(false);

  // Edit OCR / rule form state
  const [editTarget, setEditTarget] = useState(null); // { idx, resultId, text }
  const [editText, setEditText] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleField, setRuleField] = useState('insurance.primary.carrier');
  const [ruleFields, setRuleFields] = useState([
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
  const [showRuleAdvanced, setShowRuleAdvanced] = useState(false);
  const editTextAreaRef = useRef(null);
  const [recentChanges, setRecentChanges] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const js = await apiListAllowedFields();
        if (js && Array.isArray(js.fields) && js.fields.length) {
          setRuleFields(js.fields);
          if (!js.fields.includes(ruleField)) setRuleField(js.fields[0]);
        }
      } catch (_) {}
    })();
  }, []);

  const handleFileChange = (e) => {
    setFiles(Array.from(e.target.files || []));
    setResults([]);
    setError(null);
    setBatchResults(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!files.length) return;
    setLoading(true);
    setError(null);
    setBatchResults(null);
    setResults([]);
    const formData = new FormData();
    files.forEach(f => formData.append('file', f));
    const isBatch = files.length > 1;
    let jobId = null;
    if (isBatch) {
      formData.append('intake_date', intakeDate);
      // create a client-side job id so we can poll progress while upload is processing
      jobId = Math.random().toString(36).slice(2);
      formData.append('job_id', jobId);
      setBatchProgress({ id: jobId, total: files.length, done: 0, status: 'processing' });
      // start polling progress
      const tick = async () => {
        try {
          const js = await api.batchOcrProgress(jobId);
          if (js && js.success && js.progress) {
            setBatchProgress(js.progress);
            if (js.progress.status === 'complete' || js.progress.status === 'error') {
              if (batchProgressTimerRef.current) { clearInterval(batchProgressTimerRef.current); batchProgressTimerRef.current = null; }
            }
          }
        } catch (_) {}
      };
      batchProgressTimerRef.current = setInterval(tick, 1000);
    }
    try {
      const data = isBatch ? await apiBatchOcr(formData) : await apiOcr(formData);
      if (isBatch) {
        if (data.success) {
          setBatchResults(data);
          if (Array.isArray(data.results)) setResults(data.results);
          // ensure progress shows complete
          if (data.job_id && batchProgress?.id === data.job_id) {
            setBatchProgress(p => p ? { ...p, done: p.total, status: 'complete' } : p);
          }
        } else {
          let msg = data.error || 'Batch processing failed';
          if (data.details) msg += ` — ${data.details}`;
          if (data.preview) msg += ` (preview: ${data.preview})`;
          setError(msg);
          if (data.job_id) setBatchProgress(p => p ? { ...p, status: 'error' } : p);
        }
      } else {
        if (typeof data.errorsCount === 'number') setErrorsCount(data.errorsCount);
        if (data.error) setError(data.details || data.error);
        else if (data.results) setResults(data.results);
        else setResults([{ text: data.text }]);
      }
    } catch (_) {
      setError('Network or server error');
    } finally {
      setLoading(false);
      if (batchProgressTimerRef.current) { clearInterval(batchProgressTimerRef.current); batchProgressTimerRef.current = null; }
    }
  };

  function openHtmlInNewWindow(html) {
    try { const w = window.open(); if (!w) return; w.document.open(); w.document.write(html || '<div>No content</div>'); w.document.close(); } catch (_) {}
  }

  async function handleFeedbackAction(resultId, kind) {
    const r = results.find(x => (x.id || x.suggested_filename || x.filename) === resultId) || {};
    const effectiveEnhanced = r.enhanced_data || {};
    const fbState = feedbackSent[resultId];
    if (fbState || feedbackSubmitting[resultId]) return;
    const basePayload = {
      result_id: resultId,
      feedback: kind,
      filename: r.filename,
      flags: r.flags || [],
      actions: r.actions || [],
      avg_conf: r.avg_conf,
      enhanced_data: kind === 'down' ? effectiveEnhanced : undefined,
    };
    if (kind === 'down') { setCommentTarget({ resultId, payload: basePayload }); return; }
    setFeedbackSubmitting(s => ({ ...s, [resultId]: true }));
    try { const js = await apiFeedback(basePayload); if (js.ok) setFeedbackSent(s => ({ ...s, [resultId]: kind })); } finally { setFeedbackSubmitting(s => ({ ...s, [resultId]: false })); }
  }

  async function handleExportCombinedPdfAction(resultId, r) {
    if (exportingPdf[resultId]) return;
    setExportingPdf(s => ({ ...s, [resultId]: true }));
    try {
      const payload = {
        originalFilename: r.original_saved_name || r.filename,
        enhancedData: r.enhanced_data || {},
        avgConf: r.avg_conf,
        flags: r.flags || [],
        actions: r.actions || [],
        text: r.text || '',
        highlight: true
      };
      const result = await apiExportCombinedData(payload);
      if (result.success) alert(`Combined PDF exported!\nSaved as: ${result.filename}`); else alert(`Export failed: ${result.error}`);
    } catch (e) {
      alert('Failed to export combined PDF (server error)');
    } finally {
      setExportingPdf(s => ({ ...s, [resultId]: false }));
    }
  }

  function setRecommendedForField(field) {
    if (field === 'insurance.primary.member_id') { setRulePattern('Member\\s*ID[:\\s]*([A-Za-z0-9- ]{3,})'); setRuleSection('Insurance\\s*\\(Primary\\)'); setRulePost('strip_spaces'); }
    else if (field === 'insurance.primary.carrier') { setRulePattern('Carrier[:\\s]*([A-Za-z][A-Za-z0-9 &\\-]{2,})'); setRuleSection('Insurance\\s*\\(Primary\\)'); setRulePost('collapse_duplicate_tokens'); }
    else if (field === 'insurance.primary.authorization_number') { setRulePattern('Authorization(?:\\s*number)?[:\\s]*([A-Za-z0-9\\-]+)'); setRuleSection('Insurance\\s*\\(Primary\\)'); setRulePost('trim'); }
    else if (field === 'patient.blood_pressure') { setRulePattern('(?:Blood\\s*Pressure|BP)[:\\s]*([0-2]?\\d{2}/[0-2]?\\d{2})'); setRuleSection(''); setRulePost('trim'); }
    else if (field === 'patient.phone_home' || field === 'physician.clinic_phone') { const lbl = field==='patient.phone_home'?'Phone(?:\\s*\\(Home\\))?':'Clinic\\s*phone'; setRulePattern(`${lbl}[:\\s]*([()\\-\\.\\s\\d]{10,20})`); setRuleSection(''); setRulePost('nanp_phone'); }
    else if (field === 'physician.npi') { setRulePattern('NPI[:\\s]*([0-9]{8,15})'); setRuleSection(''); setRulePost('trim'); }
    else if (field === 'procedure.cpt') { setRulePattern('\\b(9\\\\d{4})\\b'); setRuleSection(''); setRulePost('trim'); }
    else if (field === 'insurance.primary.group') { setRulePattern('Group[:\\s]*([A-Za-z0-9- ]{2,})'); setRuleSection('Insurance\\s*\\(Primary\\)'); setRulePost('trim'); }
    else if (field === 'insurance.secondary.carrier') { setRulePattern('Carrier[:\\s]*([A-Za-z][A-Za-z0-9 &\\-]{2,})'); setRuleSection('Insurance\\s*\\(Secondary\\)'); setRulePost('collapse_duplicate_tokens'); }
    else if (field === 'insurance.secondary.member_id') { setRulePattern('Member\\s*ID[:\\s]*([A-Za-z0-9- ]{3,})'); setRuleSection('Insurance\\s*\\(Secondary\\)'); setRulePost('strip_spaces'); }
    else if (field === 'procedure.description') { setRulePattern('Description[:\\s]*([^\\n]+)'); setRuleSection(''); setRulePost('trim'); }
    else if (field === 'physician.practice') { setRulePattern('Practice[:\\s]*([^\\n]+)'); setRuleSection(''); setRulePost('trim'); }
    else if (field === 'physician.supervising') { setRulePattern('Supervising\\s*Physician[^:]*[:\\s]*([^\\n]+)'); setRuleSection(''); setRulePost('trim'); }
    else if (field === 'document_date') { setRulePattern('(?:Referral\\s*Date|Document\\s*Date)[:\\s]*([01]?\\d\\/[0-3]?\\d\\/\\d{4})'); setRuleSection(''); setRulePost('trim'); }
    else if (field === 'intake_date') { setRulePattern('(?:Intake\\s*(?:processing|Date))[:\\s]*([01]?\\d\\/[0-3]?\\d\\/\\d{4})'); setRuleSection(''); setRulePost('trim'); }
    else { setRulePattern(''); setRuleSection(''); setRulePost('trim'); }
  }
  function escapeRegex(s) { return (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

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
        <div className="content-area">
          {activeView==='process' && (
            <ProcessingPage
              files={files}
              loading={loading}
              error={error}
              onFileChange={handleFileChange}
              onSubmit={handleSubmit}
              results={results}
              errorsCount={errorsCount}
              batchResults={batchResults}
              batchProgress={batchProgress}
              massExporting={massExporting}
              onMassExport={async () => {
                if (massExporting) return;
                setMassExporting(true);
                try {
                  const allExportData = results.map(r => ({
                    originalFilename: r.original_saved_name || r.filename,
                    enhancedData: r.enhanced_data || {},
                    text: r.text,
                    avgConf: r.avg_conf,
                    flags: r.flags || [],
                    actions: r.actions || [],
                    highlight: true
                  }));
                  const result = await apiExportMassCombined({ batchExport: true, documents: allExportData });
                  if (result.success) {
                    const successCount = result.export_count || 0;
                    const errorCount = result.error_count || 0;
                    let message = `Mass export completed!\n✅ Successfully exported ${successCount} individual PDF files`;
                    if (errorCount > 0) message += `\n❌ ${errorCount} files had errors`;
                    if (result.files && result.files.length > 0) {
                      const fileList = result.files.filter(f => !f.error).map(f => `• ${f.filename} (${f.patient})`).slice(0,5).join('\n');
                      message += `\n\nFiles created:\n${fileList}`;
                      if (result.files.length > 5) message += `\n... and ${result.files.length - 5} more files`;
                    }
                    alert(message);
                    try { await apiChecklistList(); } catch(_){}
                  } else {
                    alert(`Mass export failed: ${result.error}`);
                  }
                } catch (e) {
                  alert('Failed to export mass combined PDF (server error)');
                } finally {
                  setMassExporting(false);
                }
              }}
              collapsedRows={collapsedRows}
              collapsedSections={collapsedSections}
              toggleRowCollapse={toggleRowCollapse}
              toggleSectionCollapse={toggleSectionCollapse}
              isSectionCollapsed={isSectionCollapsed}
              handleFeedback={(id, kind) => handleFeedbackAction(id, kind)}
              handleExportCombinedPdf={(id, rr) => handleExportCombinedPdfAction(id, rr)}
              openHtmlInNewWindow={openHtmlInNewWindow}
              setEditTarget={setEditTarget}
              setEditText={setEditText}
              exportingPdf={exportingPdf}
            />
          )}
          {activeView==='checklist' && (
            <Checklist />
          )}
        </div>

        <CommentModal
          open={!!commentTarget}
          commentText={commentText}
          onChangeText={setCommentText}
          submitting={commentSending}
          onCancel={() => { setCommentTarget(null); setCommentText(''); }}
          onSubmit={async () => {
            if (!commentTarget) return;
            setCommentSending(true);
            try {
              const body = { ...commentTarget.payload, comment: commentText || undefined };
              const js = await apiFeedback(body);
              if (js.ok) { setFeedbackSent(s => ({ ...s, [commentTarget.resultId]: 'down' })); setCommentTarget(null); setCommentText(''); }
            } catch(_) {} finally { setCommentSending(false); }
          }}
        />

        <EditOcrModal
          open={!!editTarget}
          editText={editText}
          onChangeEditText={setEditText}
          submitting={editSubmitting}
          onCancel={() => { setEditTarget(null); setEditText(''); }}
          onApply={async () => {
            if (!editTarget) return;
            setEditSubmitting(true);
            try {
              const js = await apiReextractText({ text: editText, avg_conf: results[editTarget.idx]?.avg_conf });
              if (js.success) {
                setResults(prev => {
                  const copy = prev.slice();
                  const cur = { ...(copy[editTarget.idx] || {}) };
                  const before = (cur.enhanced_data || {});
                  cur.text = editText;
                  if (js.enhanced_data) cur.enhanced_data = js.enhanced_data;
                  if (js.individual_pdf_content) cur.individual_pdf_content = js.individual_pdf_content;
                  if (js.flags) cur.flags = js.flags;
                  if (js.actions) cur.actions = js.actions;
                  if (js.qc_results) cur.qc_results = js.qc_results;
                  if (js.suggested_filename) cur.suggested_filename = js.suggested_filename;
                  copy[editTarget.idx] = cur;
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
            } catch (_) { alert('Network error re-extracting'); }
            finally { setEditSubmitting(false); }
          }}
          showRuleForm={showRuleForm}
          setShowRuleForm={setShowRuleForm}
          ruleFields={ruleFields}
          ruleField={ruleField}
          setRuleField={setRuleField}
          onUseRecommended={(f) => setRecommendedForField(f)}
          showRuleAdvanced={showRuleAdvanced}
          setShowRuleAdvanced={setShowRuleAdvanced}
          rulePattern={rulePattern}
          setRulePattern={setRulePattern}
          ruleSection={ruleSection}
          setRuleSection={setRuleSection}
          rulePost={rulePost}
          setRulePost={setRulePost}
          onSaveRule={async () => {
            if (!rulePattern.trim()) { alert('Enter a regex pattern'); return; }
            try {
              const js = await apiAddRule({ field: ruleField, pattern: rulePattern, flags:'i', section: ruleSection||null, window: 500, postprocess: rulePost? [rulePost]:[], priority: 100 });
              if (js.success) alert('Rule saved. Re-run extraction to test.'); else alert(js.error || 'Failed to save rule');
            } catch (_) { alert('Network error saving rule'); }
          }}
          escapeRegex={escapeRegex}
          editTextAreaRef={editTextAreaRef}
          onCleanOcr={() => {
            const lines = (editText||'').split(/\r?\n/);
            const isJunk = (ln) => {
              const s = (ln||'').trim(); if (!s) return true;
              const letters = (s.match(/[A-Za-z]/g)||[]).length; const digits = (s.match(/\d/g)||[]).length; const alnum = letters + digits;
              if (alnum <= 2) return true;
              if (/\b(PATIENT|INSURANCE|REFERRAL|NPI|DOB|PROCEDURE|CLINICAL|VITALS|HEIGHT|WEIGHT|BMI|Provider|Referring)\b/i.test(s)) return false;
              const specials = (s.match(/[^\w\s]/g)||[]).length; return specials > alnum * 2;
            };
            let i=0; while(i<lines.length && isJunk(lines[i])) i++;
            const cleaned = lines.slice(i).join('\n'); setEditText(cleaned);
          }}
        />
      </main>
    </div>
  );
}

export default App;
