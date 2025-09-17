import React, { useState } from 'react';
import FeedbackPanel from './panels/FeedbackPanel';
import ExportPanel from './panels/ExportPanel';

export default function ResultCard({ r, idx, files, toggleRowCollapse, collapsedRows, collapsedSections, toggleSectionCollapse, handleFeedback, handleExportCombinedPdf, openHtmlInNewWindow, setEditTarget, setEditText, isSectionCollapsed }) {
  const resultId = r.id || r.suggested_filename || r.filename || `res-${idx}`;
  const isCollapsed = !!collapsedRows[resultId];
  const avg = r.avg_conf !== undefined ? Number(r.avg_conf) : null;
  const avgConfText = avg !== null ? `${(avg > 1 ? avg : avg * 100).toFixed(1)}%` : null;

  // Confidence label + percent (prefers rule-driven label)
  const confidenceLabel = r.confidence_label || r.confidence || null;
  const confidencePct = (r.confidence_detail && (r.confidence_detail.percent ?? r.confidence_detail.score))
    ?? (avg !== null ? (avg > 1 ? avg : avg * 100) : null);

  // Primary diagnosis (prefer explicit, else first ICD entry)
  const primaryDx = r?.clinical?.primary_diagnosis
    || (Array.isArray(r?.clinical?.icd10_codes) && r.clinical.icd10_codes.length > 0
        ? `${r.clinical.icd10_codes[0]?.code || ''} - ${r.clinical.icd10_codes[0]?.label || ''}`.trim()
        : null);

  // CPT code + description (string or list)
  const cpt = Array.isArray(r?.procedure?.cpt) ? (r.procedure.cpt[0] || null) : (r?.procedure?.cpt || null);
  const cptDesc = r?.procedure?.description || null;

  // Insurance basics
  const carrier = r?.insurance?.primary?.carrier || r?.insurance?.carrier || null;
  const memberId = r?.insurance?.primary?.member_id || r?.insurance?.member_id || null;

  // Group flags into buckets for nicer display
  const actionSet = new Set([
    'MISSING_CHART_NOTES','SELF_PAY_WORKFLOW','AUTHORIZATION_REQUIRED','INSURANCE_NOT_ACCEPTED','INSURANCE_SUNSET_WARNING','PROVIDER_FOLLOWUP_REQUIRED'
  ]);
  const reviewSet = new Set([
    'MANUAL_REVIEW_REQUIRED','DME_PRESENT_REVIEW_REQUIRED','ICD_PRIMARY_MISSING','ICD_SUPPORTING_MISSING','TITRATION_REQUIRES_CLINICAL_REVIEW','WRONG_TEST_ORDERED_SPLITNIGHT_CONFLICT','CONTRADICTIONS_DETECTED'
  ]);
  const groupedFlags = (Array.isArray(r.flags) ? r.flags : []).reduce((acc, f) => {
    if (reviewSet.has(f)) acc['Additional Review'].push(f);
    else if (actionSet.has(f)) acc['Action'].push(f);
    else acc['Info'].push(f);
    return acc;
  }, { 'Info': [], 'Action': [], 'Additional Review': [] });

  return (
    <div className={`document-card ${isCollapsed ? 'collapsed' : ''}`} style={{ width: '100%', minWidth: '100%', boxSizing: 'border-box' }}>
      <div className="p-8 bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200" style={{ width: '100%', position: 'relative', paddingRight: '7rem', minHeight: '90px' }}>
        <div className="flex items-center gap-10">
          <div className="flex items-center justify-center w-16 h-16 bg-primary/10 rounded-full mr-6">
            <span className="text-2xl">📄</span>
          </div>
          <div className="flex flex-row items-center min-w-0 gap-6 pl-2 pr-2 flex-1">
            <h3
              className="font-bold text-gray-800 text-xl flex-1 min-w-0 truncate"
              style={{ lineHeight: '1.2', marginBottom: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              title={r.filename || `Document ${idx + 1}`}
            >
              {r.filename || `Document ${idx + 1}`}
            </h3>
            {(confidenceLabel || confidencePct !== null) && (
              <span
                className={`confidence-badge ml-4 text-base ${(() => {
                  const pct = Number(confidencePct);
                  if (confidenceLabel === 'Manual Review') return 'confidence-low';
                  if (!isNaN(pct)) {
                    if (pct >= 90) return 'confidence-high';
                    if (pct >= 80) return 'confidence-medium';
                    if (pct >= 70) return 'confidence-low';
                  }
                  return 'confidence-medium';
                })()}`}
                title={(r.confidence_detail?.reasons || []).join('; ')}
              >
                {confidenceLabel ? `${confidenceLabel}` : 'Confidence'}
                {confidencePct !== null ? ` · ${Number(confidencePct).toFixed(0)}%` : ''}
              </span>
            )}
          </div>
        </div>
        <button
          className="btn-small btn-outline px-3 py-2 text-sm hover:scale-105 transition-transform duration-200"
          onClick={() => toggleRowCollapse(resultId)}
          title={isCollapsed ? 'Expand row' : 'Collapse row'}
          style={{ position: 'absolute', top: 24, right: 24, zIndex: 2 }}
        >
          <span className="flex items-center gap-1">{isCollapsed ? '▶' : '▼'}<span className="hidden sm:inline">{isCollapsed ? 'Expand' : 'Collapse'}</span></span>
        </button>
      </div>

      <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[5000px] opacity-100'}`} style={{ width: '100%', boxSizing: 'border-box' }}>
        <div className="p-6" style={{ width: '100%', boxSizing: 'border-box' }}>

          <div className="mb-6 p-4 bg-gradient-to-r from-gray-50 to-gray-100 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex gap-8 items-start flex-wrap">
              <FeedbackPanel resultId={resultId} onFeedback={handleFeedback} />
              <ExportPanel resultId={resultId} r={r} onExport={handleExportCombinedPdf} openHtmlInNewWindow={openHtmlInNewWindow} />
            </div>
          </div>

          {/* Key Facts */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            <div className="border rounded-xl p-3 bg-white/60">
              <div className="text-gray-500 text-sm">CPT</div>
              <div className="font-medium">{cpt || '—'}</div>
              {cptDesc ? <div className="text-gray-600 text-sm">{cptDesc}</div> : null}
            </div>
            <div className="border rounded-xl p-3 bg-white/60">
              <div className="text-gray-500 text-sm">Primary Diagnosis</div>
              <div className="font-medium">{primaryDx || '—'}</div>
            </div>
            <div className="border rounded-xl p-3 bg-white/60">
              <div className="text-gray-500 text-sm">Insurance</div>
              <div className="font-medium">{carrier || '—'}</div>
              {memberId ? <div className="text-gray-600 text-sm">ID: {memberId}</div> : null}
            </div>
          </div>

          {/* Image preview */}
          <div className="mb-4">
            <div className="flex items-center justify-between p-3 bg-gray-100 rounded-t-lg border border-gray-200">
              <h3 className="font-semibold text-gray-800">{r.filename || files[idx]?.name || `File ${idx+1}`}</h3>
              <button className="btn-small btn-outline px-2 py-1 text-xs" onClick={() => toggleSectionCollapse(resultId, 'image')} title={isSectionCollapsed(resultId, 'image') ? 'Show image preview' : 'Hide image preview'}>{isSectionCollapsed(resultId, 'image') ? '▶' : '▼'}</button>
            </div>
            {!isSectionCollapsed(resultId, 'image') && (
              <div className="bg-gray-50 border border-t-0 border-gray-200 rounded-b-lg p-4">
                <div className="w-full aspect-[8.5/11] bg-white border border-gray-300 rounded-lg flex items-center justify-center overflow-hidden mb-4">
                  {files[idx] && files[idx].type?.startsWith('image/') ? (
                    <img src={URL.createObjectURL(files[idx])} alt={files[idx].name} className="max-w-full h-auto object-contain" />
                  ) : (
                    <div className="text-4xl text-gray-400"><span role="img" aria-label="PDF">📄</span></div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* OCR text */}
          <div className="compare-ocr has-template" style={{display:'flex', gap: '2rem', alignItems:'flex-start'}}>
            <div className="ocr-pane" style={{flex: '2 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
              <div className="ocr-col" style={{width: '100%', maxWidth: 700, minWidth: 320}}>
                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8}}>
                  <span style={{display:'flex', alignItems:'center', gap:8}}>OCR Text</span>
                  <div>
                    <button type="button" onClick={()=>{ setEditTarget({ idx, resultId, text: r.text||'' }); setEditText(r.text||''); }} style={{fontSize:12, padding:'2px 8px'}}>Edit OCR</button>
                  </div>
                </div>
                <pre className="ocr-text" style={{whiteSpace:'pre-wrap', marginTop:8, fontSize: '1rem', background: '#f9f9f9', borderRadius: 6, padding: '1rem', minHeight: 120, width: '100%', boxSizing: 'border-box', overflowX: 'auto'}}>{r.text}</pre>
                {r.qc_results && (
                  <div className="qc-section mt-3">
                    {(r.qc_results.errors?.length > 0 || r.qc_results.warnings?.length > 0) ? (
                      <div>
                        {r.qc_results.errors?.map((error, i) => <div key={i} className="qc-error">❌ {error}</div>)}
                        {r.qc_results.warnings?.map((warning, i) => <div key={i} className="qc-warning">⚠️ {warning}</div>)}
                      </div>
                    ) : <div className="qc-pass">✅ All quality checks passed</div>}
                  </div>
                )}
              </div>

            </div>

            <div className="side-col" style={{flex: '1 1 0', minWidth: 220}}>
                {(Array.isArray(r.flags) && r.flags.length > 0) && (
                  <div className="flags-section">
                    <div className="col-title">Intelligent Flags</div>
                    <div className="grid grid-cols-1 gap-2 mt-2">
                      {Object.entries(groupedFlags).map(([group, items]) => (
                        <div key={group} className="border rounded-lg p-2">
                          <div className="text-gray-500 text-xs mb-1">{group}</div>
                          {items.length === 0 ? (
                            <div className="text-gray-400 text-xs">None</div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {items.map((f, i) => (
                                <span key={`${group}-${i}`} className="flag-badge" style={{marginRight:6}}>{f}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {Array.isArray(r.actions) && r.actions.length > 0 && (
                  <div className="actions-section mt-3">
                    <div className="col-title">Required Actions</div>
                    <ul className="actions-list" style={{marginTop:6}}>{r.actions.map((a,i)=>(<li key={i}>{a}</li>))}</ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
  );
}
