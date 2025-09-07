import React from 'react';
import ResultCard from './ResultCard';

export default function ResultsList({ results, files, collapsedRows, collapsedSections, toggleRowCollapse, toggleSectionCollapse, isSectionCollapsed, handleFeedback, handleExportCombinedPdf, openHtmlInNewWindow, setEditTarget, setEditText, exportingPdf, massExporting }) {
  return (
    <div className="compare-list">
      {results.map((r, idx) => (
        <ResultCard
          key={r.id || idx}
          r={r}
          idx={idx}
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
        />
      ))}
    </div>
  );
}
