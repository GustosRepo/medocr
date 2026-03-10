import React, { useEffect, useMemo, useState } from 'react';
import { Button, Group, Stack, Text, Badge, Paper, ScrollArea, JsonInput, Code, Title } from '../ui/primitives.jsx';
import { notifications } from '../ui/primitives.jsx';
import OcrPdfHighlighter from '../components/OcrPdfHighlighter.jsx';

function fetchJson(url, opts) {
  return fetch(url, opts).then(async res => {
    if (!res.ok) {
      const message = await res.text();
      throw new Error(message || `Request failed (${res.status})`);
    }
    return res.json();
  });
}

function summarizeCoverage(pdfModel) {
  if (!pdfModel) return { total: 0, missing: 0, percent: 0, missingList: [] };
  const tracked = [
    'patient.last',
    'patient.first',
    'patient.dob',
    'insurance.primary.carrier',
    'procedure.cpt',
    'provider.name'
  ];
  const missing = Array.isArray(pdfModel.missing) ? pdfModel.missing : [];
  const trackedMissing = missing.filter(m => tracked.includes(m));
  const total = tracked.length;
  const percent = total === 0 ? 0 : Math.max(0, Math.min(1, (total - trackedMissing.length) / total));
  return { total, missing: trackedMissing.length, percent, missingList: trackedMissing };
}

function formatNumber(num, digits = 2) {
  if (Number.isNaN(num) || num === undefined || num === null) return '—';
  return Number(num).toFixed(digits);
}

