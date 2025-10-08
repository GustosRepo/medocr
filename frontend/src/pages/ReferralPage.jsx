import React, { useEffect, useMemo, useState } from 'react';
import { Button, Badge, Group, Stack, Text, Code, Paper, ScrollArea, Title, JsonInput, Tooltip, ActionIcon, Checkbox } from '../ui/primitives.jsx';
import { notifications } from '../ui/primitives.jsx';
import { IconBug, IconUpload, IconPlayerPlay, IconFileArrowRight, IconFileImport, IconArrowsMaximize, IconArrowsMinimize } from '@tabler/icons-react';
import { getStatusBadgeColor } from '../ui/utils.js';
import Section from '../components/Section.jsx';
import PlaceholderPanel from '../components/PlaceholderPanel.jsx';

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
  // Build marker for cache/debug: update this string to verify reloads
  console.log('[ReferralPage] build marker v1-dark-cards ' + new Date().toISOString());
  const [files, setFiles] = useState([]);
  const [selectedId, setSelectedId] = useState('');
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

  function pushResult(id, data) {
    setResultsMap(m => ({ ...m, [id]: data }));
    setProcessedOrder(o => o.includes(id) ? o : [id, ...o]);
  }

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
    for (const id of ids) {
      const a = document.createElement('a');
      a.href = `/api/documents/${id}/summary.pdf`;
  const doc = resultsMap[id];
  const base = doc?.documentMeta?.suggestedFilename?.replace(/\.pdf$/i, '') || id;
  a.download = `${base}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      // small throttle so browser queues sanely
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, 140));
    }
    notifications.show({ title: 'Downloads started', message: `${ids.length} PDFs`, color: 'blue', autoClose: 1400 });
  }

  const selectedDoc = selectedId ? resultsMap[selectedId] : null;
  const confidenceBadge = useMemo(() => {
    if (!selectedDoc?.confidence) return null;
    const level = selectedDoc.confidence;
    const color = level === 'High' ? 'green' : level === 'Medium' ? 'yellow' : 'red';
    return <Badge color={color}>Confidence: {level}</Badge>;
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
    const maxTries = 80;
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
              if (!selectedId) setSelectedId(id);
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

  function Details({ docId, doc }) {
    if (!doc) return null;
    const showRaw = !!showRawMap[docId];
    const conf = doc?.confidence || doc?.confidenceLevel;

    return (
  <Stack gap={16} style={{ borderTop: '1px solid #2a323c', paddingTop: 10 }}>
        <Section title="Patient">
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
        </Section>

        <Section title="Procedure">
          <Text size="sm">
            CPT: {doc.procedure?.cpt} {doc.procedure?.description && `— ${doc.procedure.description}`}
          </Text>
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
        </Section>

        <Section title="Insurance">
          {Array.isArray(doc.insurance) && doc.insurance.length > 0 ? (
            <Stack gap="xs">
              {doc.insurance.map((c, i) => (
                <Text size="sm" key={i}>
                  {c.carrier}
                  {c.memberId && ` • ID: ${c.memberId}`}
                  {c.groupId && ` • Group: ${c.groupId}`}
                </Text>
              ))}
            </Stack>
          ) : (
            <Text size="sm">—</Text>
          )}
        </Section>

        <Section title="Clinical Information">
          <Stack gap={4}>
            {doc.clinical?.primaryDiagnosis && (
              <Text size="sm">
                Primary Diagnosis: {doc.clinical.primaryDiagnosis.code}
                {doc.clinical.primaryDiagnosis.description && ` — ${doc.clinical.primaryDiagnosis.description}`}
              </Text>
            )}
            {Array.isArray(doc.clinical?.symptoms) && doc.clinical.symptoms.length > 0 && (
              <Text size="xs" c="dimmed">
                Symptoms Present: {doc.clinical.symptoms.join(', ')}
              </Text>
            )}
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
        </Section>

        <Section title="Referring Physician">
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
                href={`/api/documents/${docId}/summary.pdf`}
                target="_blank"
                disabled={!doc}
              >
                PDF
              </Button>
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
                      <>
                        <Badge variant="light" size="sm">{processedOrder.length}</Badge>
                        <div className="hidden md:flex items-center gap-1">
                          <button
                            type="button"
                            className="px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 border border-slate-500 disabled:opacity-40"
                            disabled={doneIds.length === 0}
                            onClick={() => exportZip(doneIds)}
                            title="Export all done packets"
                          >Packets</button>
                          <button
                            type="button"
                            className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 border border-slate-600"
                            onClick={() => { setSelectMode(true); clearSelection(); }}
                            title="Select subset"
                          >Select</button>
                      </div>
                        <Tooltip label="Export all packets as ZIP" position="bottom">
                          <Button
                            size="compact-xs"
                            variant="default"
                            disabled={doneIds.length === 0}
                            onClick={() => exportZip(doneIds)}
                          >
                            Export Packets
                          </Button>
                        </Tooltip>
                        <Tooltip label="Select specific docs to export">
                          <Button
                            size="compact-xs"
                            variant="light"
                            onClick={() => { setSelectMode(true); clearSelection(); }}
                          >
                            Select
                          </Button>
                        </Tooltip>
                      </>
                    )}
                    {selectMode && (
                      <Group gap={4} wrap="nowrap">
                        <Badge size="sm" variant="outline" color={selectedExportIds.size ? 'blue' : 'gray'}>
                          {selectedExportIds.size}/{doneIds.length}
                        </Badge>
                        <Button size="compact-xs" variant="light" disabled={!selectedExportIds.size} onClick={() => exportZip(Array.from(selectedExportIds))}>Packets</Button>
                        <Tooltip label="Download each PDF (no ZIP)">
                          <Button size="compact-xs" variant="subtle" disabled={!selectedExportIds.size} onClick={() => exportIndividual(Array.from(selectedExportIds))}>PDFs</Button>
                        </Tooltip>
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
                                  {r?._placeholder ? (r._uploading ? 'Uploading…' : 'Processing…') : (
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

    </Stack>
  );
}
