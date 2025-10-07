import React, { useEffect, useMemo, useState } from 'react';
import { Button, Group, Stack, Text, Badge, Paper, ScrollArea, JsonInput, Code, Title } from '../ui/primitives.jsx';

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
                </Stack>
              </Paper>

              {selectedDoc.pdfModel && (
                <Paper withBorder radius="md" p="md">
                  <Text size="sm" fw={600}>Key Fields</Text>
                  <Stack gap="xs" className="mt-2">
                    <Text size="xs">Patient: {selectedDoc.patient?.last || '—'}, {selectedDoc.patient?.first || '—'} • DOB: {selectedDoc.patient?.dob || '—'}</Text>
                    <Text size="xs">Insurance: {selectedDoc.insurance?.[0]?.carrier || '—'} • Member: {selectedDoc.insurance?.[0]?.memberId || '—'}</Text>
                    <Text size="xs">CPT: {selectedDoc.procedure?.cpt || '—'} • Description: {selectedDoc.procedure?.description || '—'}</Text>
                    <Text size="xs">Provider: {selectedDoc.provider?.name || '—'} • NPI: {selectedDoc.provider?.npi || '—'}</Text>
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
