import React from 'react';

export default function CommentModal({
  open,
  commentText,
  onChangeText,
  submitting = false,
  onCancel,
  onSubmit,
}) {
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000
    }}>
      <div style={{
        background: '#fff', width: 'min(560px,90%)', borderRadius: 8, padding: '1.5rem',
        boxShadow: '0 4px 18px rgba(0,0,0,0.25)', fontSize: 14
      }}>
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>Help Improve Extraction</h3>
        <p style={{ marginTop: 0, fontSize: 12, color: '#555' }}>
          Optional: describe what's incorrect or missing to help us improve.
        </p>
        <textarea
          value={commentText}
          onChange={(e) => onChangeText(e.target.value)}
          rows={5}
          style={{
            width: '100%', resize: 'vertical', padding: 8, fontFamily: 'inherit',
            fontSize: 13, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box'
          }}
          placeholder="e.g. DOB wrong; missing secondary insurance; CPT should be 95811 not 95810"
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            style={{ background: '#eee', border: '1px solid #ccc', padding: '6px 14px', borderRadius: 4, cursor: 'pointer' }}
          >Cancel</button>
          <button
            type="button"
            disabled={submitting}
            style={{ background: '#c62828', color: '#fff', border: '1px solid #b71c1c', padding: '6px 14px', borderRadius: 4, cursor: 'pointer' }}
            onClick={onSubmit}
          >{submitting ? 'Submitting...' : 'Submit Feedback'}</button>
        </div>
      </div>
    </div>
  );
}

