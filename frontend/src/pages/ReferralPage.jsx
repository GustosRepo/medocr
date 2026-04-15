import React, { useEffect, useMemo, useState } from 'react';
import { Button, Badge, Group, Stack, Text, Code, Paper, ScrollArea, Title, JsonInput, Tooltip, ActionIcon, Checkbox } from '../ui/primitives.jsx';
import { notifications } from '../ui/primitives.jsx';
import { IconBug, IconUpload, IconPlayerPlay, IconFileArrowRight, IconFileImport, IconArrowsMaximize, IconArrowsMinimize, IconEdit, IconDeviceFloppy, IconX, IconTrash } from '@tabler/icons-react';
import { getStatusBadgeColor } from '../ui/utils.js';
import Section from '../components/Section.jsx';
import PlaceholderPanel from '../components/PlaceholderPanel.jsx';
import OllamaMonitor from '../components/OllamaMonitor.jsx';
import ValidationIssuesDrawer from '../components/ValidationIssuesDrawer.jsx';
// Bug 24 fix: import DualEngineResults (was built but never wired in)
import DualEngineResults from '../components/DualEngineResults.jsx';
import KbAssessmentPanel from '../components/KbAssessmentPanel.jsx';

const apiBase = '/api';

// --- Global client-side polling queue to cap concurrent /status requests ---
const POLL_CONCURRENCY = 3;
let _pollActive = 0;
const _pollQueue = [];
async function queueStatusFetch(fn) {
  return new Promise(resolve => {
    const run = async () => {
      _pollActive++;
      try { resolve(await fn()); }
      finally {
        _pollActive--;
        if (_pollQueue.length) {
          const next = _pollQueue.shift();
          setTimeout(next, 0);
        }
      }
    };
    if (_pollActive < POLL_CONCURRENCY) run(); else _pollQueue.push(run);
  });
}

