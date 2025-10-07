import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Badge, Group, Stack, Text, Code, Paper, ScrollArea, Title, JsonInput, Tooltip, ActionIcon } from '../ui/primitives.jsx';
import { notifications } from '../ui/primitives.jsx';
import { IconBug, IconUpload, IconPlayerPlay, IconFileArrowRight, IconFileImport, IconArrowsMaximize, IconArrowsMinimize, IconRefresh } from '@tabler/icons-react';
import Section from '../components/Section.jsx';
import PlaceholderPanel from '../components/PlaceholderPanel.jsx';

const apiBase = '/api';

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function ReferralPage() {
  const [files, setFiles] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [status, setStatus] = useState(null);
  const [processingStart, setProcessingStart] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [processingDocId, setProcessingDocId] = useState('');
  const [resultsMap, setResultsMap] = useState({});
  const [processedOrder, setProcessedOrder] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState([]);
  const [batchDates, setBatchDates] = useState([]);
  const [showAllAuthNotes, setShowAllAuthNotes] = useState(false);
  const [showRawMap, setShowRawMap] = useState({});
  const [hydratingFromUrl, setHydratingFromUrl] = useState(true);
  const [resetting, setResetting] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const pendingUrlFetch = useRef(null);

  useEffect(() => {
    fetch(`${apiBase}/batch`).then(r => r.ok ? r.json() : Promise.reject())
      .then(j => setBatchDates(Array.isArray(j?.dates) ? j.dates : []))
      .catch(() => setBatchDates([]));
  }, []);

  const pushResult = useCallback((id, data) => {
    setResultsMap(m => ({ ...m, [id]: data }));
    setProcessedOrder(o => o.includes(id) ? o : [id, ...o]);
  }, []);

  useEffect(() => {
    if (processingStart && status && !['done', 'error', 'timeout'].includes(status)) {
      setElapsedMs(Date.now() - processingStart);
      const tick = setInterval(() => {
        setElapsedMs(Date.now() - processingStart);
      }, 1000);
      return () => clearInterval(tick);
    }
    setElapsedMs(0);
    return undefined;
  }, [processingStart, status]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlDocId = params.get('docId');
    if (!urlDocId) {
      setHydratingFromUrl(false);
      return;
    }
    if (resultsMap[urlDocId]) {
      setSelectedId(urlDocId);
      setStatus('done');
      setHydratingFromUrl(false);
      return;
    }
    if (pendingUrlFetch.current === urlDocId) return;
    pendingUrlFetch.current = urlDocId;
    let cancelled = false;
    setError('');
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`${apiBase}/documents/${urlDocId}/result`);
        if (!res.ok) throw new Error('not-ready');
        const data = await res.json();
        if (cancelled) return;
        pushResult(urlDocId, data);
        setSelectedId(urlDocId);
        setStatus('done');
      } catch (err) {
        if (cancelled) return;
        setError('Unable to load document (maybe still processing or not found).');
      } finally {
        if (!cancelled) {
          setLoading(false);
          setHydratingFromUrl(false);
          pendingUrlFetch.current = null;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [location.search, resultsMap, pushResult]);

  useEffect(() => {
    if (hydratingFromUrl) return;
    const params = new URLSearchParams(location.search);
    const current = params.get('docId');
    if (selectedId) {
      if (current === selectedId) return;
      params.set('docId', selectedId);
    } else {
      if (!current) return;
      params.delete('docId');
    }
    const nextSearch = params.toString();
    navigate({ pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '' }, { replace: true });
  }, [selectedId, hydratingFromUrl, location.pathname, location.search, navigate]);

  const selectedDoc = selectedId ? resultsMap[selectedId] : null;
  const confidenceBadge = useMemo(() => {
    if (!selectedDoc?.confidence) return null;
    const level = selectedDoc.confidence;
    const color = level === 'High' ? 'green' : level === 'Medium' ? 'yellow' : 'red';
    return <Badge color={color}>Confidence: {level}</Badge>;
  }, [selectedDoc]);

  async function uploadSingle(fileObj, updateList = true) {
    const fd = new FormData();
    fd.append('file', fileObj, fileObj.name || 'upload.pdf');
    try {
      const res = await fetch(`${apiBase}/documents`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      if (updateList) {
        setBatchProgress(p => p.map(it => 
          it.name === fileObj.name ? { ...it, id: data.id, status: 'submitted', error: undefined } : it
        ));
      }
      setProcessingDocId(data.id);
      setProcessingStart(Date.now());
      pollStatus(
        data.id,
        st => {
          if (updateList) {
            setBatchProgress(p => p.map(it => it.id === data.id ? { ...it, status: st } : it));
          }
          setStatus(st);
          if (st === 'processing' || st === 'submitted' || st === 'queued') {
            setProcessingStart(prev => prev || Date.now());
          }
        },
        err => {
          if (updateList) {
            setBatchProgress(p => p.map(it => it.id === data.id ? { ...it, status: 'error', error: err } : it));
          }
          setStatus('error');
          setProcessingStart(null);
          setProcessingDocId('');
        }
      );
      return data.id;
    } catch (e) {
      if (updateList) {
        setBatchProgress(p => p.map(it => 
          it.name === fileObj.name ? { ...it, status: 'error', error: e.message || 'upload-error' } : it
        ));
      }
      setStatus('error');
      setProcessingStart(null);
      setProcessingDocId('');
      return null;
    }
  }

  async function upload() {
    if (!files.length) return;
    setError('');
    setLoading(true);
    const first = files[0];
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
    if (!processingStart) setProcessingStart(Date.now());
    let delay = 2600 + Math.random() * 400;
    let consecutive429 = 0;

    while (tries < maxTries) {
      try {
        const r = await fetch(`${apiBase}/documents/${id}/status`);
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
        onUpdate?.(st);

        if (st === 'done') {
          setStatus('done');
          setProcessingStart(null);
          setProcessingDocId(prev => (prev === id ? '' : prev));
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
          setStatus('error');
          setProcessingStart(null);
          setProcessingDocId(prev => (prev === id ? '' : prev));
          onError?.(js.error || 'pipeline-error');
          return 'error';
        }
        delay = Math.min(delay * 1.18 + 320, 12000);
        await sleep(delay);
      } catch (e) {
        onUpdate?.('net-error');
        setStatus('net-error');
        delay = Math.min(delay * 1.4 + 500, 15000);
        tries++;
        await sleep(delay);
      }
      tries++;
    }
    onError?.('timeout');
    setStatus('timeout');
    setProcessingStart(null);
    setProcessingDocId(prev => (prev === id ? '' : prev));
    return 'timeout';
  }

  async function fetchDebug(id) {
    if (!id) return;
    try {
      const r = await fetch(`${apiBase}/documents/${id}/result?debug=1`);
      if (!r.ok) throw new Error();
      const js = await r.json();
      setResultsMap(m => ({ ...m, [id]: { ...(m[id] || {}), ...js } }));
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

  async function resetDocuments() {
    if (resetting) return;
    if (typeof window !== 'undefined' && !window.confirm('Reset all processed documents?')) return;
    setError('');
    setResetting(true);
    try {
      const res = await fetch(`${apiBase}/admin/documents/reset`, { method: 'POST' });
      if (!res.ok) throw new Error();
      setFiles([]);
      setResultsMap({});
      setProcessedOrder([]);
      setSelectedId('');
      setStatus(null);
      setBatchProgress([]);
      setProcessingDocId('');
      setProcessingStart(null);
      setElapsedMs(0);
      setShowAllAuthNotes(false);
      setShowRawMap({});
      notifications.show({
        title: 'Documents reset',
        message: 'Document store cleared successfully.',
        color: 'green',
        autoClose: 1500
      });
    } catch (e) {
      notifications.show({
        title: 'Reset failed',
        message: 'Unable to reset documents.',
        color: 'red'
      });
    } finally {
      setResetting(false);
      if (pendingUrlFetch.current) pendingUrlFetch.current = null;
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

    return (
      <Stack gap="lg" className="border-t border-slate-700/60 pt-2.5">
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
              <Badge color={status === 'done' ? 'green' : status === 'error' ? 'red' : status === 'timeout' ? 'yellow' : 'blue'}>
                {status}
              </Badge>
            )}
            {confidenceBadge}
          </Group>
          {processingStart && status && !['done', 'error', 'timeout'].includes(status) && (
            <Text size="xs" c="dimmed">
              {processingDocId ? `Doc ${processingDocId}` : 'Processing'} • {formatDuration(elapsedMs)} • {status}
            </Text>
          )}
        </Group>
      </Paper>

      <div className="grid gap-6 lg:gap-8 grid-cols-1 md:grid-cols-12">
        <div className="md:col-span-4 lg:col-span-3">
          <Paper shadow="sm" p="xl" withBorder radius="lg" className="h-full">
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
                <Button
                  size="xs"
                  variant="outline"
                  color="red"
                  fullWidth
                  leftSection={<IconRefresh size={14} />}
                  onClick={resetDocuments}
                  disabled={loading || resetting}
                  loading={resetting}
                >
                  Reset Documents
                </Button>
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
                        className="border-b border-slate-700/60 pb-0.5"
                      >
                        <Button
                          variant={it.id === selectedId ? 'light' : 'subtle'}
                          size="compact-xs"
                          className="flex-1 min-w-0 overflow-hidden text-ellipsis justify-start"
                          onClick={() => {
                            if (it.id && resultsMap[it.id]) {
                              setSelectedId(it.id);
                            }
                          }}
                          disabled={!it.id || !resultsMap[it.id]}
                        >
                          {it.name}
                        </Button>
                        <Badge
                          size="xs"
                          variant="light"
                          color={
                            it.status === 'done'
                              ? 'green'
                              : it.status === 'error'
                              ? 'red'
                              : it.status === 'rate-limit'
                              ? 'orange'
                              : it.status === 'processing' || it.status === 'submitted'
                              ? 'blue'
                              : 'gray'
                          }
                        >
                          {it.status}
                        </Badge>
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

        <div className="md:col-span-8 lg:col-span-9">
          <Paper shadow="sm" p="xl" withBorder radius="lg" style={{ minHeight: 400 }}>
            <Stack gap="md">
              <Group justify="space-between" mb="xs">
                <Text size="sm" fw={600} c="dimmed" tt="uppercase">
                  Processed
                </Text>
                {processedOrder.length > 0 && (
                  <Badge variant="light" size="sm">{processedOrder.length}</Badge>
                )}
              </Group>

              {processedOrder.length === 0 && <PlaceholderPanel loading={loading} />}

              {processedOrder.length > 0 && (
                <ScrollArea h={750} offsetScrollbars>
                  <Stack gap="sm">
                    {processedOrder.map(pid => {
                      const r = resultsMap[pid];
                      if (!r) return null;
                      const patientName = [r?.patient?.last, r?.patient?.first].filter(Boolean).join(', ') || '—';
                      const primaryCpt = r?.procedure?.cpt || '—';
                      const conf = r?.confidence || r?.confidenceLevel;
                      const actions = r?.alerts?.actions || [];
                      const isSelected = selectedId === pid;
                      const showRaw = !!showRawMap[pid];

                      return (
                        <Paper
                          key={pid}
                          withBorder
                          radius="md"
                          p="sm"
                          className={isSelected ? 'bg-slate-800/80 border-sky-500/40' : ''}
                        >
                          <Stack gap={6}>
                            <Group justify="space-between" align="flex-start" wrap="nowrap" gap={8}>
                              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                                <Text
                                  size="xs"
                                  fw={600}
                                  style={{ cursor: 'pointer' }}
                                  onClick={() => setSelectedId(p => (p === pid ? '' : pid))}
                                >
                                  {patientName}
                                </Text>
                                <Text size="xs" c="dimmed">
                                  CPT: {primaryCpt}
                                  {conf && ` • ${conf}`}
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
