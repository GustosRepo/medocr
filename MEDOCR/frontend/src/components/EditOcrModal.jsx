import React from 'react';

export default function EditOcrModal({
  open,
  editText,
  onChangeEditText,
  submitting = false,
  onCancel,
  onApply,
  // Rule form controls
  showRuleForm,
  setShowRuleForm,
  ruleFields = [],
  ruleField,
  setRuleField,
  onUseRecommended,
  showRuleAdvanced,
  setShowRuleAdvanced,
  rulePattern,
  setRulePattern,
  ruleSection,
  setRuleSection,
  rulePost,
  setRulePost,
  onSaveRule,
  escapeRegex,
  editTextAreaRef,
  onCleanOcr,
}) {
  if (!open) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2100 }}>
      <div style={{ background: '#fff', width: 'min(760px,92%)', maxHeight: '90vh', overflow: 'auto', borderRadius: 8, padding: '1.25rem', boxShadow: '0 4px 18px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>Edit OCR Text</h3>
          <button type="button" onClick={() => setShowRuleForm(s => !s)} style={{ fontSize: 12, padding: '4px 10px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer' }}>
            {showRuleForm ? 'Hide Add Rule' : 'Add Rule'}
          </button>
          <button type="button"
            onClick={onCleanOcr}
            style={{ fontSize: 12, padding: '4px 10px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer' }}>
            Clean OCR
          </button>
        </div>

        {showRuleForm && (
          <div style={{ border: '1px solid #e0e0e0', borderRadius: 6, padding: 10, margin: '6px 0 10px 0', background: '#fafafa' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <label style={{ fontSize: 12 }}>Field:&nbsp;
                <select value={ruleField} onChange={e => { setRuleField(e.target.value); onUseRecommended(e.target.value); }} style={{ fontSize: 12 }}>
                  {ruleFields.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => onUseRecommended(ruleField)} style={{ fontSize: 12, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer' }}>Use Recommended</button>
              <button type="button" onClick={() => {
                const el = editTextAreaRef?.current; if (!el) return; const start = el.selectionStart || 0; const end = el.selectionEnd || 0; const sel = (el.value || '').slice(start, end).trim(); if (!sel) { alert('Select text in the OCR box below first.'); return; }
                setRulePattern(`(${escapeRegex(sel)})`);
              }} style={{ fontSize: 12, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer' }}>Use Selection</button>
              <button type="button" onClick={() => setShowRuleAdvanced(s => !s)} style={{ fontSize: 12, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer' }}>{showRuleAdvanced ? 'Hide Advanced' : 'Advanced'}</button>
              {showRuleAdvanced && (
                <>
                  <label style={{ fontSize: 12, flex: '1 1 260px' }}>Pattern (group 1 is value):
                    <input value={rulePattern} onChange={e => setRulePattern(e.target.value)} placeholder={"e.g. Member\\s*ID[:\\s]*([A-Za-z0-9- ]{3,})"} style={{ width: '100%' }} />
                  </label>
                  <label style={{ fontSize: 12, flex: '1 1 220px' }}>Section (optional):
                    <input value={ruleSection} onChange={e => setRuleSection(e.target.value)} placeholder={'e.g. Insurance\\s*\\(Primary\\)'} style={{ width: '100%' }} />
                  </label>
                  <label style={{ fontSize: 12 }}>Postprocess:
                    <select value={rulePost} onChange={e => setRulePost(e.target.value)} style={{ fontSize: 12 }}>
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
              <button type="button" style={{ fontSize: 12, padding: '4px 10px', border: '1px solid #1976d2', background: '#1976d2', color: '#fff', borderRadius: 4 }}
                onClick={onSaveRule}>Save Rule</button>
            </div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>Tip: Use a single capture group for the value. Section limits where we search.</div>
          </div>
        )}

        <p style={{ marginTop: 0, fontSize: 12, color: '#555' }}>Modify the OCR text below and re-run extraction to update the template and fields.</p>
        <textarea ref={editTextAreaRef} value={editText} onChange={e => onChangeEditText(e.target.value)} rows={16} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 13, border: '1px solid #ccc', borderRadius: 4, padding: 8 }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button type="button" onClick={onCancel} disabled={submitting} style={{ background: '#eee', border: '1px solid #ccc', padding: '6px 14px', borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
          <button type="button" disabled={submitting} style={{ background: '#1976d2', color: '#fff', border: '1px solid #1565c0', padding: '6px 14px', borderRadius: 4, cursor: 'pointer' }} onClick={onApply}>
            {submitting ? 'Re-extracting...' : 'Apply & Re-run'}
          </button>
        </div>
      </div>
    </div>
  );
}