export default function ReferralPage() {

  const [files, setFiles] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  // Bug 18 fix: ref to avoid stale closure in pollStatus
  const selectedIdRef = React.useRef('');
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  const [status, setStatus] = useState(null);
  const [resultsMap, setResultsMap] = useState({});
  const [processedOrder, setProcessedOrder] = useState([]);
  const [debugTrace, setDebugTrace] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState([]);
  const [batchDates, setBatchDates] = useState([]);
  const [showAllAuthNotes, setShowAllAuthNotes] = useState(false);
  const [showRawMap, setShowRawMap] = useState({});
  // (Reverted) removed fileRefMap & retry feature
  // Multi-export selection state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedExportIds, setSelectedExportIds] = useState(new Set());
  
  // Edit mode state
  const [editingDocId, setEditingDocId] = useState(null);
  const [editedFields, setEditedFields] = useState({});
  const [savingCorrection, setSavingCorrection] = useState(false);
  
  // Validation issues drawer state
  const [showValidationDrawer, setShowValidationDrawer] = useState(false);
  
  
  // Live logs state
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const logsEndRef = React.useRef(null);
  const logsScrollRef = React.useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Restore persisted selection (remember across reload) once on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('exportSelection');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          setSelectedExportIds(new Set(arr));
        }
      }
    } catch {}
  }, []);

  // Persist selection whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('exportSelection', JSON.stringify(Array.from(selectedExportIds)));
    } catch {}
  }, [selectedExportIds]);

  // Restore processed documents from localStorage on mount
  useEffect(() => {
    try {
      const savedResults = localStorage.getItem('processedDocuments');
      const savedOrder = localStorage.getItem('processedOrder');
      if (savedResults && savedOrder) {
        const parsedResults = JSON.parse(savedResults);
        const parsedOrder = JSON.parse(savedOrder);
        setResultsMap(parsedResults);
        setProcessedOrder(parsedOrder);
      }
    } catch (err) {
      console.error('Failed to restore processed documents:', err);
    }
  }, []);

  // Persist processed documents whenever resultsMap changes
  // Bug 19 fix: write both keys atomically to avoid inconsistent snapshots
  useEffect(() => {
    const keys = Object.keys(resultsMap);
    if (keys.length > 0) {
      try {
        const resultsJson = JSON.stringify(resultsMap);
        const orderJson = JSON.stringify(processedOrder);
        // Write both atomically — if one fails, neither is partially written
        localStorage.setItem('processedDocuments', resultsJson);
        localStorage.setItem('processedOrder', orderJson);

      } catch (err) {
        console.error('Failed to save processed documents:', err);
      }
    }
  }, [resultsMap, processedOrder]);

  // Prune any selected IDs that are no longer present (e.g., after refresh before data arrives)
  useEffect(() => {
    setSelectedExportIds(prev => {
      const next = new Set([...prev].filter(id => resultsMap[id]));
      return next.size === prev.size ? prev : next;
    });
  }, [resultsMap]);

  useEffect(() => {
    fetch(`${apiBase}/batch`).then(r => r.ok ? r.json() : Promise.reject())
      .then(j => setBatchDates(Array.isArray(j?.dates) ? j.dates : []))
      .catch(() => setBatchDates([]));
  }, []);
  
  // Auto-scroll logs to bottom only if user is near bottom
  useEffect(() => {
    if (showLogs && autoScroll && logsEndRef.current && logsScrollRef.current) {
      logsScrollRef.current.scrollTop = logsScrollRef.current.scrollHeight;
    }
  }, [logs, showLogs, autoScroll]);
  
  // Detect if user scrolled away from bottom
  const handleLogsScroll = () => {
    const viewport = logsScrollRef.current;
    if (!viewport) return;
    
    const isNearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 100;
    if (isNearBottom !== autoScroll) {
      setAutoScroll(isNearBottom);
    }
  };
  
  // Attach scroll listener
  useEffect(() => {
    if (!showLogs || !logsScrollRef.current) return;
    
    const viewport = logsScrollRef.current;
    
    viewport.addEventListener('scroll', handleLogsScroll);
    return () => viewport.removeEventListener('scroll', handleLogsScroll);
  }, [showLogs, logsScrollRef.current]);
  
  // Real-time log streaming from backend
  useEffect(() => {
    if (!showLogs) return;
    
    let eventSource = null;
    
    try {
      // Use EventSource for real-time log streaming
      eventSource = new EventSource(`${apiBase}/logs/ocr/stream`);
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.log) {
            setLogs(prev => {
              const newLogs = [...prev, data.log];
              // Keep last 100 lines
              return newLogs.slice(-100);
            });
            
            // Auto-scroll to bottom if enabled
            if (autoScroll && logsScrollRef.current) {
              setTimeout(() => {
                if (logsScrollRef.current) {
                  logsScrollRef.current.scrollTop = logsScrollRef.current.scrollHeight;
                }
              }, 50);
            }
          }
        } catch (err) {
          console.error('Failed to parse log event:', err);
        }
      };
      
      eventSource.onerror = (err) => {
        console.error('OCR log stream error:', err);
        eventSource.close();
      };
    } catch (err) {
      console.error('Failed to setup OCR log stream:', err);
    }
    
    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [showLogs, autoScroll]);

  function pushResult(id, data) {
    setResultsMap(m => ({ ...m, [id]: data }));
    setProcessedOrder(o => o.includes(id) ? o : [id, ...o]);
  }

  // Sync documents from the backend (picks up batch-uploaded / externally-processed docs)


  // IDs that are fully processed (exclude placeholders/uploading)
  const doneIds = useMemo(
    () => processedOrder.filter(id => {
      const r = resultsMap[id];
      return r && !r._placeholder && !r._uploading;
    }),
    [processedOrder, resultsMap]
  );

  function toggleSelect(id) {
    setSelectedExportIds(s => {
      const ns = new Set(s);
      if (ns.has(id)) ns.delete(id); else ns.add(id);
      return ns;
    });
  }
  function clearSelection() { setSelectedExportIds(new Set()); }
  function selectAll() { setSelectedExportIds(new Set(doneIds)); }

  async function exportZip(ids) {
    if (!ids.length) return;
    try {
      const res = await fetch(`${apiBase}/documents/bulk-export.zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      if (!res.ok) throw new Error('bulk-failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Referral_Packets_${new Date().toISOString().slice(0,10)}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 1500);
      notifications.show({ title: 'Export ready', message: `${ids.length} packets zipped`, color: 'blue', autoClose: 1400 });
    } catch {
      notifications.show({ title: 'Export failed', message: 'Could not build packet ZIP', color: 'red' });
    }
  }

  async function exportIndividual(ids) {
    if (!ids.length) return;
    // If attempting many separate downloads, suggest using ZIP instead
    if (ids.length > 30) {
      const proceed = window.confirm(`This will trigger ${ids.length} separate downloads. For large batches, use Export ZIP for better reliability. Continue with individual PDFs?`);
      if (!proceed) return;
    }
    for (const id of ids) {
      const a = document.createElement('a');
      // Download the full packet (includes Patient Report and documents)
      a.href = `/api/documents/${id}/packet.pdf`;
  const doc = resultsMap[id];
  const base = doc?.documentMeta?.suggestedFilename?.replace(/\.pdf$/i, '') || id;
  a.download = `${base}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      // small throttle so browser queues sanely
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, 200));
    }
    notifications.show({ title: 'Downloads started', message: `${ids.length} PDFs`, color: 'blue', autoClose: 1400 });
  }

  async function purgeSelected() {
    if (!selectedExportIds || !selectedExportIds.size) return;
    const ok = window.confirm(`Purge ${selectedExportIds.size} selected processed records? This will remove them from the persisted processed list.`);
    if (!ok) return;
    try {
      const res = await fetch(`${apiBase}/documents/processed/purge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedExportIds) })
      });
      const js = await res.json();
      if (!res.ok) throw new Error(js?.error?.message || 'purge_failed');
      notifications.show({ 
        title: 'Purge complete', 
        message: `Removed ${js.removed} records, deleted ${js.filesDeleted} files, ${js.resultsDeleted} results. Reloading...`, 
        color: 'green',
        autoClose: 3000
      });
      // Remove only the selected IDs from local state
      const purgedIds = Array.from(selectedExportIds);
      setProcessedOrder(prev => prev.filter(id => !purgedIds.includes(id)));
      setResultsMap(prev => {
        const updated = { ...prev };
        purgedIds.forEach(id => delete updated[id]);
        return updated;
      });
      setSelectedExportIds(new Set());
      
      // Bug 20 fix: no reload needed — React state + useEffect persistence handles it
      // The useEffect on [resultsMap, processedOrder] will persist to localStorage automatically
      // Removed: setTimeout(() => window.location.reload(), 1000);
    } catch (e) {
      notifications.show({ title: 'Purge failed', message: String(e.message || e), color: 'red' });
    }
  }

  async function purgeAllProcessed() {
    const ok = window.confirm('Purge ALL persisted processed records? This will remove the persisted list. Continue?');
    if (!ok) return;
    try {
      const res = await fetch(`${apiBase}/documents/processed/purge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ olderThan: new Date().toISOString() })
      });
      const js = await res.json();
      if (!res.ok) throw new Error(js?.error?.message || 'purge_failed');
      notifications.show({ 
        title: 'Purge ALL complete', 
        message: `Removed ${js.removed} records, deleted ${js.filesDeleted} files, ${js.resultsDeleted} results. Reloading...`, 
        color: 'green',
        autoClose: 3000
      });
      // Clear local state AND localStorage immediately before reload
      setSelectedExportIds(new Set());
      setProcessedOrder([]);
      setResultsMap({});
      localStorage.removeItem('processedDocuments');
      localStorage.removeItem('processedOrder');
      localStorage.removeItem('exportSelection');
      setTimeout(() => window.location.reload(), 1000);
    } catch (e) {
      notifications.show({ title: 'Purge failed', message: String(e.message || e), color: 'red' });
    }
  }

  const selectedDoc = selectedId ? resultsMap[selectedId] : null;
  const confidenceBadge = useMemo(() => {
    if (!selectedDoc?.confidence) return null;
    const level = selectedDoc.confidence;
    const color = level === 'High' ? 'green' : level === 'Medium' ? 'yellow' : 'red';
    return <Badge color={color}>Confidence: {level}</Badge>;
  }, [selectedDoc]);

  const dualEngineBadge = useMemo(() => {
    if (!selectedDoc?.dualEngine) return null;
    return (
      <Tooltip label={`OCR + LLM processing (${selectedDoc.dualEngine.llm?.pagesProcessed || 0} pages)`}>
        <Badge color="purple" variant="light">Dual-Engine</Badge>
      </Tooltip>
    );
  }, [selectedDoc]);

  const validationIssuesBadge = useMemo(() => {
    const conflicts = selectedDoc?.dualEngine?.conflicts;
    if (!conflicts || conflicts.length === 0) return null;
    const issueCount = conflicts.length;
    // Bug 17 fix: handle both string and object conflict formats
    const criticalCount = selectedDoc.dualEngine.conflicts.filter(c => {
      const text = typeof c === 'string' ? c : (c.field || '');
      return text.toLowerCase().includes('patient name') || 
        text.toLowerCase().includes('dob') || 
        text.toLowerCase().includes('insurance');
    }).length;
    
    return (
      <Tooltip label={`${issueCount} validation issues found (${criticalCount} critical) - Click to review`}>
        <Badge 
          color={criticalCount > 0 ? "red" : "orange"} 
          variant="light" 
          style={{ cursor: 'pointer' }}
          onClick={() => {
            setShowValidationDrawer(true);
          }}
        >
          ⚠️ {issueCount} Issues
        </Badge>
      </Tooltip>
    );
  }, [selectedDoc]);

  const verificationBadge = useMemo(() => {
    const vStatus = selectedDoc?._verification?.status;
    if (!vStatus) return null;
    const cfg = {
      confirmed: { color: 'green', label: 'Verified', tip: 'All fields confirmed via string-match' },
      vlm_confirmed: { color: 'teal', label: 'VLM Verified', tip: 'Fields confirmed by vision model cross-check' },
      auto_corrected: { color: 'orange', label: 'Auto-Corrected', tip: 'Vision model detected and fixed field errors (e.g. phone swap)' },
      flagged: { color: 'red', label: 'Flagged', tip: 'Potential issues detected — manual review recommended' },
      unverified: { color: 'gray', label: 'Unverified', tip: 'Verification was not performed' },
    };
    const c = cfg[vStatus] || { color: 'gray', label: vStatus, tip: '' };
    const corrections = selectedDoc._verification?.corrections || [];
    const tip = corrections.length
      ? `${c.tip}\n${corrections.map(cr => `${cr.field}: ${cr.old} → ${cr.new}`).join('\n')}`
      : c.tip;
    return (
      <Tooltip label={tip} multiline w={320}>
        <Badge color={c.color} variant="light">{c.label}</Badge>
      </Tooltip>
    );
  }, [selectedDoc]);

  const routingBadge = useMemo(() => {
    if (!selectedDoc?.routing?.route) return null;
    const action = selectedDoc.routing.route.action;
    const color = 
      action === 'READY_TO_SCHEDULE' ? 'green' :
      action === 'MANUAL_REVIEW' ? 'red' :
      action === 'INSURANCE_VERIFICATION' ? 'yellow' :
      (action === 'PRIOR_AUTH' || action === 'AUTHORIZATION_REQUEST') ? 'orange' :
      'blue';
    return (
      <Tooltip label={selectedDoc.routing.route.description || ''}>
        <Badge color={color} variant="light">
          {selectedDoc.routing.route.label || action}
        </Badge>
      </Tooltip>
    );
  }, [selectedDoc]);

  async function uploadSingle(fileObj, updateList = true) {
    // Create an immediate placeholder BEFORE the network round trip so user sees it instantly
  const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    pushResult(tempId, {
      documentMeta: { suggestedFilename: fileObj.name },
      patient: {},
      procedure: {},
      _placeholder: true,
      _uploading: true
    });
    if (!selectedId) setSelectedId(tempId);

    const fd = new FormData();
    fd.append('file', fileObj, fileObj.name || 'upload.pdf');
    try {
      const res = await fetch(`${apiBase}/documents`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();

      // Replace temp placeholder id with real id (preserve ordering)
      setResultsMap(m => {
        const ph = m[tempId] || {};
        const newMap = { ...m, [data.id]: { ...ph, _uploading: false } };
        delete newMap[tempId];
        return newMap;
      });
  setProcessedOrder(o => o.map(i => (i === tempId ? data.id : i)));
  setSelectedId(s => (s === tempId ? data.id : s));

      if (updateList) {
        setBatchProgress(p => p.map(it =>
          it.name === fileObj.name ? { ...it, id: data.id, status: 'submitted', error: undefined } : it
        ));
      }

      pollStatus(
        data.id,
        st => {
          if (!updateList) return;
          if (typeof st === 'object') {
            setBatchProgress(p => p.map(it => it.id === data.id ? { ...it, status: st.status, errorCode: st.errorCode, suggestions: st.suggestions, error: st.error } : it));
          } else {
            setBatchProgress(p => p.map(it => it.id === data.id ? { ...it, status: st } : it));
          }
        },
        (err) => {
          if (updateList) {
            setBatchProgress(p => p.map(it => it.id === data.id ? { ...it, status: 'error', error: err } : it));
          }
        }
      );
      return data.id;
    } catch (e) {
      // Remove placeholder on failure
      setResultsMap(m => { const nm = { ...m }; delete nm[tempId]; return nm; });
      setProcessedOrder(o => o.filter(i => i !== tempId));
      if (updateList) {
        setBatchProgress(p => p.map(it =>
          it.name === fileObj.name ? { ...it, status: 'error', error: e.message || 'upload-error' } : it
        ));
      }
      return null;
    }
  }

  async function upload() {
    if (!files.length) return;
  setError('');
  setLoading(true);
  const first = files[0];
  // Ensure the single file shows up in the left status list immediately
  setBatchProgress([{ name: first.name, status: 'uploading' }]);
  await uploadSingle(first, true);
  setLoading(false);
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function uploadAll() {
    if (!files.length) return;
    setBatchProgress(files.map(f => ({ name: f.name, status: 'queued' })));
    setError('');
    setLoading(true);
    for (const f of files) {
      setBatchProgress(p => p.map(it => it.name === f.name ? { ...it, status: 'uploading' } : it));
      await uploadSingle(f, true);
      await sleep(200);
    }
    setLoading(false);
  }

  async function pollStatus(id, onUpdate, onError) {
    let tries = 0;
    // Increased to 1500 tries to support long-running documents (1500 × 2.6s ≈ 65 minutes per document)
    const maxTries = 1500;
    setStatus('processing');
    let delay = 2600 + Math.random() * 400;
    let consecutive429 = 0;

    while (tries < maxTries) {
      try {
        const r = await queueStatusFetch(() => fetch(`${apiBase}/documents/${id}/status`));
        if (r.status === 429) {
          consecutive429++;
          const penalty = Math.min((consecutive429 + 1) * 1800, 15000);
          delay = Math.min(delay * 1.6 + penalty, 25000);
          onUpdate?.('rate-limit');
          await sleep(delay);
          continue;
        }
        if (!r.ok) throw new Error(`status-${r.status}`);
        
        const js = await r.json();
        consecutive429 = 0;
        const st = js.status || 'processing';
        // If error, propagate structured code/suggestions
        if (st === 'error' && js.errorCode) {
          onUpdate?.({ status: st, errorCode: js.errorCode, suggestions: js.suggestions, error: js.error });
        } else {
          onUpdate?.(st);
        }

        if (st === 'done') {
          try {
            const rr = await fetch(`${apiBase}/documents/${id}/result`);
            if (rr.ok) {
              const data = await rr.json();
              pushResult(id, data);
              // Bug 18 fix: use ref to avoid stale closure
              if (!selectedIdRef.current) setSelectedId(id);
              notifications.show({
                title: 'Extraction complete',
                message: `Document ${id} processed`,
                color: 'green',
                autoClose: 1500
              });
            }
          } catch {}
          return 'done';
        } else if (st === 'error') {
          // Surface specific backend error (e.g., OCR timeout) to UI + console. js may carry errorCode
          const reason = js.error || 'pipeline-error';
          console.error('[pollStatus] document failed', id, reason, js.errorCode);
          setResultsMap(prev => {
            const current = prev[id] || {};
            const next = {
              ...current,
              status: 'error',
              error: reason,
              errorCode: js.errorCode || null,
              _placeholder: false,
              _uploading: false
            };
            const copy = { ...prev, [id]: next };
            return copy;
          });
          if (js.errorCode) {
            notifications.show({
              title: `Processing failed (${js.errorCode})`,
              message: reason,
              color: 'red',
              autoClose: 4000
            });
          }
          onError?.(reason, js.errorCode, js.suggestions);
          return 'error';
        }
        delay = Math.min(delay * 1.18 + 320, 12000);
        await sleep(delay);
      } catch (e) {
        onUpdate?.('net-error');
        delay = Math.min(delay * 1.4 + 500, 15000);
        tries++;
        await sleep(delay);
      }
      tries++;
    }
    onError?.('timeout');
    return 'timeout';
  }

  async function fetchDebug(id) {
    if (!id) return;
    try {
      const r = await fetch(`${apiBase}/documents/${id}/result?debug=1`);
      if (!r.ok) throw new Error();
      const js = await r.json();
      setResultsMap(m => ({ ...m, [id]: { ...(m[id] || {}), ...js } }));
      setDebugTrace(js?.debug?.trace || []);
    } catch {
      notifications.show({
        title: 'Debug failed',
        message: 'Trace not available',
        color: 'red'
      });
    }
  }

  function clearAll() {
    if (!confirm('Clear all processed documents? This will remove all results from memory.')) {
      return;
    }
    
    // Clear all state
    setResultsMap({});
    setProcessedOrder([]);
    setSelectedId('');
    setFiles([]);
    setStatus(null);
    setError('');
    setBatchProgress([]);
    setSelectedExportIds(new Set());
    
    // Clear localStorage
    localStorage.removeItem('processedDocuments');
    localStorage.removeItem('processedOrder');
    localStorage.removeItem('exportSelection');
    
    notifications.show({
      title: 'Cleared',
      message: 'All processed documents removed',
      color: 'blue'
    });
  }

  async function loadSample() {
    setError('');
    setLoading(true);
    try {
      const r = await fetch(`${apiBase}/fixtures/titration_auto_approve`);
      if (!r.ok) throw new Error();
      const js = await r.json();
      pushResult('sample', js);
      setSelectedId('sample');
      setStatus('done');
      notifications.show({
        title: 'Sample loaded',
        message: 'Sample referral loaded',
        color: 'blue',
        autoClose: 1500
      });
    } catch {
      setError('Sample failed');
      notifications.show({
        title: 'Sample failed',
        message: 'Could not load sample',
        color: 'red'
      });
    } finally {
      setLoading(false);
    }
  }

  function downloadJson(doc, id) {
    if (!doc) return;
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const suggested = doc?.documentMeta?.suggestedFilename?.replace(/\.pdf$/i, '') || id || 'referral';
    a.href = url;
    a.download = `${suggested}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  // Start editing a document
  function startEdit(docId, doc) {
    if (!doc) return;
    setEditingDocId(docId);
    
    // Initialize all editable fields
    setEditedFields({
      // Patient (PHI - won't be saved)
      patientLast: doc.patient?.last || '',
      patientFirst: doc.patient?.first || '',
      patientDob: doc.patient?.dob || '',
      patientPhone: doc.patient?.phones?.[0] || '',
      // Bug 11 fix: include email in editable fields
      patientEmail: doc.patient?.email || '',
      
      // Insurance (Carrier learned, Member ID is PHI)
      insuranceCarrier: doc.insurance?.[0]?.carrier || '',
      insuranceMemberId: doc.insurance?.[0]?.memberId || '',
      // Bug 12 fix: include groupId in editable fields
      insuranceGroupId: doc.insurance?.[0]?.groupId || '',
      
      // Procedure (Non-PHI - safe to learn)
      procedureCpt: doc.procedure?.cpt || '',
      procedureDescription: doc.procedure?.description || '',
      
      // Clinical (ICD codes - safe to learn)
      diagnosisCode: doc.clinical?.primaryDiagnosis?.code || '',
      diagnosisDescription: doc.clinical?.primaryDiagnosis?.description || '',
      
      // Provider (Public info - safe to learn)
      providerName: doc.provider?.name || '',
      providerNpi: doc.provider?.npi || '',
      providerPhone: doc.provider?.phone || '',
      providerFax: doc.provider?.fax || ''
    });
  }

  function cancelEdit() {
    setEditingDocId(null);
    setEditedFields({});
  }

  // HIPAA-compliant save: only save non-PHI corrections
  async function saveCorrections(docId, doc) {
    if (!doc) return;
    setSavingCorrection(true);

    const corrections = [];
    const original = {
      patientLast: doc.patient?.last || '',
      patientFirst: doc.patient?.first || '',
      patientDob: doc.patient?.dob || '',
      insuranceCarrier: doc.insurance?.[0]?.carrier || '',
      insuranceMemberId: doc.insurance?.[0]?.memberId || '',
      procedureCpt: doc.procedure?.cpt || '',
      procedureDescription: doc.procedure?.description || '',
      diagnosisCode: doc.clinical?.primaryDiagnosis?.code || '',
      diagnosisDescription: doc.clinical?.primaryDiagnosis?.description || '',
      providerName: doc.provider?.name || '',
      providerNpi: doc.provider?.npi || '',
      providerPhone: doc.provider?.phone || '',
      providerFax: doc.provider?.fax || ''
    };

    // HIPAA: Provider corrections (public business info - safe to learn)
    if (editedFields.providerName !== original.providerName) {
      corrections.push({
        type: 'provider',
        ocrText: original.providerName,
        correctedText: editedFields.providerName
      });
    }
    
    if (editedFields.providerNpi !== original.providerNpi) {
      corrections.push({
        type: 'npi',
        ocrText: original.providerNpi,
        correctedText: editedFields.providerNpi
      });
    }
    
    if (editedFields.providerPhone !== original.providerPhone) {
      corrections.push({
        type: 'phone',
        ocrText: original.providerPhone,
        correctedText: editedFields.providerPhone
      });
    }
    
    if (editedFields.providerFax !== original.providerFax) {
      corrections.push({
        type: 'fax',
        ocrText: original.providerFax,
        correctedText: editedFields.providerFax
      });
    }

    // HIPAA: Insurance carrier (safe to learn, but NOT Member ID)
    if (editedFields.insuranceCarrier !== original.insuranceCarrier) {
      corrections.push({
        type: 'carrier',
        ocrText: original.insuranceCarrier,
        correctedText: editedFields.insuranceCarrier
      });
    }

    // HIPAA: Procedure codes & descriptions (non-PHI - safe to learn)
    if (editedFields.procedureCpt !== original.procedureCpt) {
      corrections.push({
        type: 'cpt',
        ocrText: original.procedureCpt,
        correctedText: editedFields.procedureCpt
      });
    }
    
    if (editedFields.procedureDescription !== original.procedureDescription) {
      corrections.push({
        type: 'procedureDescription',
        ocrText: original.procedureDescription,
        correctedText: editedFields.procedureDescription
      });
    }

    // HIPAA: Diagnosis codes & descriptions (non-PHI - safe to learn)
    if (editedFields.diagnosisCode !== original.diagnosisCode) {
      corrections.push({
        type: 'icd',
        ocrText: original.diagnosisCode,
        correctedText: editedFields.diagnosisCode
      });
    }
    
    if (editedFields.diagnosisDescription !== original.diagnosisDescription) {
      corrections.push({
        type: 'diagnosisDescription',
        ocrText: original.diagnosisDescription,
        correctedText: editedFields.diagnosisDescription
      });
    }

    // Local mode: send patient fields too (server gates storage via LEARN_ALL env var)
    if (editedFields.patientLast !== original.patientLast || editedFields.patientFirst !== original.patientFirst) {
      corrections.push({
        type: 'patientName',
        ocrText: `${original.patientLast}, ${original.patientFirst}`,
        correctedText: `${editedFields.patientLast}, ${editedFields.patientFirst}`
      });
    }
    if (editedFields.patientDob !== original.patientDob) {
      corrections.push({
        type: 'dob',
        ocrText: original.patientDob,
        correctedText: editedFields.patientDob
      });
    }
    if (editedFields.patientPhone !== original.patientPhone) {
      corrections.push({
        type: 'patientPhone',
        ocrText: original.patientPhone,
        correctedText: editedFields.patientPhone
      });
    }
    if (editedFields.insuranceMemberId !== original.insuranceMemberId) {
      corrections.push({
        type: 'memberId',
        ocrText: original.insuranceMemberId,
        correctedText: editedFields.insuranceMemberId
      });
    }
    if (editedFields.insuranceGroupId !== original.insuranceGroupId) {
      corrections.push({
        type: 'groupId',
        ocrText: original.insuranceGroupId,
        correctedText: editedFields.insuranceGroupId
      });
    }

    if (corrections.length === 0) {
      notifications.show({
        title: 'No Changes',
        message: 'No corrections to save.',
        color: 'blue',
        autoClose: 2000
      });
      setSavingCorrection(false);
      cancelEdit();
      return;
    }

    try {
      const response = await fetch('/api/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corrections })
      });

      if (!response.ok) throw new Error('save-failed');

      const result = await response.json();

      // Also send feedback records for analytics tracking
      for (const c of corrections) {
        fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            docId,
            path: c.type,
            previousValue: c.ocrText,
            newValue: c.correctedText,
            accepted: true
          })
        }).catch(() => {}); // fire-and-forget, non-blocking
      }
      
      notifications.show({
        title: 'Corrections Saved',
        message: `${corrections.length} corrections recorded for future learning.`,
        color: 'green',
        autoClose: 3000
      });

      // Update the local document with edited values (for immediate UI feedback)
      setResultsMap(prev => ({
        ...prev,
        [docId]: {
          ...prev[docId],
          patient: {
            ...prev[docId].patient,
            last: editedFields.patientLast,
            first: editedFields.patientFirst,
            dob: editedFields.patientDob,
            // Bug 10 fix: preserve all phones, only update first entry
            phones: [
              editedFields.patientPhone,
              ...(prev[docId].patient?.phones?.slice(1) || [])
            ],
            // Bug 11 fix: include email
            email: editedFields.patientEmail || prev[docId].patient?.email
          },
          // Bug 9 fix: preserve all insurance entries, only update first
          insurance: [
            {
              ...prev[docId].insurance?.[0],
              carrier: editedFields.insuranceCarrier,
              memberId: editedFields.insuranceMemberId,
              // Bug 12 fix: include groupId
              groupId: editedFields.insuranceGroupId || prev[docId].insurance?.[0]?.groupId
            },
            ...(prev[docId].insurance?.slice(1) || [])
          ],
          procedure: {
            ...prev[docId].procedure,
            cpt: editedFields.procedureCpt,
            description: editedFields.procedureDescription
          },
          clinical: {
            ...prev[docId].clinical,
            primaryDiagnosis: {
              code: editedFields.diagnosisCode,
              description: editedFields.diagnosisDescription
            }
          },
          // Bug 13 fix: sync top-level diagnoses array with edited primary diagnosis
          diagnoses: [
            { code: editedFields.diagnosisCode, description: editedFields.diagnosisDescription },
            ...(prev[docId].diagnoses?.slice(1) || [])
          ],
          provider: {
            ...prev[docId].provider,
            name: editedFields.providerName,
            npi: editedFields.providerNpi,
            phone: editedFields.providerPhone,
            fax: editedFields.providerFax
          }
        }
      }));

      cancelEdit();
    } catch (err) {
      console.error('Failed to save corrections:', err);
      notifications.show({
        title: 'Save Failed',
        message: 'Could not save corrections. Please try again.',
        color: 'red',
        autoClose: 4000
      });
    } finally {
      setSavingCorrection(false);
    }
  }

  // Handler for field updates from ValidationIssuesDrawer
  async function handleUpdateField(fieldPath, newValue) {
    if (!selectedId) return;

    // Optimistic local update for snappy UI
    setResultsMap(prev => {
      const doc = prev[selectedId];
      if (!doc) return prev;
      const updated = structuredClone ? structuredClone(doc) : JSON.parse(JSON.stringify(doc));
      const setLocal = (obj, path, val) => {
        const tokens = [];
        path.split('.').forEach(part => {
          const re = /(\w+)(\[(\d+)\])?/g;
          let m;
          while ((m = re.exec(part)) !== null) {
            tokens.push(m[1]);
            if (m[3] !== undefined) tokens.push(Number(m[3]));
          }
        });
        let cur = obj;
        for (let i = 0; i < tokens.length - 1; i++) {
          const key = tokens[i];
          if (key === 'insurance' && Array.isArray(cur[key])) {
            const next = tokens[i + 1];
            if (typeof next !== 'number') {
              cur[key][0] = cur[key][0] || {};
              cur = cur[key][0];
              continue;
            }
          }
          if (typeof tokens[i + 1] === 'number') {
            if (!Array.isArray(cur[key])) cur[key] = [];
            const idx = tokens[i + 1];
            cur[key][idx] = cur[key][idx] || {};
            cur = cur[key][idx];
            i++;
          } else {
            cur[key] = cur[key] && typeof cur[key] === 'object' ? cur[key] : {};
            cur = cur[key];
          }
        }
        const last = tokens[tokens.length - 1];
        cur[last] = val;
      };
      setLocal(updated, fieldPath, newValue);
      return { ...prev, [selectedId]: updated };
    });

    try {
      const res = await fetch(`${apiBase}/documents/${selectedId}/update-field`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: fieldPath, value: newValue })
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(js?.error?.message || 'update_failed');

      // Sync with authoritative server copy
      if (js?.result) {
        setResultsMap(prev => ({ ...prev, [selectedId]: { ...prev[selectedId], ...js.result } }));
      }

      notifications.show({
        title: 'Field Updated',
        message: `${fieldPath} has been corrected to: ${newValue}`,
        color: 'green',
        autoClose: 2500
      });
    } catch (err) {
      console.error('Persist edit failed', err);
      notifications.show({
        title: 'Save Failed',
        message: 'Could not persist change. It will remain local for now.',
        color: 'red',
        autoClose: 3500
      });
    }
  }

  function Details({ docId, doc }) {
    if (!doc) return null;
    const showRaw = !!showRawMap[docId];
    // Bug 21 fix: prefer computed confidenceLevel over raw string
    const conf = doc?.confidenceLevel || doc?.confidence;
    const isEditing = editingDocId === docId;

    return (
  <Stack gap={16} style={{ borderTop: '1px solid #2a323c', paddingTop: 10 }}>
        {/* Edit Mode Controls */}
        {!isEditing && (
          <Group justify="flex-end">
            <Button
              size="xs"
              variant="light"
              leftSection={<IconEdit size={14} />}
              onClick={() => startEdit(docId, doc)}
            >
              Edit & Save Corrections
            </Button>
          </Group>
        )}

        {/* Regex fallback warning — shown when AI timed out and regex engine was used */}
        {doc.extractionMethod === 'regex_fallback' && doc._vlmFallback?.reason === 'vlm_crashed_regex_used' && (
          <Paper p="sm" withBorder style={{ background: 'rgba(234, 179, 8, 0.08)', borderColor: '#eab308' }}>
            <Group justify="space-between" align="center">
              <Group gap="xs" align="center">
                <Text size="lg">⚠️</Text>
                <Stack gap={2}>
                  <Text size="xs" fw={600} c="yellow.4">AI extraction timed out — results from pattern matching only</Text>
                  <Text size="xs" c="dimmed">This document was too large for the AI model. Data may be incomplete. Reprocess to retry with AI.</Text>
                </Stack>
              </Group>
              <Button
                size="xs"
                variant="light"
                color="yellow"
                onClick={async () => {
                  try {
                    const res = await fetch(`${apiBase}/documents/${docId}/reprocess`, { method: 'POST' });
                    if (!res.ok) throw new Error('reprocess-failed');
                    // Mark the card as re-processing so the spinner shows
                    setResultsMap(m => ({ ...m, [docId]: { ...m[docId], extractionMethod: null, _reprocessing: true } }));
                    notifications.show({ message: 'Reprocessing — results will update when complete', color: 'blue', autoClose: 3000 });
                    // Resume polling so the card updates automatically when done
                    pollStatus(docId, () => {}, () => {});
                  } catch {
                    notifications.show({ message: 'Failed to start reprocess', color: 'red' });
                  }
                }}
              >
                Reprocess
              </Button>
            </Group>
          </Paper>
        )}
        
        {isEditing && (
          <Paper p="md" withBorder style={{ background: 'rgba(59, 130, 246, 0.05)', borderColor: '#3b82f6' }}>
            <Stack gap="sm">
              <Group justify="space-between">
                <Group gap="xs">
                  <Text size="sm" fw={600}>Editing Mode</Text>
                  <Badge size="sm" color="blue">HIPAA-Compliant</Badge>
                </Group>
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant="default"
                    leftSection={<IconX size={14} />}
                    onClick={cancelEdit}
                    disabled={savingCorrection}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="xs"
                    variant="filled"
                    leftSection={<IconDeviceFloppy size={14} />}
                    onClick={() => saveCorrections(docId, doc)}
                    loading={savingCorrection}
                  >
                    Save Corrections
                  </Button>
                </Group>
              </Group>
              <Text size="xs" c="dimmed">
                Edit any field — all corrections are saved locally to improve future OCR accuracy.
              </Text>
            </Stack>
          </Paper>
        )}

        <Section title="Patient">
          {!isEditing ? (
            <Stack gap={4}>
              <Text size="sm">
                {doc.patient?.last}, {doc.patient?.first} • DOB {doc.patient?.dob || '—'}
                {doc.documentMeta?.intakeDate && (
                  <Text component="span" size="xs" c="dimmed">
                    {' '}&nbsp;| Referral Date: {doc.documentMeta.intakeDate}
                  </Text>
                )}
              </Text>
              {Array.isArray(doc.patient?.phones) && doc.patient.phones.length > 0 && (
                <Text size="xs" c="dimmed">
                  Phone: {doc.patient.phones[0]}
                  {doc.patient.phones[1] && ` / ${doc.patient.phones[1]}`}
                </Text>
              )}
              {doc.patient?.email && <Text size="xs">Email: {doc.patient.email}</Text>}
              {doc.patient?.emergencyContact?.raw && (
                <Text size="xs">
                  Emergency Contact: {doc.patient.emergencyContact.raw}
                  {doc.patient.emergencyContact.relationship && ` (${doc.patient.emergencyContact.relationship})`}
                  {doc.patient.emergencyContact.phone && ` / ${doc.patient.emergencyContact.phone}`}
                </Text>
              )}
            </Stack>
          ) : (
            <Stack gap="xs">
              <Group gap="xs" align="center">
                <Text size="xs" fw={500}>Patient Info</Text>
                <Badge size="xs" color="green" variant="light">✓ Learned</Badge>
              </Group>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Text size="xs" fw={500} c="dimmed" mb={4}>Last Name</Text>
                  <input
                    type="text"
                    value={editedFields.patientLast}
                    onChange={e => setEditedFields(f => ({ ...f, patientLast: e.target.value }))}
                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <Text size="xs" fw={500} c="dimmed" mb={4}>First Name</Text>
                  <input
                    type="text"
                    value={editedFields.patientFirst}
                    onChange={e => setEditedFields(f => ({ ...f, patientFirst: e.target.value }))}
                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Text size="xs" fw={500} c="dimmed" mb={4}>Date of Birth</Text>
                  <input
                    type="text"
                    value={editedFields.patientDob}
                    onChange={e => setEditedFields(f => ({ ...f, patientDob: e.target.value }))}
                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <Text size="xs" fw={500} c="dimmed" mb={4}>Phone</Text>
                  <input
                    type="text"
                    value={editedFields.patientPhone}
                    onChange={e => setEditedFields(f => ({ ...f, patientPhone: e.target.value }))}
                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>
              {/* Bug 11 fix: email edit field */}
              <div>
                <Text size="xs" fw={500} c="dimmed" mb={4}>Email</Text>
                <input
                  type="email"
                  value={editedFields.patientEmail}
                  onChange={e => setEditedFields(f => ({ ...f, patientEmail: e.target.value }))}
                  className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </Stack>
          )}
        </Section>

        <Section title="Procedure">
          {!isEditing ? (
            <>
              <Text size="sm">
                CPT: {doc.procedure?.cpt} {doc.procedure?.description && `— ${doc.procedure.description}`}
              </Text>
              {/* Bug 8 fix: display procedure notes */}
              {Array.isArray(doc.procedure?.notes) && doc.procedure.notes.length > 0 && (
                <Text size="xs" c="dimmed" mt={2}>
                  Notes: {doc.procedure.notes.join('; ')}
                </Text>
              )}
              {Array.isArray(doc.procedure?.cptDetails) && doc.procedure.cptDetails.length > 1 && (
                <Stack gap="xs" mt="sm">
                  {doc.procedure.cptDetails.map(d => (
                    <Group key={d.code} gap="sm" align="flex-start">
                      <Code size="xs">{d.code}</Code>
                      <Text size="xs">
                        {d.intent}
                        {d.why && d.why !== 'pattern_match' ? ` / ${d.why}` : ''}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </>
          ) : (
            <Stack gap="xs">
              <Group gap="xs" align="center">
                <Text size="xs" fw={500}>Procedure Codes</Text>
                <Badge size="xs" color="green" variant="light">✓ Learned</Badge>
              </Group>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Text size="xs" fw={500} c="dimmed" mb={4}>CPT Code</Text>
                  <input
                    type="text"
                    value={editedFields.procedureCpt}
                    onChange={e => setEditedFields(f => ({ ...f, procedureCpt: e.target.value }))}
                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <Text size="xs" fw={500} c="dimmed" mb={4}>Description</Text>
                  <input
                    type="text"
                    value={editedFields.procedureDescription}
                    onChange={e => setEditedFields(f => ({ ...f, procedureDescription: e.target.value }))}
                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>
            </Stack>
          )}
        </Section>

        <Section title="Insurance">
          {!isEditing ? (
            Array.isArray(doc.insurance) && doc.insurance.length > 0 ? (
              <Stack gap="xs">
                {doc.insurance.map((c, i) => (
                  <div key={i}>
                    <Text size="sm">
                      {i === 0 ? '🏥 ' : '📋 '}
                      {c.carrier}
                      {c.memberId && ` • ID: ${c.memberId}`}
                      {c.groupId && ` • Group: ${c.groupId}`}
                      {/* Bug 7 fix: display insurance status */}
                      {c.status && (
                        <Badge size="xs" ml="xs" color={c.status === 'accepted' ? 'green' : 'yellow'} variant="light">
                          {c.status}
                        </Badge>
                      )}
                    </Text>
                    {i === 0 && doc.insurance.length > 1 && (
                      <Text size="xs" c="dimmed" ml="md">Primary</Text>
                    )}
                    {i === 1 && <Text size="xs" c="dimmed" ml="md">Secondary</Text>}
                  </div>
                ))}
              </Stack>
            ) : (
              <Text size="sm">—</Text>
            )
          ) : (
            <Stack gap="xs">
              <Group gap="xs" align="center">
                <Text size="xs" fw={500}>Insurance</Text>
                <Badge size="xs" color="green" variant="light">✓ Learned</Badge>
              </Group>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Text size="xs" fw={500} c="dimmed" mb={4}>Carrier</Text>
                  <input
                    type="text"
                    value={editedFields.insuranceCarrier}
                    onChange={e => setEditedFields(f => ({ ...f, insuranceCarrier: e.target.value }))}
                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <Text size="xs" fw={500} c="dimmed" mb={4}>Member ID</Text>
                  <input
                    type="text"
                    value={editedFields.insuranceMemberId}
                    onChange={e => setEditedFields(f => ({ ...f, insuranceMemberId: e.target.value }))}
                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>
              {/* Bug 12 fix: groupId edit field */}
              <div>
                <Text size="xs" fw={500} c="dimmed" mb={4}>Group ID</Text>
                <input
                  type="text"
                  value={editedFields.insuranceGroupId}
                  onChange={e => setEditedFields(f => ({ ...f, insuranceGroupId: e.target.value }))}
                  className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </Stack>
          )}
        </Section>

        <Section title="Clinical Information">
          {!isEditing ? (
            <Stack gap={4}>
              {doc.clinical?.primaryDiagnosis && (
                <Text size="sm">
                  Primary Dx: {doc.clinical.primaryDiagnosis.code}
                  {doc.clinical.primaryDiagnosis.description && ` — ${doc.clinical.primaryDiagnosis.description}`}
                </Text>
              )}
              {/* Bug 1 fix: display full diagnoses array */}
              {Array.isArray(doc.diagnoses) && doc.diagnoses.length > 0 && (
                <div>
                  <Text size="xs" fw={600} c="dimmed" mb={4}>All Diagnoses:</Text>
                  <Stack gap={2}>
                    {doc.diagnoses.map((dx, idx) => {
                      const code = typeof dx === 'string' ? dx : dx?.code;
                      const desc = typeof dx === 'object' ? dx?.description : '';
                      const ocrFlag = typeof dx === 'object' && dx?.ocrFlag;
                      return (
                        <Text key={idx} size="xs" c="dimmed">
                          • {code}{desc ? ` — ${desc}` : ''}{ocrFlag && <span style={{color:'#c06000', fontWeight:'bold', fontSize:'0.85em'}}> [OCR?]</span>}
                        </Text>
                      );
                    })}
                  </Stack>
                </div>
              )}
              {Array.isArray(doc.clinical?.problemsList) && doc.clinical.problemsList.length > 0 && (
                <div>
                  <Text size="xs" fw={600} c="dimmed" mb={4}>Problems List:</Text>
                  <Stack gap={2}>
                    {doc.clinical.problemsList.map((problem, idx) => (
                      <Text key={idx} size="xs" c="dimmed">
                        • {problem.condition}
                        {problem.onset && ` (onset: ${problem.onset})`}
                      </Text>
                    ))}
                  </Stack>
                </div>
              )}
              {/* Bug 2 fix: display structured symptoms with status/context */}
              {Array.isArray(doc.symptoms) && doc.symptoms.length > 0 ? (
                <div>
                  <Text size="xs" fw={600} c="dimmed" mb={4}>Symptoms:</Text>
                  <Stack gap={2}>
                    {doc.symptoms.map((s, idx) => {
                      const name = typeof s === 'string' ? s : s?.name;
                      const status = typeof s === 'object' ? s?.status : null;
                      const context = typeof s === 'object' ? s?.context : null;
                      return (
                        <Text key={idx} size="xs" c="dimmed">
                          • {name}
                          {status && ` [${status}]`}
                          {context && ` — ${context}`}
                        </Text>
                      );
                    })}
                  </Stack>
                </div>
              ) : Array.isArray(doc.clinical?.symptoms) && doc.clinical.symptoms.length > 0 ? (
                <Text size="xs" c="dimmed">
                  Symptoms: {doc.clinical.symptoms.join(', ')}
                </Text>
              ) : null}
              {(() => {
                const v = doc.clinical?.vitals || {};
                const parts = [];
                if (v.bmi) parts.push(`BMI ${v.bmi}`);
                if (v.height || v.weightLbs) {
                  const hw = [v.height, v.weightLbs && `${v.weightLbs} lbs`].filter(Boolean).join(' / ');
                  if (hw) parts.push(hw);
                }
                if (v.bp) parts.push(`BP ${v.bp}`);
                return parts.length ? (
                  <Text size="xs" c="dimmed">
                    Vitals: {parts.join(' | ')}
                  </Text>
                ) : null;
              })()}
            </Stack>
          ) : (
            <Stack gap="xs">
              <Group gap="xs" align="center">
                <Text size="xs" fw={500}>Primary Diagnosis</Text>
                <Badge size="xs" color="green" variant="light">✓ Learned</Badge>
              </Group>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Text size="xs" fw={500} c="dimmed" mb={4}>ICD-10 Code</Text>
                  <input
                    type="text"
                    value={editedFields.diagnosisCode}
                    onChange={e => setEditedFields(f => ({ ...f, diagnosisCode: e.target.value }))}
                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <Text size="xs" fw={500} c="dimmed" mb={4}>Description</Text>
                  <input
                    type="text"
                    value={editedFields.diagnosisDescription}
                    onChange={e => setEditedFields(f => ({ ...f, diagnosisDescription: e.target.value }))}
                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>
            </Stack>
          )}
        </Section>

        <Section title="Referring Physician">
          {!isEditing ? (
            <Stack gap={4}>
              <Text size="sm">Name: {doc.provider?.name || '—'}</Text>
              <Text size="xs" c="dimmed">NPI: {doc.provider?.npi || '—'}</Text>
              {doc.provider?.practice && <Text size="xs" c="dimmed">Practice: {doc.provider.practice}</Text>}
              {(doc.provider?.phone || doc.provider?.fax) && (
                <Text size="xs" c="dimmed">
                  {doc.provider?.phone && `Phone: ${doc.provider.phone}`}
                  {doc.provider?.phone && doc.provider?.fax && ' • '}
                  {doc.provider?.fax && `Fax: ${doc.provider.fax}`}
                </Text>
              )}
              {doc.provider?.supervising && (
                <Text size="xs" c="dimmed">Supervising: {doc.provider.supervising}</Text>
              )}
            </Stack>
          ) : (
            <Stack gap="xs">
              <Group gap="xs" align="center">
                <Text size="xs" fw={500}>Provider Info</Text>
                <Badge size="xs" color="green" variant="light">✓ Learned</Badge>
              </Group>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Text size="xs" fw={500} c="dimmed" mb={4}>Provider Name</Text>
                  <input
                    type="text"
                    value={editedFields.providerName}
                    onChange={e => setEditedFields(f => ({ ...f, providerName: e.target.value }))}
                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <Text size="xs" fw={500} c="dimmed" mb={4}>NPI</Text>
                  <input
                    type="text"
                    value={editedFields.providerNpi}
                    onChange={e => setEditedFields(f => ({ ...f, providerNpi: e.target.value }))}
                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Text size="xs" fw={500} c="dimmed" mb={4}>Phone</Text>
                  <input
                    type="text"
                    value={editedFields.providerPhone}
                    onChange={e => setEditedFields(f => ({ ...f, providerPhone: e.target.value }))}
                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <Text size="xs" fw={500} c="dimmed" mb={4}>Fax</Text>
                  <input
                    type="text"
                    value={editedFields.providerFax}
                    onChange={e => setEditedFields(f => ({ ...f, providerFax: e.target.value }))}
                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>
            </Stack>
          )}
        </Section>

        <Section title="Information Alerts">
          <Stack gap={4}>
            {doc.infoAlerts ? (
              <>
                <Text size="xs">
                  PPE Requirements:{' '}
                  {doc.infoAlerts.ppeRequired === true
                    ? 'Yes'
                    : doc.infoAlerts.ppeRequired === false
                    ? 'No'
                    : '—'}
                </Text>
                {Array.isArray(doc.infoAlerts.safety) && doc.infoAlerts.safety.length > 0 && (
                  <Text size="xs">Safety: {doc.infoAlerts.safety.join(', ')}</Text>
                )}
                {Array.isArray(doc.infoAlerts.communication) && doc.infoAlerts.communication.length > 0 && (
                  <Text size="xs">Communication: {doc.infoAlerts.communication.join(', ')}</Text>
                )}
                {Array.isArray(doc.infoAlerts.accommodations) && doc.infoAlerts.accommodations.length > 0 && (
                  <Text size="xs">Special Accommodations: {doc.infoAlerts.accommodations.join(', ')}</Text>
                )}
              </>
            ) : (
              <Text size="xs" c="dimmed">None</Text>
            )}
          </Stack>
        </Section>

        {(doc.flags || doc.alerts) && (
          <Section title="Problem Flags & Actions">
            {doc.flags?.verifyManually && (
              <Badge color="orange" variant="light">Manual Review</Badge>
            )}
            {Array.isArray(doc.flags?.reasons) && doc.flags.reasons.length > 0 && (
              <div>
                <Text size="xs" fw={500} mb="xs">Reasons</Text>
                <Stack gap={0}>
                  {doc.flags.reasons.map((rr, i) => (
                    <Text size="xs" key={i}>• {rr}</Text>
                  ))}
                </Stack>
              </div>
            )}
            {Array.isArray(doc.alerts?.actions) && doc.alerts.actions.length > 0 && (
              <div>
                <Text size="xs" fw={500} mb="xs">Actions</Text>
                <Stack gap={0}>
                  {doc.alerts.actions.map((a, i) => (
                    <Text size="xs" key={i}>• {a}</Text>
                  ))}
                </Stack>
              </div>
            )}
            {/* Bug 6 fix: display alerts.info and alerts.review */}
            {Array.isArray(doc.alerts?.info) && doc.alerts.info.length > 0 && (
              <div>
                <Text size="xs" fw={500} mb="xs">Info</Text>
                <Stack gap={0}>
                  {doc.alerts.info.map((a, i) => (
                    <Text size="xs" key={i} c="dimmed">ℹ️ {a}</Text>
                  ))}
                </Stack>
              </div>
            )}
            {Array.isArray(doc.alerts?.review) && doc.alerts.review.length > 0 && (
              <div>
                <Text size="xs" fw={500} mb="xs">Needs Review</Text>
                <Stack gap={0}>
                  {doc.alerts.review.map((a, i) => (
                    <Text size="xs" key={i} c="yellow">⚠️ {a}</Text>
                  ))}
                </Stack>
              </div>
            )}
          </Section>
        )}

        {/* KB Assessment Panel — Phase 4: surfaces payer, test rec, cost, flags from Level 6 */}
        {doc.routing?.kbAssessment && (
          <KbAssessmentPanel kb={doc.routing.kbAssessment} />
        )}

        {/* Bug 3 fix: display DME data */}
        {doc.dme && (doc.dme.codes?.length > 0 || doc.dme.providers?.length > 0 || doc.dme.issues?.length > 0) && (
          <Section title="Durable Medical Equipment">
            <Stack gap={4}>
              {Array.isArray(doc.dme.codes) && doc.dme.codes.length > 0 && (
                <Text size="xs">Codes: {doc.dme.codes.join(', ')}</Text>
              )}
              {Array.isArray(doc.dme.providers) && doc.dme.providers.length > 0 && (
                <Text size="xs">Providers: {doc.dme.providers.join(', ')}</Text>
              )}
              {Array.isArray(doc.dme.issues) && doc.dme.issues.length > 0 && (
                <Text size="xs" c="yellow">Issues: {doc.dme.issues.join('; ')}</Text>
              )}
            </Stack>
          </Section>
        )}

        {/* Bug 4 fix: display prior study */}
        {doc.priorStudy?.present && (
          <Section title="Prior Study">
            <Text size="xs">Prior sleep study on file</Text>
          </Section>
        )}

        {/* Bug 5 fix: display QC validation flags */}
        {doc.qc && (
          <Section title="Quality Control">
            <Stack gap={2}>
              {doc.qc.nameConsistency != null && (
                <Text size="xs">
                  Name Consistency: {doc.qc.nameConsistency ? '✅ Pass' : '❌ Mismatch detected'}
                </Text>
              )}
              {doc.qc.dateValidity != null && (
                <Text size="xs">
                  Date Validity: {doc.qc.dateValidity ? '✅ Valid' : '❌ Invalid date detected'}
                </Text>
              )}
              {doc.qc.phoneValidity != null && (
                <Text size="xs">
                  Phone Validity: {doc.qc.phoneValidity ? '✅ Valid' : '❌ Invalid phone detected'}
                </Text>
              )}
              {doc.qc.cptValid != null && (
                <Text size="xs">
                  CPT Validity: {doc.qc.cptValid ? '✅ Valid' : '❌ Invalid CPT code'}
                </Text>
              )}
            </Stack>
          </Section>
        )}

        {Array.isArray(doc.documentMeta?.authorizationNotes) && doc.documentMeta.authorizationNotes.length > 0 && (
          <Section title="Authorization Notes">
            <Group justify="space-between" align="flex-start" mb="xs">
              <Text size="xs" fw={500}>Notes</Text>
              {doc.documentMeta.authorizationNotes.length > 4 && (
                <Button size="compact-xs" variant="subtle" onClick={() => setShowAllAuthNotes(v => !v)}>
                  {showAllAuthNotes ? 'Collapse' : `Show All (${doc.documentMeta.authorizationNotes.length})`}
                </Button>
              )}
            </Group>
            <Stack gap={0}>
              {(showAllAuthNotes
                ? doc.documentMeta.authorizationNotes
                : doc.documentMeta.authorizationNotes.slice(0, 4)
              ).map((n, i) => (
                <Text size="xs" key={i}>• {n}</Text>
              ))}
            </Stack>
          </Section>
        )}

        {Array.isArray(doc?.debug?.trace) && doc.debug.trace.length > 0 && (
          <Section title="Debug Trace">
            <ScrollArea h={160} offsetScrollbars>
              <Stack gap="xs">
                {doc.debug.trace.map((t, i) => (
                  <Code key={i} size="xs">{t.rule}</Code>
                ))}
              </Stack>
            </ScrollArea>
          </Section>
        )}

        {/* Bug 24 fix: wire in DualEngineResults component */}
        {doc?.dualEngine && (
          <DualEngineResults result={doc} />
        )}

        {/* Narrative Content (LLM-extracted free text) */}
        {doc?.narrative?.hasNarrativeContent && (
          <Section
            title="📝 Narrative Content (LLM-Extracted)"
            actions={
              <Badge size="sm" color="purple" variant="light">Extract Mode</Badge>
            }
          >
            <Stack gap="md">
              {doc.narrative.reasonForReferral && (
                <div>
                  <Text size="xs" fw={600} c="dimmed" mb={4}>Reason for Referral:</Text>
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                    {doc.narrative.reasonForReferral}
                  </Text>
                </div>
              )}
              
              {doc.narrative.clinicalHistory && (
                <div>
                  <Text size="xs" fw={600} c="dimmed" mb={4}>Clinical History:</Text>
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                    {doc.narrative.clinicalHistory}
                  </Text>
                </div>
              )}
              
              {doc.narrative.currentMedications && (
                <div>
                  <Text size="xs" fw={600} c="dimmed" mb={4}>Current Medications:</Text>
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                    {doc.narrative.currentMedications}
                  </Text>
                </div>
              )}
              
              {doc.narrative.clinicalNotes && (
                <div>
                  <Text size="xs" fw={600} c="dimmed" mb={4}>Clinical Notes:</Text>
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                    {doc.narrative.clinicalNotes}
                  </Text>
                </div>
              )}
              
              {doc.narrative.additionalComments && (
                <div>
                  <Text size="xs" fw={600} c="dimmed" mb={4}>Additional Comments:</Text>
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                    {doc.narrative.additionalComments}
                  </Text>
                </div>
              )}
            </Stack>
          </Section>
        )}

        <Section
          title="Raw JSON"
          actions={
            <Group gap={6} wrap="nowrap">
              <Button
                size="xs"
                variant={showRaw ? 'default' : 'outline'}
                leftSection={showRaw ? <IconArrowsMinimize size={14} /> : <IconArrowsMaximize size={14} />}
                onClick={() => setShowRawMap(m => ({ ...m, [docId]: !m[docId] }))}
              >
                {showRaw ? 'Collapse' : 'Expand'}
              </Button>
              <Button size="xs" variant="light" onClick={() => downloadJson(doc, docId)} disabled={!doc}>
                JSON
              </Button>
              <Button
                size="xs"
                variant="light"
                component="a"
                href={`/api/documents/${docId}/original.pdf`}
                target="_blank"
                disabled={!doc}
              >
                Original
              </Button>
              <Button
                size="xs"
                variant="light"
                component="a"
                href={`/api/documents/${docId}/summary.pdf`}
                target="_blank"
                disabled={!doc}
              >
                PDF
              </Button>
              {/* Patient Report button removed: Packet includes it inline */}
                <Button
                  size="xs"
                  variant="light"
                  component="a"
                  href={`/api/documents/${docId}/packet.pdf`}
                  target="_blank"
                  disabled={!doc}
                >
                  Packet
                </Button>
            </Group>
          }
        >
          {!showRaw && (
            <Text size="xs" c="dimmed">
              Collapsed • {Object.keys(doc || {}).length} top-level keys
            </Text>
          )}
          {showRaw && (
            <ScrollArea style={{ maxHeight: '65vh' }} offsetScrollbars>
              <JsonInput
                value={JSON.stringify(doc, null, 2)}
                readOnly
                autosize={false}
                minRows={28}
                styles={{
                  input: {
                    fontSize: 12,
                    minHeight: '520px',
                    resize: 'vertical',
                    lineHeight: 1.4
                  }
                }}
              />
            </ScrollArea>
          )}
        </Section>
      </Stack>
    );
  }

  return (
    <Stack gap="xl">
      <Paper p="xl" withBorder radius="lg" shadow="sm">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Title order={3}>Referral Intake</Title>
          <Group gap="xs">
            {selectedId && <Badge variant="outline">ID: {selectedId}</Badge>}
            {status && (
              <Badge color={status === 'done' ? 'green' : status === 'error' ? 'red' : 'blue'}>
                {status}
              </Badge>
            )}
            {confidenceBadge}
            {verificationBadge}
            {dualEngineBadge}
            {validationIssuesBadge}
            {routingBadge}
          </Group>
        </Group>
      </Paper>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-3">
          <Paper shadow="sm" p="xl" withBorder radius="lg" style={{ height: '100%' }}>
            <Stack gap="lg">
              <Stack gap="md">
                <Text size="sm" fw={600} c="dimmed" tt="uppercase" className="section-heading">
                  Actions
                </Text>
                <Button leftSection={<IconUpload size={16} />} variant="light" component="label" size="sm" fullWidth>
                  {files.length ? `${files.length} file(s) selected` : 'Select PDF(s)'}
                  <input
                    type="file"
                    hidden
                    accept="application/pdf"
                    multiple
                    onChange={e => setFiles(Array.from(e.target.files || []))}
                  />
                </Button>
                <Group gap="xs">
                  <Button
                    size="xs"
                    onClick={upload}
                    leftSection={<IconPlayerPlay size={14} />}
                    disabled={!files.length || loading}
                    loading={loading}
                  >
                    One
                  </Button>
                  <Button
                    size="xs"
                    variant="default"
                    onClick={uploadAll}
                    leftSection={<IconPlayerPlay size={14} />}
                    disabled={files.length < 2 || loading}
                    loading={loading}
                  >
                    All
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={loadSample}
                    leftSection={<IconFileArrowRight size={14} />}
                    disabled={loading}
                  >
                    Sample
                  </Button>
                </Group>
                {Object.keys(resultsMap).length > 0 && (
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    onClick={clearAll}
                    leftSection={<IconTrash size={14} />}
                    fullWidth
                  >
                    Clear All ({Object.keys(resultsMap).length})
                  </Button>
                )}
                {error && <Badge color="red" variant="light">{error}</Badge>}
                {batchProgress.length > 0 && (
                  <Stack gap={2}>
                    {batchProgress.map(it => (
                      <Group
                        key={it.name + it.id}
                        gap={4}
                        wrap="nowrap"
                        justify="space-between"
                        align="center"
                        style={{
                          borderBottom: '1px solid #2a323c',
                          paddingBottom: 2
                        }}
                      >
                        <Button
                          variant={it.id === selectedId ? 'light' : 'subtle'}
                          size="compact-xs"
                          style={{
                            flex: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            justifyContent: 'flex-start'
                          }}
                          onClick={() => {
                            if (it.id && resultsMap[it.id]) {
                              setSelectedId(it.id);
                              setDebugTrace(resultsMap[it.id]?.debug?.trace || []);
                            }
                          }}
                          disabled={!it.id || !resultsMap[it.id]}
                        >
                          {it.name}
                        </Button>
                        <Tooltip label={
                          it.status === 'error' ? ((it.errorCode ? `${it.errorCode}: ` : '') + (it.error || 'Processing failed') + (it.suggestions ? `\nTry: ${it.suggestions.slice(0,2).join('; ')}` : '')) :
                          it.status === 'rate-limit' ? '429: server asked us to slow down' :
                          it.status === 'net-error' ? 'Network error: will retry' :
                          it.status === 'processing' ? 'Processing' :
                          it.status === 'submitted' ? 'Submitted' :
                          it.status === 'queued' ? 'Queued' :
                          it.status === 'uploading' ? 'Uploading' : null
                        }>
                          <Badge size="xs" variant="light" color={getStatusBadgeColor(it.status)}>
                            {it.status}
                            {it.status === 'error' && it.errorCode && (
                              <span style={{ marginLeft: 4, fontWeight: 500 }}>{it.errorCode}</span>
                            )}
                          </Badge>
                        </Tooltip>
                      </Group>
                    ))}
                  </Stack>
                )}
              </Stack>

              <Stack gap="md">
                <Text size="sm" fw={600} c="dimmed" tt="uppercase" className="section-heading">
                  Batch Dates
                </Text>
                <ScrollArea h={150} offsetScrollbars>
                  <Stack gap="xs">
                    {batchDates.length === 0 && <Text size="sm" c="dimmed">None</Text>}
                    {batchDates.map(d => (
                      <Group key={d} gap="xs" wrap="nowrap">
                        <Code size="xs">{d}</Code>
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          component="a"
                          href={`${apiBase}/batch/${d}/cover.pdf`}
                          target="_blank"
                        >
                          <IconFileImport size={14} />
                        </ActionIcon>
                      </Group>
                    ))}
                  </Stack>
                </ScrollArea>
              </Stack>
            </Stack>
          </Paper>
  </div>
  <div className="lg:col-span-9">
          <Paper shadow="sm" p="xl" withBorder radius="lg" style={{ minHeight: 400 }} data-processed-container>
            <Stack gap="md">
              <Group justify="space-between" mb="xs">
                <Text size="sm" fw={600} c="dimmed" tt="uppercase">
                  Processed
                </Text>
                {processedOrder.length > 0 && (
                  <Group gap={6} wrap="nowrap">
                    {!selectMode && (
                      <Group gap={4} wrap="nowrap">
                        <Badge variant="light" size="sm">{processedOrder.length}</Badge>
                        <Tooltip label="Export all packets as a single ZIP" position="bottom">
                          <Button size="compact-xs" variant="default" disabled={doneIds.length === 0} onClick={() => exportZip(doneIds)}>
                            Export ZIP
                          </Button>
                        </Tooltip>
                        <Button size="compact-xs" variant="light" onClick={() => { setSelectMode(true); clearSelection(); }}>
                          Select
                        </Button>
                      </Group>
                    )}
                    {selectMode && (
                      <Group gap={4} wrap="nowrap">
                        <Badge size="sm" variant="outline" color={selectedExportIds.size ? 'blue' : 'gray'}>
                          {selectedExportIds.size}/{doneIds.length}
                        </Badge>
                        <Tooltip label="Export selected packets as ZIP">
                          <Button size="compact-xs" variant="light" disabled={!selectedExportIds.size} onClick={() => exportZip(Array.from(selectedExportIds))}>ZIP</Button>
                        </Tooltip>
                        <Button size="compact-xs" variant="subtle" color="red" disabled={!selectedExportIds.size} onClick={() => purgeSelected()}>Purge</Button>
                        <Button size="compact-xs" variant="subtle" onClick={() => { if (selectedExportIds.size === doneIds.length) clearSelection(); else selectAll(); }}>
                          {selectedExportIds.size === doneIds.length ? 'None' : 'All'}
                        </Button>
                        <Button size="compact-xs" variant="default" onClick={() => { setSelectMode(false); clearSelection(); }}>Done</Button>
                      </Group>
                    )}
                  </Group>
                )}
              </Group>

              {processedOrder.length === 0 && <PlaceholderPanel loading={loading} />}

              {processedOrder.length > 0 && (
                <ScrollArea h={750} offsetScrollbars>
                  <Stack gap="sm">
                    {processedOrder.map(pid => {
                      const r = resultsMap[pid];
                      if (!r) return null;
                      const patientName = [r?.patient?.last, r?.patient?.first].filter(Boolean).join(', ') || r?.documentMeta?.suggestedFilename || '—';
                      const primaryCpt = r?.procedure?.cpt || '—';
                      const conf = r?.confidence || r?.confidenceLevel;
                      const actions = r?.alerts?.actions || [];
                      const isSelected = selectedId === pid;
                      const showRaw = !!showRawMap[pid];
                      const isError = false; // reverted error card logic
                      const done = r && !r._placeholder && !r._uploading;

                      return (
                        <Paper
                          key={pid}
                          withBorder
                          radius="md"
                          p="sm"
                          className="processed-doc-card"
                          style={{
                            position: 'relative',
                            borderColor: '#181c1f',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.55)',
                            transition: 'background 140ms ease, box-shadow 140ms ease, border-color 140ms ease'
                          }}
                          data-processed-card={isSelected ? 'selected' : 'default'}
                          onMouseEnter={e => {
                            e.currentTarget.style.boxShadow = '0 0 0 1px #1f2428, 0 2px 8px -2px rgba(0,0,0,0.6)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.55)';
                          }}
                        >
                          <div
                            style={{
                              position: 'absolute',
                              left: 0,
                              top: 0,
                              bottom: 0,
                              width: 3,
                              borderTopLeftRadius: 'inherit',
                              borderBottomLeftRadius: 'inherit',
                              background: '#1f2428'
                            }}
                          />
                          <Stack gap={6}>
                            <Group justify="space-between" align="flex-start" wrap="nowrap" gap={8}>
                              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                                <Group gap={6} align="flex-start" wrap="nowrap">
                                  {selectMode && done && (
                                    <Checkbox
                                      size="xs"
                                      checked={selectedExportIds.has(pid)}
                                      onChange={() => toggleSelect(pid)}
                                      styles={{ input: { cursor: 'pointer' } }}
                                    />
                                  )}
                                  <Text
                                    size="xs"
                                    fw={600}
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => setSelectedId(p => (p === pid ? '' : pid))}
                                  >
                                    {patientName}
                                  </Text>
                                </Group>
                                <Text size="xs" c="dimmed">
                                  {r?._placeholder ? (r._uploading ? 'Uploading…' : 'Processing…') : r?._reprocessing ? 'Reprocessing…' : (
                                    <>
                                      CPT: {primaryCpt}
                                      {conf && ` • ${conf}`}
                                    </>
                                  )}
                                </Text>
                                {actions.length > 0 && !isSelected && (
                                  <Group gap={4} wrap="wrap" mt={2}>
                                    {actions.slice(0, 3).map((a, i) => (
                                      <Badge key={i} size="xs" variant="light" color="blue">
                                        {a}
                                      </Badge>
                                    ))}
                                    {actions.length > 3 && (
                                      <Badge size="xs" variant="outline">
                                        +{actions.length - 3}
                                      </Badge>
                                    )}
                                  </Group>
                                )}
                                {/* Validation Issues Badge */}
                                {r?.dualEngine?.conflicts?.length > 0 && (
                                  <Badge 
                                    size="xs" 
                                    color="red" 
                                    variant="light"
                                    style={{ cursor: 'pointer' }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedId(pid);
                                      setTimeout(() => {
                                        setShowValidationDrawer(true);
                                      }, 50);
                                    }}
                                  >
                                    ⚠️ {r.dualEngine.conflicts.length}
                                  </Badge>
                                )}
                                {/* Verification Status Badge */}
                                {r?._verification?.status && (() => {
                                  const vs = r._verification.status;
                                  const cfg = {
                                    confirmed: { color: 'green', label: '✓' },
                                    vlm_confirmed: { color: 'teal', label: '✓ VLM' },
                                    auto_corrected: { color: 'orange', label: '⚡ Fixed' },
                                    flagged: { color: 'red', label: '⚑ Flag' },
                                  };
                                  const c = cfg[vs];
                                  return c ? (
                                    <Badge size="xs" variant="light" color={c.color}>{c.label}</Badge>
                                  ) : null;
                                })()}
                              </Stack>
                              <Group gap={4} align="flex-start">
                                <Tooltip label="Fetch debug trace">
                                  <ActionIcon
                                    size="sm"
                                    variant="subtle"
                                    onClick={() => fetchDebug(pid)}
                                    disabled={!pid}
                                  >
                                    <IconBug size={14} />
                                  </ActionIcon>
                                </Tooltip>
                                <Button
                                  size="compact-xs"
                                  variant={isSelected ? 'filled' : 'light'}
                                  onClick={() => setSelectedId(p => (p === pid ? '' : pid))}
                                >
                                  {isSelected ? 'Hide' : 'View'}
                                </Button>
                              </Group>
                            </Group>
                            {isSelected && <Details docId={pid} doc={r} showRaw={showRaw} />}
                          </Stack>
                        </Paper>
                      );
                    })}
                  </Stack>
                </ScrollArea>
              )}
            </Stack>
          </Paper>
        </div>
      </div>

      {/* Live Logs Panel */}
      <Paper shadow="sm" p="md" withBorder radius="lg">
        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <Text size="sm" fw={600} c="dimmed" tt="uppercase">
                OCR Service Logs
              </Text>
              {showLogs && (
                <>
                  <Badge size="sm" variant="light" color="blue">
                    Live
                  </Badge>
                  <Tooltip label="Purple = Dual-Engine/Ollama events, Pink = Routing/Decision-tree">
                    <Badge size="xs" variant="outline" color="purple">
                      Color-coded
                    </Badge>
                  </Tooltip>
                </>
              )}
            </Group>
            <Button
              size="xs"
              variant={showLogs ? 'filled' : 'light'}
              onClick={() => setShowLogs(v => !v)}
            >
              {showLogs ? 'Hide Logs' : 'Show Live Logs'}
            </Button>
          </Group>
          
          {showLogs && (
            <Paper p="sm" withBorder style={{ background: '#0a0e13', fontFamily: 'monospace' }}>
              <Stack gap="xs" mb="xs">
                <Group gap="xs" align="center">
                  <Text size="xs" c="dimmed">
                    {autoScroll ? '📌 Auto-scrolling' : '⏸️ Scroll paused (scroll to bottom to resume)'}
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => {
                      setAutoScroll(true);
                      if (logsScrollRef.current) {
                        logsScrollRef.current.scrollTop = logsScrollRef.current.scrollHeight;
                      }
                    }}
                  >
                    Jump to Bottom
                  </Button>
                </Group>
              </Stack>
              <ScrollArea 
                h={300} 
                offsetScrollbars
                ref={logsScrollRef}
              >
                <Stack gap={2}>
                  {logs.length === 0 && (
                    <Text size="xs" c="dimmed">
                      Waiting for logs...
                    </Text>
                  )}
                  {logs.map((line, i) => {
                    // Color-code important log lines
                    const isError = line.includes('ERROR') || line.includes('error');
                    const isWarning = line.includes('WARN') || line.includes('warning');
                    const isInfo = line.includes('INFO') || line.includes('page=');
                    const isTiming = line.includes('took ') || line.includes('confidence=');
                    const isDualEngine = line.includes('dual_engine') || line.includes('ollama') || line.includes('page_selection') || line.includes('multi_page');
                    const isRouting = line.includes('routing') || line.includes('decision_tree');
                    
                    let color = '#9ca3af'; // default gray
                    if (isError) color = '#ef4444'; // red
                    else if (isWarning) color = '#f59e0b'; // orange
                    else if (isDualEngine) color = '#a78bfa'; // purple (dual-engine events)
                    else if (isRouting) color = '#f472b6'; // pink (routing events)
                    else if (isInfo) color = '#3b82f6'; // blue
                    else if (isTiming) color = '#10b981'; // green
                    
                    return (
                      <Text
                        key={i}
                        size="xs"
                        style={{
                          color,
                          lineHeight: 1.4,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word'
                        }}
                      >
                        {line}
                      </Text>
                    );
                  })}
                  <div ref={logsEndRef} />
                </Stack>
              </ScrollArea>
            </Paper>
          )}
        </Stack>
      </Paper>

      {/* Ollama LLM Monitor */}
      <OllamaMonitor />

      {/* Validation Issues Drawer */}
      <ValidationIssuesDrawer
        isOpen={showValidationDrawer}
        onClose={() => setShowValidationDrawer(false)}
        conflicts={selectedDoc?.dualEngine?.conflicts || []}
        extractedData={selectedDoc?.dualEngine?.llm?.extracted || selectedDoc || {}}
        onUpdateField={handleUpdateField}
      />

    </Stack>
  );
}
