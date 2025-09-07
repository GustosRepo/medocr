import React from 'react';

export default function ExportPanel({ resultId, r, onExport, openHtmlInNewWindow }) {
  const canViewTemplate = (r?.client_features && r.client_features.individual_pdf_ready) || r?.individual_pdf_content;
  return (
    <div className="flex-1 min-w-[280px]">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-bold tracking-wide text-gray-700 uppercase">📤 Export</span>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button type="button" onClick={() => onExport(resultId, r)} className="btn-primary btn-small">📄 Export PDF</button>
        {canViewTemplate ? (
          <button type="button" className="btn-outline btn-small" onClick={() => openHtmlInNewWindow(r.individual_pdf_content || r.client_features.individual_pdf_content)}>View Template</button>
        ) : null}
      </div>
    </div>
  );
}

