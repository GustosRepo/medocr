import { useEffect } from 'react';

export default function useHashSync(activeView, setActiveView) {
  // Read initial hash once
  useEffect(() => {
    const applyHash = () => {
      const h = (window.location.hash || '').replace('#', '');
      if (h === 'checklist' || h === 'process') setActiveView(h);
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, [setActiveView]);

  // Keep URL hash synced without creating history entries
  useEffect(() => {
    const desired = `#${activeView}`;
    if (window.location.hash !== desired) window.history.replaceState(null, '', desired);
  }, [activeView]);
}