export default function OcrDebugPage() {
  const [docs, setDocs] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [showRaw, setShowRaw] = useState(true);
  const [downloadingAnnotated, setDownloadingAnnotated] = useState(false);
  
  // Correction states
  const [editMode, setEditMode] = useState(false);
  const [editedFields, setEditedFields] = useState({});
  const [savingCorrection, setSavingCorrection] = useState(false);
  // Reprocess overrides
  const [reproc, setReproc] = useState({ mode: 'enhanced', dpi: '300', use_clahe: 'true', use_bilateral: 'false', retry_threshold: '0.65' });
  const [reprocessing, setReprocessing] = useState(false);

  useEffect(() => {
    setLoadingDocs(true);
    fetchJson('/api/documents?limit=200')
      .then(data => setDocs(Array.isArray(data.items) ? data.items : []))
      .catch(err => setError(err.message || String(err)))
      .finally(() => setLoadingDocs(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoadingDoc(true);
    setError('');
    setEditMode(false);
    setEditedFields({});
    fetchJson(`/api/documents/${selectedId}/result?debug=1`)
      .then(setSelectedDoc)
      .catch(err => {
        setSelectedDoc(null);
        setError(err.message || String(err));
      })
      .finally(() => setLoadingDoc(false));
  }, [selectedId]);

  const filteredDocs = useMemo(() => {
    if (!query) return docs;
    const q = query.toLowerCase();
    return docs.filter(doc => {
      const name = `${doc.last || ''} ${doc.first || ''}`.toLowerCase();
      return doc.id.toLowerCase().includes(q) || name.includes(q) || (doc.suggestedFilename || '').toLowerCase().includes(q);
    });
  }, [docs, query]);

  const coverage = useMemo(() => summarizeCoverage(selectedDoc?.pdfModel), [selectedDoc]);

  const ocrStats = useMemo(() => {
    const pages = Array.isArray(selectedDoc?.ocr) ? selectedDoc.ocr : [];
    const totalBoxes = pages.reduce((sum, p) => sum + (Array.isArray(p.boxes) ? p.boxes.length : 0), 0);
    const confSum = pages.reduce((sum, p) => sum + (Array.isArray(p.boxes) ? p.boxes.reduce((acc, b) => acc + (Number(b.conf) || 0), 0) : 0), 0);
    const avgConf = totalBoxes ? confSum / totalBoxes : null;
    const textLength = pages.reduce((sum, p) => sum + ((p.text || '').length), 0);
    return { pages: pages.length, totalBoxes, avgConf, textLength };
  }, [selectedDoc]);

  const highlightSpans = useMemo(() => {
    const spansFromDebug = selectedDoc?.debug?.spans;
    if (Array.isArray(spansFromDebug)) return spansFromDebug;
    return [];
  }, [selectedDoc]);

  const highlightScopeColors = useMemo(() => {
    const colors = selectedDoc?.debug?.scopeColors;
    if (colors && typeof colors === 'object') return colors;
    return null;
  }, [selectedDoc]);

  // Derive per-field "learned" flags from trace events
  const learnedFlags = useMemo(() => {
    const rules = new Set((selectedDoc?.debug?.trace || []).map(ev => ev?.rule));
    return {
      carrier: rules.has('learned_correction_carrier'),
      cpt: rules.has('learned_correction_cpt'),
      provider: rules.has('learned_correction_provider'),
      practice: rules.has('learned_correction_practice'),
      providerPhone: (
        rules.has('learned_correction_provider_phone') ||
        rules.has('learned_provider_phone_from_name') ||
        rules.has('learned_provider_phone_from_practice')
      ),
      providerFax: rules.has('learned_correction_provider_fax')
    };
  }, [selectedDoc]);

  const originalPdfUrl = useMemo(() => {
    if (!selectedId) return '';
    return `/api/documents/${encodeURIComponent(selectedId)}/original.pdf`;
  }, [selectedId]);

  const combinedRawText = useMemo(() => {
    if (!selectedDoc) return '';
    if (typeof selectedDoc?.debug?.rawText === 'string' && selectedDoc.debug.rawText.trim()) {
      return selectedDoc.debug.rawText;
    }
    if (Array.isArray(selectedDoc?.ocr)) {
      return selectedDoc.ocr.map(page => page?.text || '').join('\n');
    }
    return '';
  }, [selectedDoc]);

  const insuranceInspector = useMemo(() => {
    if (!selectedDoc) return { carrier: '', chosen: '', candidates: [] };
    const carrier = selectedDoc.insurance?.[0]?.carrier || '';
    const chosen = selectedDoc.insurance?.[0]?.memberId || '';
    const pages = Array.isArray(selectedDoc?.ocr) ? selectedDoc.ocr : [];
    const fullText = pages.map(p => p.text || '').join('\n');
    const lines = fullText.split(/\n/);
    const lower = lines.map(l => l.toLowerCase());
    const candidates = [];
    const push = (val, why, extra={}) => {
      if (!val) return;
      const v = String(val).trim();
      if (!v) return;
      if (!/\d/.test(v)) return; // must contain a digit
      if (!candidates.find(c => c.value === v)) candidates.push({ value: v, why, ...extra });
    };
    // Primary block window
    let anchorIdx = lower.findIndex(l => /primary\s+insurance|insurance\s*\(ppo\)|\binsurance\b/.test(l));
    if (anchorIdx === -1 && carrier) {
      const ckey = carrier.toLowerCase();
      anchorIdx = lower.findIndex(l => l.includes(ckey));
    }
    if (anchorIdx !== -1) {
      const windowText = lines.slice(anchorIdx, Math.min(lines.length, anchorIdx + 8)).join('\n');
      const alnum = windowText.match(/\b([A-Z]\d{8,10})\b/i);
      if (alnum) push(alnum[1], 'primary_block_alnum');
      const labeled = windowText.match(/\b(?:ins(?:urance)?|id)\s*(?:no\.?|#|id|number)?\s*[:#-]?\s*([A-Z0-9]{6,})\b/i);
      if (labeled) push(labeled[1], 'primary_block_labeled');
    }
    // Member/subscriber labels
    const m1 = [...fullText.matchAll(/\bmember\s*(?:id|#|number)?\s*[:#-]?\s*([A-Z0-9]{3,})\b/ig)].map(m=>m[1]);
    m1.forEach(v => push(v, 'member_label'));
    const m2 = [...fullText.matchAll(/\b(?:subscriber|insured|policy(?!\s*holder))\s*(?:id|#|number)\s*[:#-]?\s*([A-Z0-9]{3,})\b/ig)].map(m=>m[1]);
    m2.forEach(v => push(v, 'subscriber_label'));
    const m3 = [...fullText.matchAll(/\bins(?:urance)?\s*(?:no\.?|#|id|number)?\s*[:#-]?\s*([A-Z0-9]{3,})\b/ig)].map(m=>m[1]);
    m3.forEach(v => push(v, 'insurance_label'));
    // Generic ID pattern near insurance keywords
    const generic = [...fullText.matchAll(/\b([A-Z]\d{8,10})\b/g)].map(m=>({ value: m[1], idx: m.index||0 }));
    if (generic.length) {
      const txtLower = fullText.toLowerCase();
      const kwords = ['insurance','insured','carrier','aetna','anthem','cigna','humana','united','medicare','medicaid','primary'];
      const positions = [];
      for (const kw of kwords) {
        let pos = txtLower.indexOf(kw);
        while (pos !== -1) { positions.push(pos); pos = txtLower.indexOf(kw, pos + 1); }
      }
      for (const g of generic) {
        let minDist = Infinity;
        for (const p of positions) { const d = Math.abs(g.idx - p); if (d < minDist) minDist = d; }
        if (minDist < 500) push(g.value, 'generic_alnum_near_insurance', { proximity: minDist });
      }
    }
    return { carrier, chosen, candidates };
  }, [selectedDoc]);

  function copyDebugInfo() {
    if (!selectedDoc) return;

    const info = {
      documentId: selectedId,
      timestamp: new Date().toISOString(),
      
      // Summary stats
      stats: {
        pages: ocrStats.pages,
        totalBoxes: ocrStats.totalBoxes,
        avgConfidence: ocrStats.avgConf,
        textLength: ocrStats.textLength,
        confidenceLevel: selectedDoc.confidenceLevel,
        coverage: `${Math.round(coverage.percent * 100)}%`,
        missingFields: coverage.missingList
      },
      
      // Dual-Engine Processing
      dualEngine: selectedDoc.dualEngine ? {
        enabled: true,
        llmBackend: selectedDoc.dualEngine.llmBackend || 'ollama',
        pagesProcessed: selectedDoc.dualEngine.llm?.pagesProcessed || 0,
        processingTime: selectedDoc.dualEngine.llm?.processingTime,
        agreementScore: selectedDoc.dualEngine.agreementScore,
        conflicts: selectedDoc.dualEngine.conflicts || [],
        dataQuality: selectedDoc.dualEngine.dataQuality
      } : { enabled: false },
      
      // Decision Tree Routing
      routing: selectedDoc.routing ? {
        action: selectedDoc.routing.route?.action,
        priority: selectedDoc.routing.route?.priority,
        route: selectedDoc.routing.route?.label,
        description: selectedDoc.routing.route?.description,
        estimatedTime: selectedDoc.routing.route?.estimatedTime,
        nextSteps: selectedDoc.routing.route?.nextSteps || [],
        validationSummary: selectedDoc.routing.route?.validationSummary,
        validationSteps: selectedDoc.routing.validationSteps || [],
        dataQuality: selectedDoc.routing.processingMetadata?.dataQuality
      } : null,
      
      // Extracted fields
      extracted: {
        patient: {
          name: `${selectedDoc.patient?.last || '—'}, ${selectedDoc.patient?.first || '—'}`,
          dob: selectedDoc.patient?.dob || '—'
        },
        insurance: {
          carrier: selectedDoc.insurance?.[0]?.carrier || '—',
          memberId: selectedDoc.insurance?.[0]?.memberId || '—'
        },
        procedure: {
          cpt: selectedDoc.procedure?.cpt || '—',
          description: selectedDoc.procedure?.description || '—'
        },
        provider: {
          name: selectedDoc.provider?.name || '—',
          npi: selectedDoc.provider?.npi || '—'
        }
      },
      
      // Rule trace
      ruleTrace: selectedDoc.debug?.trace || [],
      
      // Raw OCR text
      rawOCR: (selectedDoc.ocr || []).map(page => ({
        page: page.page,
        boxes: Array.isArray(page.boxes) ? page.boxes.length : 0,
        text: page.text || ''
      })),
      rawTextCombined: combinedRawText,
      highlightSpans,
      highlightScopeColors: highlightScopeColors
    };

    const formatted = JSON.stringify(info, null, 2);
    
    navigator.clipboard.writeText(formatted).then(() => {
      notifications.show({
        title: 'Debug Info Copied',
        message: 'All debug data copied to clipboard - paste it here for troubleshooting!',
        color: 'green'
      });
    }).catch(() => {
      notifications.show({
        title: 'Copy Failed',
        message: 'Could not copy to clipboard',
        color: 'red'
      });
    });
  }

  function copyCombinedRaw() {
    if (!combinedRawText) {
      notifications.show({ title: 'No Raw Text', message: 'No combined OCR text available yet.', color: 'yellow' });
      return;
    }
    navigator.clipboard.writeText(combinedRawText).then(() => {
      notifications.show({ title: 'Combined OCR Copied', message: 'Raw OCR text copied to clipboard.', color: 'green' });
    }).catch(() => {
      notifications.show({ title: 'Copy Failed', message: 'Could not copy raw OCR text.', color: 'red' });
    });
  }

  function downloadResult() {
    if (!selectedDoc) return;
    const blob = new Blob([JSON.stringify(selectedDoc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedId || 'result'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  async function downloadAnnotatedPdf() {
    if (!selectedId) return;
    setDownloadingAnnotated(true);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(selectedId)}/annotated.pdf`);
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || `Request failed (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      let filename = `${selectedId}-annotated.pdf`;
      const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      if (utfMatch && utfMatch[1]) {
        try { filename = decodeURIComponent(utfMatch[1]); } catch { filename = utfMatch[1]; }
      } else {
        const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
        if (plainMatch && plainMatch[1]) filename = plainMatch[1];
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 500);
      notifications.show({ title: 'Annotated PDF Ready', message: 'Download complete.', color: 'green' });
    } catch (err) {
      notifications.show({ title: 'Download Failed', message: err.message || String(err), color: 'red' });
    } finally {
      setDownloadingAnnotated(false);
    }
  }


  async function triggerReprocess() {
    if (!selectedId) return;
    setReprocessing(true);
    try {
      const body = {};
      for (const [k,v] of Object.entries(reproc)) {
        if (v !== '' && v != null) body[k] = v;
      }
      await fetchJson(`/api/documents/${selectedId}/reprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      // Poll status until done
      let tries = 0;
      let status = 'queued';
      while (tries < 120 && (status === 'queued' || status === 'processing')) {
        await new Promise(r => setTimeout(r, 1000));
        const s = await fetchJson(`/api/documents/${selectedId}/status`);
        status = s.status;
        tries++;
      }
      // Reload result
      const doc = await fetchJson(`/api/documents/${selectedId}/result?debug=1`);
      setSelectedDoc(doc);
      notifications.show({ title: 'Reprocessed', message: 'Document reprocessed with overrides', color: 'green' });
    } catch (err) {
      notifications.show({ title: 'Reprocess failed', message: err.message || String(err), color: 'red' });
    } finally {
      setReprocessing(false);
    }
  }

  function startEdit() {
    setEditMode(true);
    setEditedFields({
      // Provider info
      providerName: selectedDoc?.provider?.name || '',
      providerNpi: selectedDoc?.provider?.npi || '',
      providerPhone: selectedDoc?.provider?.phone || '',
      providerFax: selectedDoc?.provider?.fax || '',
      facilityName: selectedDoc?.provider?.practice || '',
      
      // Patient info
      patientLast: selectedDoc?.patient?.last || '',
      patientFirst: selectedDoc?.patient?.first || '',
      patientDob: selectedDoc?.patient?.dob || '',
      
      // Insurance
      insuranceCarrier: selectedDoc?.insurance?.[0]?.carrier || '',
      insuranceMemberId: selectedDoc?.insurance?.[0]?.memberId || '',
      
      // Procedure
      cptCode: selectedDoc?.procedure?.cpt || '',
      cptDescription: selectedDoc?.procedure?.description || '',
      
      // Diagnoses (comma-separated)
      icdCodes: Array.isArray(selectedDoc?.diagnoses) 
        ? selectedDoc.diagnoses.map(d => d.code || d).join(', ') 
        : ''
    });
  }

  function cancelEdit() {
    setEditMode(false);
    setEditedFields({});
  }

  async function saveCorrections() {
    if (!selectedDoc) return;
    
    setSavingCorrection(true);
    const corrections = [];

    // HIPAA COMPLIANT: Only save non-PHI corrections
    // Patient names, DOB, and Member IDs are PHI and should NOT be stored

    // ✅ Provider name correction (non-PHI, public info)
    if (editedFields.providerName && editedFields.providerName !== selectedDoc.provider?.name) {
      corrections.push({
        type: 'provider',
        field: 'name',
        ocrText: selectedDoc.provider?.name || '',
        correctedText: editedFields.providerName,
        documentId: selectedId,
        confidence: selectedDoc.stats?.avgConfidence
      });
    }

    // ✅ Provider NPI (public registry, non-PHI)
    if (editedFields.providerNpi && editedFields.providerNpi !== selectedDoc.provider?.npi) {
      corrections.push({
        type: 'npi',
        ocrText: selectedDoc.provider?.npi || '',
        correctedText: editedFields.providerNpi,
        documentId: selectedId
      });
    }

    // ✅ Provider Phone (business contact, non-PHI)
    if (editedFields.providerPhone && editedFields.providerPhone !== selectedDoc.provider?.phone) {
      // If we have an OCR-detected original phone, record a direct mapping
      if (selectedDoc.provider?.phone) {
        corrections.push({
          type: 'phone',
          ocrText: selectedDoc.provider.phone,
          correctedText: editedFields.providerPhone,
          documentId: selectedId
        });
      }
      // Always record a provider-keyed phone so we can learn even when OCR missed it
      if (selectedDoc.provider?.name) {
        corrections.push({
          type: 'referringPhone',
          ocrText: selectedDoc.provider.name,
          correctedText: editedFields.providerPhone,
          documentId: selectedId
        });
      }
      // Also key by practice/facility when available
      if (selectedDoc.provider?.practice) {
        corrections.push({
          type: 'referringPhone',
          ocrText: selectedDoc.provider.practice,
          correctedText: editedFields.providerPhone,
          documentId: selectedId
        });
      }
    }

    // ✅ Provider Fax (business contact, non-PHI)
    if (editedFields.providerFax && editedFields.providerFax !== selectedDoc.provider?.fax) {
      corrections.push({
        type: 'fax',
        ocrText: selectedDoc.provider?.fax || '',
        correctedText: editedFields.providerFax,
        documentId: selectedId
      });
    }

    // ✅ Facility name (business entity, non-PHI)
    if (editedFields.facilityName && editedFields.facilityName !== selectedDoc.provider?.practice) {
      corrections.push({
        type: 'practiceName',
        ocrText: selectedDoc.provider?.practice || '',
        correctedText: editedFields.facilityName,
        documentId: selectedId
      });
    }

    // ❌ SKIP: Patient names, DOB, Member ID (PHI - not stored for HIPAA compliance)
    // Users can still edit these fields in the UI for the current document,
    // but corrections won't be saved to the learning database

    // ✅ Insurance Carrier (just the name, not linked to specific patient)
    if (editedFields.insuranceCarrier && editedFields.insuranceCarrier !== selectedDoc.insurance?.[0]?.carrier) {
      corrections.push({
        type: 'carrier',
        ocrText: selectedDoc.insurance?.[0]?.carrier || '',
        correctedText: editedFields.insuranceCarrier,
        documentId: selectedId
      });
    }

    // ✅ CPT Code (procedure code, not patient-specific)
    if (editedFields.cptCode && editedFields.cptCode !== selectedDoc.procedure?.cpt) {
      corrections.push({
        type: 'cpt',
        ocrText: selectedDoc.procedure?.cpt || '',
        correctedText: editedFields.cptCode,
        documentId: selectedId
      });
    }

    // ✅ ICD Codes (diagnosis codes, not patient-specific)
    const originalIcd = Array.isArray(selectedDoc?.diagnoses) 
      ? selectedDoc.diagnoses.map(d => d.code || d).join(', ') 
      : '';
    if (editedFields.icdCodes && editedFields.icdCodes !== originalIcd) {
      corrections.push({
        type: 'icd',
        ocrText: originalIcd,
        correctedText: editedFields.icdCodes,
        documentId: selectedId
      });
    }

    if (corrections.length === 0) {
      notifications.show({
        title: 'No Changes',
        message: 'No non-PHI corrections were made. Patient data (names, DOB, Member ID) cannot be stored for HIPAA compliance.',
        color: 'blue'
      });
      setEditMode(false);
      setSavingCorrection(false);
      return;
    }

    try {
      await fetchJson('/api/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corrections })
      });

      notifications.show({
        title: 'Corrections Saved',
        message: `${corrections.length} non-PHI correction(s) recorded. Future documents will benefit from this learning! (Patient data not stored per HIPAA)`,
        color: 'green'
      });

      setEditMode(false);
      setEditedFields({});
    } catch (err) {
      notifications.show({
        title: 'Error',
        message: err.message || 'Failed to save corrections',
        color: 'red'
      });
    } finally {
      setSavingCorrection(false);
    }
  }

  return (
    <Stack gap="lg" className="page-container">
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <Title order={2} className="page-title">OCR Debug Console</Title>
        <Group gap="xs">
          <Button size="xs" variant="light" onClick={downloadResult} disabled={!selectedDoc}>Download JSON</Button>
          <Button size="xs" variant={showRaw ? 'default' : 'outline'} onClick={() => setShowRaw(v => !v)} disabled={!selectedDoc}>
            {showRaw ? 'Hide Raw OCR' : 'Show Raw OCR'}
          </Button>
        </Group>
      </Group>

      {error && (
        <Paper withBorder radius="md" p="sm" className="bg-rose-950/30 border-rose-700/60">
          <Text size="sm" c="red">{error}</Text>
        </Paper>
      )}

      <Group align="flex-start" gap="lg" wrap="wrap">
        <Paper withBorder radius="md" className="w-full max-w-md" p="md">
          <Stack gap="sm">
            <input
              placeholder="Search by doc ID, name, filename"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <ScrollArea h={420} offsetScrollbars>
              <Stack gap="xs">
                {loadingDocs && <Text size="sm" c="dimmed">Loading documents…</Text>}
                {!loadingDocs && filteredDocs.length === 0 && <Text size="sm" c="dimmed">No documents found</Text>}
                {filteredDocs.map(doc => {
                  const isActive = doc.id === selectedId;
                  const label = [doc.last, doc.first].filter(Boolean).join(', ') || 'Unknown';
                  return (
                    <Button
                      key={doc.id}
                      size="xs"
                      variant={isActive ? 'filled' : 'subtle'}
                      fullWidth
                      onClick={() => setSelectedId(doc.id)}
                    >
                      <span className="flex-1 text-left truncate">{label || doc.id}</span>
                      <span className="text-[10px] text-slate-300 ml-2 truncate">{doc.id}</span>
                    </Button>
                  );
                })}
              </Stack>
            </ScrollArea>
          </Stack>
        </Paper>

        <Stack gap="md" className="flex-1 min-w-[360px]">
          {!selectedDoc && !loadingDoc && (
            <Paper withBorder radius="md" p="lg" className="text-center">
              <Text size="sm" c="dimmed">Select a document to inspect OCR output.</Text>
            </Paper>
          )}

          {loadingDoc && (
            <Paper withBorder radius="md" p="lg" className="text-center">
              <Text size="sm" c="dimmed">Loading document…</Text>
            </Paper>
          )}

          {selectedDoc && !loadingDoc && (
            <Stack gap="md">
              <Paper withBorder radius="md" p="md">
                <Stack gap="xs">
                  <Group justify="space-between" align="center">
                    <Text size="sm" fw={600}>Document ID</Text>
                    <Code size="xs">{selectedId}</Code>
                  </Group>
                  <Group gap="sm" wrap="wrap">
                    <Badge size="sm" color="blue" variant="light">Pages: {ocrStats.pages}</Badge>
                    <Badge size="sm" color="purple" variant="light">Boxes: {ocrStats.totalBoxes}</Badge>
                    <Badge size="sm" color="green" variant="light">Avg Conf: {formatNumber(ocrStats.avgConf ?? 0)}</Badge>
                    <Badge size="sm" color="teal" variant="light">Text len: {ocrStats.textLength}</Badge>
                    {selectedDoc.confidenceLevel && (
                      <Badge size="sm" color="sky" variant="outline">Confidence: {selectedDoc.confidenceLevel}</Badge>
                    )}
                    {selectedDoc._verification?.status && (() => {
                      const vs = selectedDoc._verification.status;
                      const cfg = {
                        confirmed: { color: 'green', label: 'Verified' },
                        vlm_confirmed: { color: 'teal', label: 'VLM Verified' },
                        auto_corrected: { color: 'orange', label: 'Auto-Corrected' },
                        flagged: { color: 'red', label: 'Flagged' },
                      };
                      const c = cfg[vs] || { color: 'gray', label: vs };
                      return <Badge size="sm" color={c.color} variant="light">{c.label}</Badge>;
                    })()}
                  </Group>
                  <Group justify="space-between" align="center">
                    <Text size="sm" fw={600}>Coverage</Text>
                    <Badge size="sm" color={coverage.percent >= 0.8 ? 'green' : coverage.percent >= 0.5 ? 'yellow' : 'red'} variant="light">
                      {coverage.total ? `${Math.round(coverage.percent * 100)}%` : 'n/a'}
                    </Badge>
                  </Group>
                  {coverage.missingList.length > 0 && (
                    <Text size="xs" c="orange">Missing: {coverage.missingList.join(', ')}</Text>
                  )}
                  <Group justify="flex-start" className="mt-2">
                    <Button size="sm" variant="light" onClick={copyDebugInfo}>
                      📋 Copy All Debug Info
                    </Button>
                    <Text size="xs" c="dimmed">
                      (Includes dual-engine & routing data)
                    </Text>
                  </Group>
                </Stack>
              </Paper>

              {/* Dual-Engine & Routing Info */}
              {(selectedDoc.dualEngine || selectedDoc.routing) && (
                <Paper withBorder radius="md" p="md">
                  <Stack gap="sm">
                    <Text size="sm" fw={600}>Dual-Engine Processing</Text>
                    {selectedDoc.dualEngine ? (
                      <>
                        <Group gap="sm" wrap="wrap">
                          <Badge size="sm" color="purple" variant="light">OCR + LLM</Badge>
                          <Badge size="sm" color="blue" variant="light">
                            Backend: {selectedDoc.dualEngine.llmBackend || 'ollama'}
                          </Badge>
                          {selectedDoc.dualEngine.llm?.pagesProcessed && (
                            <Badge size="sm" color="teal" variant="light">
                              {selectedDoc.dualEngine.llm.pagesProcessed} pages processed
                            </Badge>
                          )}
                          {selectedDoc.dualEngine.llm?.processingTime && (
                            <Badge size="sm" color="cyan" variant="light">
                              {Math.round(selectedDoc.dualEngine.llm.processingTime / 1000)}s
                            </Badge>
                          )}
                        </Group>
                        {selectedDoc.dualEngine.dataQuality && (
                          <Group gap="xs" align="center">
                            <Text size="xs" fw={500}>Quality:</Text>
                            <Badge size="xs" color={selectedDoc.dualEngine.dataQuality.grade === 'A' ? 'green' : selectedDoc.dualEngine.dataQuality.grade === 'F' ? 'red' : 'yellow'}>
                              Grade {selectedDoc.dualEngine.dataQuality.grade} ({selectedDoc.dualEngine.dataQuality.score}/100)
                            </Badge>
                          </Group>
                        )}
                        {selectedDoc.dualEngine.conflicts && selectedDoc.dualEngine.conflicts.length > 0 && (
                          <Text size="xs" c="orange">⚠️ {selectedDoc.dualEngine.conflicts.length} conflict(s) detected</Text>
                        )}
                      </>
                    ) : (
                      <Text size="xs" c="dimmed">OCR-only processing (LLM not enabled)</Text>
                    )}
                    
                    {selectedDoc.routing && (
                      <>
                        <Text size="sm" fw={600} mt="sm">Decision Tree Routing</Text>
                        <Group gap="sm" wrap="wrap">
                          <Badge size="sm" color={
                            selectedDoc.routing.route?.action === 'READY_TO_SCHEDULE' ? 'green' :
                            selectedDoc.routing.route?.action === 'MANUAL_REVIEW' ? 'red' :
                            'yellow'
                          }>
                            {selectedDoc.routing.route?.label || selectedDoc.routing.route?.action}
                          </Badge>
                          {selectedDoc.routing.route?.priority && (
                            <Badge size="sm" color="orange" variant="light">
                              Priority: {selectedDoc.routing.route.priority}
                            </Badge>
                          )}
                          {selectedDoc.routing.route?.estimatedTime && (
                            <Text size="xs" c="dimmed">Est. time: {selectedDoc.routing.route.estimatedTime}</Text>
                          )}
                        </Group>
                        {selectedDoc.routing.route?.validationSummary && (
                          <Group gap="xs" align="center">
                            <Text size="xs" fw={500}>Validation:</Text>
                            <Badge size="xs" color="green" variant="light">{selectedDoc.routing.route.validationSummary.passed} passed</Badge>
                            {selectedDoc.routing.route.validationSummary.failed > 0 && (
                              <Badge size="xs" color="red" variant="light">{selectedDoc.routing.route.validationSummary.failed} failed</Badge>
                            )}
                          </Group>
                        )}
                        {selectedDoc.routing.route?.nextSteps && selectedDoc.routing.route.nextSteps.length > 0 && (
                          <div className="mt-1">
                            <Text size="xs" fw={500} mb={4}>Next Steps:</Text>
                            <Stack gap={2}>
                              {selectedDoc.routing.route.nextSteps.map((step, i) => (
                                <Text key={i} size="xs" c="dimmed">• {step}</Text>
                              ))}
                            </Stack>
                          </div>
                        )}
                      </>
                    )}
                  </Stack>
                </Paper>
              )}

              {/* Verification Details */}
              {selectedDoc._verification && (
                <Paper withBorder radius="md" p="md">
                  <Stack gap="sm">
                    <Group justify="space-between" align="center">
                      <Text size="sm" fw={600}>Verification</Text>
                      {(() => {
                        const vs = selectedDoc._verification.status;
                        const cfg = {
                          confirmed: { color: 'green', label: 'Verified' },
                          vlm_confirmed: { color: 'teal', label: 'VLM Verified' },
                          auto_corrected: { color: 'orange', label: 'Auto-Corrected' },
                          flagged: { color: 'red', label: 'Flagged' },
                        };
                        const c = cfg[vs] || { color: 'gray', label: vs };
                        return <Badge size="sm" color={c.color} variant="light">{c.label}</Badge>;
                      })()}
                    </Group>
                    {selectedDoc._verification.corrections?.length > 0 && (
                      <Stack gap={4}>
                        <Text size="xs" fw={500}>Corrections Applied:</Text>
                        {selectedDoc._verification.corrections.map((corr, i) => (
                          <Group key={i} gap="xs">
                            <Badge size="xs" variant="outline">{corr.field}</Badge>
                            <Text size="xs" c="red" td="line-through">{corr.old || '(empty)'}</Text>
                            <Text size="xs">→</Text>
                            <Text size="xs" c="green" fw={500}>{corr.new || '(empty)'}</Text>
                          </Group>
                        ))}
                      </Stack>
                    )}
                    {selectedDoc._verification.flaggedFields?.length > 0 && (
                      <Stack gap={4}>
                        <Text size="xs" fw={500} c="red">Flagged Fields:</Text>
                        {selectedDoc._verification.flaggedFields.map((f, i) => (
                          <Text key={i} size="xs" c="red">• {f}</Text>
                        ))}
                      </Stack>
                    )}
                  </Stack>
                </Paper>
              )}

              {selectedDoc.pdfModel && (
                <Paper withBorder radius="md" p="md">
                  <Group justify="space-between" align="center" mb="sm">
                    <Text size="sm" fw={600}>Key Fields {editMode && <Badge size="xs" color="yellow" variant="light" className="ml-2">Editing</Badge>}</Text>
                    <Group gap="xs">
                      {!editMode && (
                        <Button size="xs" variant="light" color="blue" onClick={startEdit}>
                          ✏️ Edit & Correct
                        </Button>
                      )}
                      {editMode && (
                        <>
                          <Button size="xs" variant="light" color="gray" onClick={cancelEdit} disabled={savingCorrection}>
                            Cancel
                          </Button>
                          <Button size="xs" variant="filled" color="green" onClick={saveCorrections} disabled={savingCorrection}>
                            {savingCorrection ? 'Saving...' : '💾 Save Corrections'}
                          </Button>
                        </>
                      )}
                    </Group>
                  </Group>
                  <Stack gap="sm" className="mt-2">
                    {/* Reprocess Controls */}
                    <Paper withBorder radius="sm" p="sm" className="bg-slate-900/40 border-slate-700">
                      <Group justify="space-between" align="center" mb="xs">
                        <Text size="xs" fw={600}>Preprocessing Overrides</Text>
                        <Button size="xs" variant="light" onClick={triggerReprocess} disabled={reprocessing || !selectedId}>
                          {reprocessing ? 'Reprocessing…' : 'Reprocess with settings'}
                        </Button>
                      </Group>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div>
                          <Text size="xs" c="dimmed" mb={2}>Mode</Text>
                          <select className="w-full bg-slate-900/70 border border-slate-700 rounded px-2 py-1 text-xs" value={reproc.mode} onChange={e=>setReproc({...reproc, mode: e.target.value})}>
                            <option value="enhanced">enhanced</option>
                            <option value="basic">basic</option>
                            <option value="off">off</option>
                          </select>
                        </div>
                        <div>
                          <Text size="xs" c="dimmed" mb={2}>DPI</Text>
                          <input className="w-full bg-slate-900/70 border border-slate-700 rounded px-2 py-1 text-xs" type="number" min="150" max="600" value={reproc.dpi} onChange={e=>setReproc({...reproc, dpi: e.target.value})} />
                        </div>
                        <div>
                          <Text size="xs" c="dimmed" mb={2}>CLAHE</Text>
                          <select className="w-full bg-slate-900/70 border border-slate-700 rounded px-2 py-1 text-xs" value={reproc.use_clahe} onChange={e=>setReproc({...reproc, use_clahe: e.target.value})}>
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        </div>
                        <div>
                          <Text size="xs" c="dimmed" mb={2}>Bilateral</Text>
                          <select className="w-full bg-slate-900/70 border border-slate-700 rounded px-2 py-1 text-xs" value={reproc.use_bilateral} onChange={e=>setReproc({...reproc, use_bilateral: e.target.value})}>
                            <option value="false">false</option>
                            <option value="true">true</option>
                          </select>
                        </div>
                        <div>
                          <Text size="xs" c="dimmed" mb={2}>Retry Threshold</Text>
                          <input className="w-full bg-slate-900/70 border border-slate-700 rounded px-2 py-1 text-xs" type="number" step="0.01" min="0" max="1" value={reproc.retry_threshold} onChange={e=>setReproc({...reproc, retry_threshold: e.target.value})} />
                        </div>
                      </div>
                      <Text size="xs" c="dimmed" mt={6}>These are debug-only overrides for this document. They do not persist.</Text>
                    </Paper>
                    {!editMode ? (
                      <>
                        <Text size="xs">Patient: {selectedDoc.patient?.last || '—'}, {selectedDoc.patient?.first || '—'} • DOB: {selectedDoc.patient?.dob || '—'}</Text>
                        <Text size="xs">
                          Insurance: {selectedDoc.insurance?.[0]?.carrier || '—'}
                          {learnedFlags.carrier && <Badge size="xs" color="green" variant="light" className="ml-1">learned</Badge>} • Member: {selectedDoc.insurance?.[0]?.memberId || '—'}
                        </Text>
                        <Text size="xs">
                          CPT: {selectedDoc.procedure?.cpt || '—'}
                          {learnedFlags.cpt && <Badge size="xs" color="green" variant="light" className="ml-1">learned</Badge>} • Description: {selectedDoc.procedure?.description || '—'}
                        </Text>
                        <Text size="xs">
                          Provider: {selectedDoc.provider?.name || '—'}
                          {learnedFlags.provider && <Badge size="xs" color="green" variant="light" className="ml-1">learned</Badge>} • NPI: {selectedDoc.provider?.npi || '—'}
                        </Text>
                        {selectedDoc.provider?.practice && (
                          <Text size="xs">
                            Facility: {selectedDoc.provider.practice}
                            {learnedFlags.practice && <Badge size="xs" color="green" variant="light" className="ml-1">learned</Badge>}
                          </Text>
                        )}
                        {(selectedDoc.provider?.phone || selectedDoc.provider?.fax) && (
                          <Text size="xs">
                            Contact: {selectedDoc.provider?.phone ? (<><span>Phone: {selectedDoc.provider.phone}</span>{learnedFlags.providerPhone && <Badge size="xs" color="green" variant="light" className="ml-1">learned</Badge>}</>) : '—'}
                            {selectedDoc.provider?.fax && (
                              <>
                                <span> • Fax: {selectedDoc.provider.fax}</span>
                                {learnedFlags.providerFax && <Badge size="xs" color="green" variant="light" className="ml-1">learned</Badge>}
                              </>
                            )}
                          </Text>
                        )}
                      </>
                    ) : (
                      <>
                        <ScrollArea h={500} offsetScrollbars>
                          <div className="space-y-4 pr-2">
                            {/* Patient Information */}
                            <div className="border-l-2 border-blue-500 pl-3">
                              <Group justify="space-between" align="center" mb="sm">
                                <Text size="sm" fw={600} c="blue">Patient Information</Text>
                                <Badge size="xs" color="red" variant="light">PHI - Not Stored</Badge>
                              </Group>
                              <Text size="xs" c="dimmed" mb="sm">
                                🔒 Edit for this document only. Not saved to learning database (HIPAA compliance).
                              </Text>
                              <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <Text size="xs" fw={500} c="dimmed" mb={4}>Last Name</Text>
                                    <input
                                      type="text"
                                      value={editedFields.patientLast}
                                      onChange={e => setEditedFields({ ...editedFields, patientLast: e.target.value })}
                                      placeholder="Last name"
                                      className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                                    />
                                  </div>
                                  <div>
                                    <Text size="xs" fw={500} c="dimmed" mb={4}>First Name</Text>
                                    <input
                                      type="text"
                                      value={editedFields.patientFirst}
                                      onChange={e => setEditedFields({ ...editedFields, patientFirst: e.target.value })}
                                      placeholder="First name"
                                      className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <Text size="xs" fw={500} c="dimmed" mb={4}>Date of Birth</Text>
                                  <input
                                    type="text"
                                    value={editedFields.patientDob}
                                    onChange={e => setEditedFields({ ...editedFields, patientDob: e.target.value })}
                                    placeholder="MM/DD/YYYY"
                                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Insurance Information */}
                            <div className="border-l-2 border-purple-500 pl-3">
                              <Group justify="space-between" align="center" mb="sm">
                                <Text size="sm" fw={600} c="purple">Insurance Information</Text>
                                <Badge size="xs" color="yellow" variant="light">Partial Learning</Badge>
                              </Group>
                              <Text size="xs" c="dimmed" mb="sm">
                                Carrier name is learned, Member ID is PHI (not stored).
                              </Text>
                              <div className="space-y-3">
                                <div>
                                  <Text size="xs" fw={500} c="dimmed" mb={4}>Carrier</Text>
                                  <input
                                    type="text"
                                    value={editedFields.insuranceCarrier}
                                    onChange={e => setEditedFields({ ...editedFields, insuranceCarrier: e.target.value })}
                                    placeholder="e.g., Aetna, Blue Cross"
                                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                                  />
                                </div>
                                <div>
                                  <Text size="xs" fw={500} c="dimmed" mb={4}>Member ID</Text>
                                  <input
                                    type="text"
                                    value={editedFields.insuranceMemberId}
                                    onChange={e => setEditedFields({ ...editedFields, insuranceMemberId: e.target.value })}
                                    placeholder="Member/Policy ID"
                                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Procedure Information */}
                            <div className="border-l-2 border-green-500 pl-3">
                              <Group justify="space-between" align="center" mb="sm">
                                <Text size="sm" fw={600} c="green">Procedure & Diagnosis</Text>
                                <Badge size="xs" color="green" variant="light">✓ Learned</Badge>
                              </Group>
                              <Text size="xs" c="dimmed" mb="sm">
                                Non-PHI codes - safe to learn from corrections.
                              </Text>
                              <div className="space-y-3">
                                <div>
                                  <Text size="xs" fw={500} c="dimmed" mb={4}>CPT Code</Text>
                                  <input
                                    type="text"
                                    value={editedFields.cptCode}
                                    onChange={e => setEditedFields({ ...editedFields, cptCode: e.target.value })}
                                    placeholder="e.g., 95806"
                                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                                  />
                                </div>
                                <div>
                                  <Text size="xs" fw={500} c="dimmed" mb={4}>ICD-10 Codes (comma-separated)</Text>
                                  <input
                                    type="text"
                                    value={editedFields.icdCodes}
                                    onChange={e => setEditedFields({ ...editedFields, icdCodes: e.target.value })}
                                    placeholder="e.g., G47.33, R06.83"
                                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Provider Information */}
                            <div className="border-l-2 border-orange-500 pl-3">
                              <Group justify="space-between" align="center" mb="sm">
                                <Text size="sm" fw={600} c="orange">Provider Information</Text>
                                <Badge size="xs" color="green" variant="light">✓ Learned</Badge>
                              </Group>
                              <Text size="xs" c="dimmed" mb="sm">
                                Public business info - safe to learn from corrections.
                              </Text>
                              <div className="space-y-3">
                                <div>
                                  <Text size="xs" fw={500} c="dimmed" mb={4}>Provider Name</Text>
                                  <input
                                    type="text"
                                    value={editedFields.providerName}
                                    onChange={e => setEditedFields({ ...editedFields, providerName: e.target.value })}
                                    placeholder="e.g., BEHZAD KERMANI, MD"
                                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                                  />
                                  {selectedDoc.provider?.name && editedFields.providerName !== selectedDoc.provider?.name && (
                                    <Text size="xs" c="orange" mt={2}>
                                      Original: {selectedDoc.provider.name}
                                    </Text>
                                  )}
                                </div>
                                <div>
                                  <Text size="xs" fw={500} c="dimmed" mb={4}>NPI</Text>
                                  <input
                                    type="text"
                                    value={editedFields.providerNpi}
                                    onChange={e => setEditedFields({ ...editedFields, providerNpi: e.target.value })}
                                    placeholder="10-digit NPI"
                                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <Text size="xs" fw={500} c="dimmed" mb={4}>Phone</Text>
                                    <input
                                      type="text"
                                      value={editedFields.providerPhone}
                                      onChange={e => setEditedFields({ ...editedFields, providerPhone: e.target.value })}
                                      placeholder="(xxx) xxx-xxxx"
                                      className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                                    />
                                  </div>
                                  <div>
                                    <Text size="xs" fw={500} c="dimmed" mb={4}>Fax</Text>
                                    <input
                                      type="text"
                                      value={editedFields.providerFax}
                                      onChange={e => setEditedFields({ ...editedFields, providerFax: e.target.value })}
                                      placeholder="(xxx) xxx-xxxx"
                                      className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <Text size="xs" fw={500} c="dimmed" mb={4}>Facility/Practice Name</Text>
                                  <input
                                    type="text"
                                    value={editedFields.facilityName}
                                    onChange={e => setEditedFields({ ...editedFields, facilityName: e.target.value })}
                                    placeholder="e.g., Southern Highlands Medical"
                                    className="w-full rounded-md bg-slate-900/70 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                                  />
                                </div>
                              </div>
                            </div>

                            <Paper withBorder radius="sm" p="sm" className="bg-sky-950/20 border-sky-700/40">
                              <Text size="xs" c="sky" mb="xs">
                                💡 <strong>HIPAA-Compliant Learning:</strong>
                              </Text>
                              <Text size="xs" c="sky">
                                • <strong>Provider/Facility info:</strong> Saved for future learning ✓<br />
                                • <strong>CPT/ICD codes:</strong> Saved (not patient-specific) ✓<br />
                                • <strong>Patient names/DOB/Member ID:</strong> NOT saved (PHI) 🔒<br />
                              </Text>
                            </Paper>
                          </div>
                        </ScrollArea>
                      </>
                    )}
                  </Stack>
                </Paper>
              )}

              {Array.isArray(selectedDoc?.debug?.trace) && selectedDoc.debug.trace.length > 0 && (
                <Paper withBorder radius="md" p="md">
                  <Group justify="space-between" align="center" mb={6}>
                    <Text size="sm" fw={600}>Rule Trace</Text>
                    <Badge size="xs" color="blue" variant="light">{selectedDoc.debug.trace.length} steps</Badge>
                  </Group>
                  <ScrollArea h={200} offsetScrollbars>
                    <JsonInput value={JSON.stringify(selectedDoc.debug.trace, null, 2)} readOnly rows={12} />
                  </ScrollArea>
                </Paper>
              )}

              {selectedDoc && (
                <Paper withBorder radius="md" p="md">
                  <Group justify="space-between" align="center" mb={6}>
                    <Text size="sm" fw={600}>Insurance Inspector</Text>
                    <Badge size="xs" color="purple" variant="light">Member ID candidates</Badge>
                  </Group>
                  <Stack gap="xs">
                    <Text size="xs">Carrier: <strong>{insuranceInspector.carrier || '—'}</strong></Text>
                    <Text size="xs">Chosen Member ID: <strong>{insuranceInspector.chosen || '—'}</strong></Text>
                    {insuranceInspector.candidates.length === 0 ? (
                      <Text size="xs" c="dimmed">No candidates detected.</Text>
                    ) : (
                      <ScrollArea h={160} offsetScrollbars>
                        <JsonInput value={JSON.stringify(insuranceInspector.candidates, null, 2)} readOnly rows={8} />
                      </ScrollArea>
                    )}
                    <Text size="xs" c="dimmed">Debug-only view based on regex heuristics; source of truth is backend extraction.</Text>
                  </Stack>
                </Paper>
              )}

              {selectedDoc && (
                <Paper withBorder radius="md" p="md">
                  <Group justify="space-between" align="center" mb={6}>
                    <Text size="sm" fw={600}>OCR Highlights</Text>
                    <Group gap="xs">
                      <Badge size="xs" color="teal" variant="light">{highlightSpans.length} span{highlightSpans.length === 1 ? '' : 's'}</Badge>
                      <Button
                        size="xs"
                        variant="light"
                        onClick={downloadAnnotatedPdf}
                        disabled={!selectedId || downloadingAnnotated}
                      >
                        {downloadingAnnotated ? 'Preparing…' : 'Download Annotated PDF'}
                      </Button>
                      {/* Patient Report button removed: packets now include Patient Report inline */}
                    </Group>
                  </Group>
                  {highlightSpans.length > 0 ? (
                    <OcrPdfHighlighter
                      pdfUrl={originalPdfUrl}
                      spans={highlightSpans}
                      scopeColors={highlightScopeColors ?? undefined}
                      width={760}
                      showLabels
                    />
                  ) : (
                    <Text size="xs" c="dimmed">No span annotations available for this document.</Text>
                  )}
                  <Text size="xs" c="dimmed" mt={8}>
                    Highlights use PDF coordinates from OCR spans (patient/provider/facility scopes) and update automatically when spans change.
                  </Text>
                </Paper>
              )}

              {showRaw && combinedRawText && (
                <Paper withBorder radius="md" p="md">
                  <Group justify="space-between" align="center" mb={6}>
                    <Text size="sm" fw={600}>Combined Raw OCR</Text>
                    <Group gap="xs">
                      <Badge size="xs" variant="light" color="sky">Length: {combinedRawText.length}</Badge>
                      <Button size="xs" variant="light" onClick={copyCombinedRaw}>Copy</Button>
                    </Group>
                  </Group>
                  <ScrollArea h={220} offsetScrollbars>
                    <Text size="xs" className="whitespace-pre-wrap text-slate-200">{combinedRawText}</Text>
                  </ScrollArea>
                </Paper>
              )}

              {showRaw && Array.isArray(selectedDoc?.ocr) && (
                <Paper withBorder radius="md" p="md">
                  <Group justify="space-between" align="center" mb={6}>
                    <Text size="sm" fw={600}>Raw OCR</Text>
                    <Badge size="xs" variant="light" color="sky">{selectedDoc.ocr.length} pages</Badge>
                  </Group>
                  <Stack gap="md">
                    {selectedDoc.ocr.map(page => (
                      <div key={page.page} className="border border-slate-700 rounded-md p-3 bg-slate-950/40">
                        <Group justify="space-between" align="center" mb={4}>
                          <Text size="xs" fw={600}>Page {page.page}</Text>
                          <Badge size="xs" variant="outline" color="blue">Boxes: {Array.isArray(page.boxes) ? page.boxes.length : 0}</Badge>
                        </Group>
                        <ScrollArea h={180} offsetScrollbars>
                          <Text size="xs" className="whitespace-pre-wrap text-slate-200">{page.text || '—'}</Text>
                        </ScrollArea>
                      </div>
                    ))}
                  </Stack>
                </Paper>
              )}
            </Stack>
          )}
        </Stack>
      </Group>
    </Stack>
  );
}
