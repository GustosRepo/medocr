import { useState, useCallback } from 'react';

export default function useSectionCollapse() {
  const [collapsedRows, setCollapsedRows] = useState({});
  const [collapsedSections, setCollapsedSections] = useState({});

  const toggleRowCollapse = useCallback((id) => {
    setCollapsedRows(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const toggleSectionCollapse = useCallback((id, section) => {
    setCollapsedSections(prev => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [section]: !prev[id]?.[section] }
    }));
  }, []);

  const isSectionCollapsed = useCallback((id, section) => {
    const defaults = { image: true, ocr: false, qc: false, flags: false, actions: false, template: false };
    if (collapsedSections[id] && Object.prototype.hasOwnProperty.call(collapsedSections[id], section)) {
      return collapsedSections[id][section];
    }
    return defaults[section] || false;
  }, [collapsedSections]);

  return { collapsedRows, collapsedSections, toggleRowCollapse, toggleSectionCollapse, isSectionCollapsed };
}

