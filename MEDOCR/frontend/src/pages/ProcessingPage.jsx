import React from 'react';
import useOcrProcessing from '../hooks/useOcrProcessing';
import ResultsList from '../components/ResultsList';

export default function ProcessingPage({
  // Optional overrides from parent; defaults come from useOcrProcessing()
  files: pFiles,
  loading: pLoading,
  error: pError,
  onFileChange: pOnFileChange,
  onSubmit: pOnSubmit,
  results: pResults,
  errorsCount: pErrorsCount,
  batchResults: pBatchResults,
  massExporting,
  onMassExport,
  collapsedRows,
  collapsedSections,
  toggleRowCollapse,
  toggleSectionCollapse,
  isSectionCollapsed,
  handleFeedback,
  handleExportCombinedPdf,
  openHtmlInNewWindow,
  setEditTarget,
  setEditText,
  exportingPdf,
}) {
  const proc = useOcrProcessing();
  const files = pFiles ?? proc.files;
  const loading = pLoading ?? proc.loading;
  const error = pError ?? proc.error;
  const onFileChange = pOnFileChange ?? proc.handleFileChange;
  const onSubmit = pOnSubmit ?? proc.handleSubmit;
  const results = pResults ?? proc.results;
  const errorsCount = pErrorsCount ?? proc.errorsCount;
  const batchResults = pBatchResults ?? proc.batchResults;
  return (
    <>
      {/* Upload Documents */}
      <section className="card hover:shadow-xl transition-all duration-300">
        <div className="card-header">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <span className="text-2xl">📄</span>
            Upload Documents
          </h2>
        </div>
        <div className="card-body">
          <form onSubmit={onSubmit} className="space-y-6">
            <div className="form-group">
              <div className="relative">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  multiple
                  onChange={onFileChange}
                  className="form-input file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary file:text-white file:font-semibold hover:file:bg-primary/90 file:transition-all file:duration-200"
                  disabled={loading}
                />
                {loading && (
                  <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary border-t-transparent"></div>
                      <span className="text-sm text-gray-600">Processing...</span>
                    </div>
                  </div>
                )}
              </div>
              <button
                type="submit"
                disabled={!files.length || loading}
                className={`btn-primary mt-4 w-full sm:w-auto min-w-[140px] ${loading ? 'loading-shimmer' : ''}`}
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    Processing...
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span>🔍</span>
                    Run OCR
                  </div>
                )}
              </button>
            </div>
          </form>

          {files.length > 0 && (
            <div className="mt-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200 shadow-inner">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-blue-600 font-semibold text-sm">📎 Selected Files</span>
                <span className="badge badge-info">{files.length}</span>
              </div>
              <div className="grid gap-2">
                {files.map((f) => (
                  <div key={f.name} className="flex items-center gap-3 p-2 bg-white/80 rounded-md border border-blue-100">
                    <span className="text-lg">{f.type?.startsWith('image/') ? '🖼️' : '📄'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-blue-800 truncate">{f.name}</p>
                      <p className="text-xs text-blue-600">{(f.size / 1024 / 1024).toFixed(2)} MB • {f.type || 'Unknown type'}</p>
                    </div>
                    <div className="flex-shrink-0">
                      <span className="badge badge-success text-xs">Ready</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {error && (
            <div className="mt-4 p-4 bg-gradient-to-r from-red-50 to-red-100 border border-red-200 rounded-lg shadow-sm">
              <div className="flex items-center gap-2">
                <span className="text-red-500 text-lg">⚠️</span>
                <div>
                  <p className="text-red-800 font-semibold text-sm">Processing Error</p>
                  <p className="text-red-700 text-sm">{error}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Batch Results Summary */}
      {batchResults && (
        <section className="card">
          <div className="card-header">
            <h2 className="text-xl font-semibold">Batch Processing Results - Client Requirements</h2>
          </div>
          <div className="card-body">
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">
                Processing Summary - Intake Date: {batchResults.intake_date}
              </h3>
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
          </div>
        </section>
      )}

      {/* Individual Results */}
      {results.length > 0 && (
        <section className="card result-card">
          <h2>Individual Processing Results</h2>
          {typeof errorsCount === 'number' && (
            <div className="aggregate-status">
              <span className="pill">Errors in batch: <b>{errorsCount}</b></span>
            </div>
          )}

          {/* Mass Export Bar */}
          <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 via-indigo-50 to-blue-50 rounded-xl border border-blue-200 shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full">
                  <span className="text-xl">📦</span>
                </div>
                <div>
                  <h3 className="text-blue-700 font-bold text-base">Mass Export</h3>
                  <p className="text-blue-600 text-sm">Export all {results.length} documents as individual PDF files</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onMassExport}
                disabled={massExporting}
                className={`btn-primary btn-small flex items-center gap-2 ${massExporting ? 'opacity-60 cursor-not-allowed' : 'hover:scale-105'} transition-transform duration-200`}
              >
                {massExporting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    Exporting...
                  </>
                ) : (
                  <>
                    <span>📄</span>
                    Export All {results.length}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Results List */}
          <ResultsList
            results={results}
            files={files}
            collapsedRows={collapsedRows}
            collapsedSections={collapsedSections}
            toggleRowCollapse={toggleRowCollapse}
            toggleSectionCollapse={toggleSectionCollapse}
            isSectionCollapsed={isSectionCollapsed}
            handleFeedback={handleFeedback}
            handleExportCombinedPdf={handleExportCombinedPdf}
            openHtmlInNewWindow={openHtmlInNewWindow}
            setEditTarget={setEditTarget}
            setEditText={setEditText}
            exportingPdf={exportingPdf}
            massExporting={massExporting}
          />
        </section>
      )}
    </>
  );
}
