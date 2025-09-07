import React, { useState } from 'react';

export default function Processing({ files: propFiles, loading: propLoading, results: propResults, onFileChange: propOnFileChange, onSubmit: propOnSubmit }) {
  const [files, setFiles] = useState(propFiles || []);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(propResults || []);
  const [batchMode, setBatchMode] = useState(false);
  const [intakeDate, setIntakeDate] = useState('');
  const [batchResults, setBatchResults] = useState(null);
  const [errorsCount, setErrorsCount] = useState(null);
  const [error, setError] = useState(null);

  const handleFileChange = (e) => {
    const f = Array.from(e.target.files || []);
    if (typeof propOnFileChange === 'function') {
      propOnFileChange(e);
    } else {
      setFiles(f);
    }
    setResults([]);
    setBatchResults(null);
    setError(null);
    setErrorsCount(null);
  };

  const openHtmlInNewWindow = (html) => {
    try {
      const w = window.open();
      if (!w) return;
      w.document.open();
      w.document.write(html || '<div>No content</div>');
      w.document.close();
    } catch (_) {
      // ignore
    }
  };

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (typeof propOnSubmit === 'function') {
      // allow parent to handle if it prefers
      try { propOnSubmit(e); } catch (_) {}
    }

    const useFiles = (propFiles && propFiles.length) ? propFiles : files;
    if (!useFiles || !useFiles.length) return setError('Please select at least one file');

    setLoading(true);
    setError(null);
    setBatchResults(null);
    setErrorsCount(null);

    const form = new FormData();
    useFiles.forEach(f => form.append('file', f));

    if (batchMode && intakeDate) {
      form.append('intake_date', intakeDate);
    }

    const endpoint = batchMode ? '/batch-ocr' : '/ocr?lang=eng';

    try {
      const resp = await fetch(`http://localhost:5001${endpoint}`, { method: 'POST', body: form });
      const js = await resp.json();

      if (batchMode) {
        if (js.success || js.processing_status) {
          setBatchResults(js);
        } else {
          setError(js.error || 'Batch processing failed');
        }
      } else {
        if (typeof js.errorsCount === 'number') setErrorsCount(js.errorsCount);
        if (js.error) setError(js.details || js.error);
        else if (js.results) setResults(js.results);
        else if (js.text) setResults([{ text: js.text }]);
      }
    } catch (err) {
      setError('Network or server error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card">
      <div className="card-header"><h2>Upload Documents</h2></div>
      <div className="card-body">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <input type="file" accept="image/*,.pdf" multiple onChange={handleFileChange} className="form-input" />
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={batchMode} onChange={e=>setBatchMode(e.target.checked)} /> Batch mode
            </label>
            {batchMode && (
              <input type="date" value={intakeDate} onChange={e=>setIntakeDate(e.target.value)} className="form-input w-auto" />
            )}
            <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Processing...' : 'Run OCR'}</button>
          </div>
        </form>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">{error}</div>
        )}

        {errorsCount !== null && (
          <div className="mt-3 text-sm text-gray-600">OCR Errors Count: {errorsCount}</div>
        )}

        {batchResults && (
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
            <h3 className="font-semibold">Batch Results</h3>
            <div className="text-sm mt-2">Status: {batchResults.processing_status || batchResults.status || String(batchResults.success)}</div>
            {batchResults.suggested_filename && <div className="text-sm">Suggested filename: {batchResults.suggested_filename}</div>}
            {batchResults.actions && batchResults.actions.length > 0 && (
              <div className="mt-2 text-sm">Actions required: {batchResults.actions.join('; ')}</div>
            )}
            {batchResults.client_features && batchResults.client_features.individual_pdf_ready && (
              <div className="mt-2">
                <button type="button" className="btn-outline btn-small" onClick={() => openHtmlInNewWindow(batchResults.individual_pdf_content || batchResults.client_features.individual_pdf_content)}>View Template</button>
              </div>
            )}
          </div>
        )}

        {results && results.length > 0 && (
          <div className="mt-4 space-y-3">
            <h3 className="font-semibold">Results</h3>
            {results.map((r, idx) => (
              <div key={r.id || idx} className="card p-3">
                <div className="flex justify-between items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{r.filename || r.suggested_filename || `Result ${idx+1}`}</div>
                    <div className="text-sm text-gray-600">Confidence: {r.avg_conf ? Math.round(r.avg_conf) : 'n/a'}</div>
                  </div>
                  <div className="flex gap-2 items-center">
                    {(r.client_features && r.client_features.individual_pdf_ready) || r.individual_pdf_content ? (
                      <button type="button" className="btn-outline btn-small" onClick={() => openHtmlInNewWindow(r.individual_pdf_content || r.client_features.individual_pdf_content)}>View Template</button>
                    ) : null}
                    <button type="button" className="btn-secondary btn-small" onClick={() => { navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(r, null, 2)); }}>Copy JSON</button>
                  </div>
                </div>
                {r.text && (
                  <pre className="mt-2 text-sm max-h-40 overflow-auto bg-gray-50 p-2 rounded">{r.text}</pre>
                )}
              </div>
            ))}
          </div>
        )}

      </div>
    </section>
  );
}
