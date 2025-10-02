import React, { useEffect, useMemo, useState } from 'react';
import { Button, Badge, Group, Stack, Text, Code, Paper, Divider, ScrollArea, Title, JsonInput, Tooltip, ActionIcon, Skeleton, Grid } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBug, IconUpload, IconPlayerPlay, IconFileArrowRight, IconFileImport, IconArrowsMaximize, IconArrowsMinimize } from '@tabler/icons-react';
import Section from '../components/Section.jsx';
import PlaceholderPanel from '../components/PlaceholderPanel.jsx';

const apiBase = '/api';

export default function ReferralPage() {
  const [file, setFile] = useState(null);
  const [docId, setDocId] = useState('');
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [debugTrace, setDebugTrace] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [batchDates, setBatchDates] = useState([]);
  const [showAllAuthNotes, setShowAllAuthNotes] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  function downloadJson() {
    if (!result) return;
    const dataStr = JSON.stringify(result, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const suggested = result?.documentMeta?.suggestedFilename?.replace(/\.pdf$/i,'') || docId || 'referral';
    a.href = url;
    a.download = `${suggested}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url), 500);
  }

  useEffect(() => {
    fetch(`${apiBase}/batch`).then(r => r.ok ? r.json() : Promise.reject())
      .then(j => setBatchDates(Array.isArray(j?.dates) ? j.dates : []))
      .catch(() => setBatchDates([]));
  }, []);

  const confidenceBadge = useMemo(() => {
    if (!result?.confidence) return null;
    const level = result.confidence;
    const color = level === 'High' ? 'green' : level === 'Medium' ? 'yellow' : 'red';
    return <Badge color={color}>Confidence: {level}</Badge>;
  }, [result]);

  async function upload() {
    setError(''); setResult(null); setLoading(true);
    if (!(file instanceof Blob)) { setError('Select a PDF first'); setLoading(false); return; }
    const fd = new FormData(); fd.append('file', file, file.name || 'upload.pdf');
    try {
      const res = await fetch(`${apiBase}/documents`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json(); setDocId(data.id); pollStatus(data.id);
    } catch (e) { setError(e.message || 'Upload failed'); setLoading(false); }
  }

  async function pollStatus(id) {
    setStatus('processing'); let tries = 0; const maxTries = 40;
    while (tries < maxTries) {
      try {
        const r = await fetch(`${apiBase}/documents/${id}/status`);
        if (!r.ok) throw new Error('Status fetch failed');
        const js = await r.json(); setStatus(js.status);
        if (js.status === 'done') {
          const rr = await fetch(`${apiBase}/documents/${id}/result`);
          if (!rr.ok) throw new Error('Result fetch failed');
          const data = await rr.json(); setResult(data); setDebugTrace(data?.debug?.trace || []); setLoading(false);
          notifications.show({ title: 'Extraction complete', message: `Document ${id} processed`, color: 'green', autoClose: 2000 });
          return;
        }
        if (js.status === 'error') { setError(js.error || 'Processing error'); setLoading(false); return; }
      } catch (e) { setError(e.message || 'Network error'); setLoading(false); return; }
      tries++; await new Promise(r => setTimeout(r, 800 + tries * 200));
    }
    setError('Client timeout'); setLoading(false);
  }

  async function fetchDebug() {
    if (!docId) return;
    try {
      const r = await fetch(`${apiBase}/documents/${docId}/result?debug=1`);
      if (!r.ok) throw new Error('Debug fetch failed');
      const js = await r.json(); setResult(js); setDebugTrace(js?.debug?.trace || []);
    } catch {
      notifications.show({ title: 'Debug load failed', color: 'red', message: 'Could not fetch trace' });
    }
  }

  async function loadSample() {
    setError(''); setResult(null); setLoading(true);
    try {
      const r = await fetch(`${apiBase}/fixtures/titration_auto_approve`);
      if (!r.ok) throw new Error('Sample not available');
      const js = await r.json(); setResult(js); setStatus('done'); setDocId('sample');
      notifications.show({ title: 'Sample loaded', message: 'Sample referral loaded successfully', color: 'blue', autoClose: 1800 });
    } catch {
      setError('Sample failed');
      notifications.show({ title: 'Sample failed', message: 'Could not load sample', color: 'red' });
    } finally { setLoading(false); }
  }

  return (
    <Stack gap="xl">
      <Paper p="xl" withBorder radius="lg" shadow="sm">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Title order={3}>Referral Intake</Title>
          <Group gap="xs">
            {docId && <Badge variant="outline">ID: {docId}</Badge>}
            {status && <Badge color={status==='done'?'green':status==='error'?'red':'blue'}>{status}</Badge>}
            {confidenceBadge}
          </Group>
        </Group>
      </Paper>
      <Grid gutter="xl" align="stretch">
        <Grid.Col span={{ base: 12, md: 4, lg: 3 }}>
          <Paper shadow="sm" p="xl" withBorder radius="lg" style={{ height: '100%' }}>
            <Stack gap="lg">
              <div>
                <Text size="sm" fw={600} c="dimmed" tt="uppercase" mb="md" className="section-heading">Actions</Text>
                <Stack gap="md">
                  <Button leftSection={<IconUpload size={16} />} variant="light" component="label" size="sm" fullWidth>
                    {file ? file.name : 'Select PDF'}
                    <input type="file" hidden accept="application/pdf" onChange={e=>setFile(e.target.files?.[0]||null)} />
                  </Button>
                  <Group gap="xs">
                    <Button size="xs" onClick={upload} leftSection={<IconPlayerPlay size={14} />} disabled={!file || loading} loading={loading}>Process</Button>
                    <Button size="xs" variant="outline" onClick={loadSample} leftSection={<IconFileArrowRight size={14} />} disabled={loading}>Sample</Button>
                  </Group>
                  {error && <Badge color="red" variant="light">{error}</Badge>}
                </Stack>
              </div>

              <Divider />

              <div>
                <Text size="sm" fw={600} c="dimmed" tt="uppercase" mb="md" className="section-heading">Batch Dates</Text>
                <ScrollArea h={150} offsetScrollbars>
                  <Stack gap="xs">
                    {batchDates.length === 0 && <Text size="sm" c="dimmed">None</Text>}
                    {batchDates.map(d => (
                      <Group key={d} gap="xs" wrap="nowrap">
                        <Code size="xs">{d}</Code>
                        <ActionIcon variant="subtle" size="sm" component="a" href={`${apiBase}/batch/${d}/cover.pdf`} target="_blank">
                          <IconFileImport size={14} />
                        </ActionIcon>
                      </Group>
                    ))}
                  </Stack>
                </ScrollArea>
              </div>
            </Stack>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8, lg: 9 }}>
          <Paper shadow="sm" p="xl" withBorder radius="lg" style={{ minHeight: 400 }}>
            <Group justify="space-between" mb="lg">
              <Text size="sm" fw={600} c="dimmed" tt="uppercase" className="section-heading">Result</Text>
              <Tooltip label="Fetch debug trace">
                <ActionIcon onClick={fetchDebug} variant="light" disabled={!docId}>
                  <IconBug size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>

            {!result && <PlaceholderPanel loading={loading} />}
            {result && (
              <Stack gap="xl">
                <Section title="Patient">
                  <Text size="sm">{result.patient?.last}, {result.patient?.first} • DOB {result.patient?.dob}</Text>
                  {Array.isArray(result.patient?.phones) && result.patient.phones.length > 0 && (
                    <Text size="xs" c="dimmed">Phones: {result.patient.phones.join(', ')}</Text>
                  )}
                  {result.patient?.email && <Text size="xs">Email: {result.patient.email}</Text>}
                </Section>

                <Section title="Procedure">
                  <Text size="sm">CPT: {result.procedure?.cpt} {result.procedure?.description && `— ${result.procedure.description}`}</Text>
                  {Array.isArray(result.procedure?.cptDetails) && result.procedure.cptDetails.length > 1 && (
                    <Stack gap="xs" mt="sm">
                      {result.procedure.cptDetails.map(d => (
                        <Group key={d.code} gap="sm" align="flex-start">
                          <Code size="xs">{d.code}</Code>
                          <Text size="xs">{d.intent}{d.why && d.why !== 'pattern_match' ? ` / ${d.why}` : ''}</Text>
                        </Group>
                      ))}
                    </Stack>
                  )}
                </Section>

                <Section title="Insurance">
                  {Array.isArray(result.insurance) && result.insurance.length > 0 ? (
                    <Stack gap="xs">
                      {result.insurance.map((c,i)=>(
                        <Text size="sm" key={i}>{c.carrier}{c.memberId && ` • ID: ${c.memberId}`}{c.groupId && ` • Group: ${c.groupId}`}</Text>
                      ))}
                    </Stack>
                  ) : <Text size="sm">—</Text>}
                </Section>

                <Section title="Clinical">
                  {result.clinical?.primaryDiagnosis && (
                    <Text size="sm">Primary Dx: {result.clinical.primaryDiagnosis.code}{result.clinical.primaryDiagnosis.description && ` — ${result.clinical.primaryDiagnosis.description}`}</Text>
                  )}
                  {Array.isArray(result.clinical?.symptoms) && result.clinical.symptoms.length > 0 && (
                    <Text size="xs" c="dimmed">Symptoms: {result.clinical.symptoms.join(', ')}</Text>
                  )}
                </Section>
                {(result.flags || result.alerts) && (
                  <Section title="Quality & Actions">
                    {result.flags?.verifyManually && <Badge color="orange" variant="light">Manual Review</Badge>}
                    
                    {Array.isArray(result.flags?.reasons) && result.flags.reasons.length > 0 && (
                      <div>
                        <Text size="xs" fw={500} mb="xs">Reasons</Text>
                        <Stack gap={0}>
                          {result.flags.reasons.map((r,i)=><Text size="xs" key={i}>• {r}</Text>)}
                        </Stack>
                      </div>
                    )}
                    
                    {Array.isArray(result.alerts?.actions) && result.alerts.actions.length > 0 && (
                      <div>
                        <Text size="xs" fw={500} mb="xs">Actions</Text>
                        <Stack gap={0}>
                          {result.alerts.actions.map((a,i)=><Text size="xs" key={i}>• {a}</Text>)}
                        </Stack>
                      </div>
                    )}
                    
                    {Array.isArray(result.documentMeta?.authorizationNotes) && result.documentMeta.authorizationNotes.length > 0 && (
                      <div>
                        <Group justify="space-between" align="flex-start" mb="xs">
                          <Text size="xs" fw={500}>Auth Notes</Text>
                          {result.documentMeta.authorizationNotes.length > 4 && (
                            <Button size="compact-xs" variant="subtle" onClick={()=>setShowAllAuthNotes(v=>!v)}>
                              {showAllAuthNotes ? 'Collapse' : `Show All (${result.documentMeta.authorizationNotes.length})`}
                            </Button>
                          )}
                        </Group>
                        <Stack gap={0}>
                          {(showAllAuthNotes ? result.documentMeta.authorizationNotes : result.documentMeta.authorizationNotes.slice(0,4)).map((n,i)=>(
                            <Text size="xs" key={i}>• {n}</Text>
                          ))}
                        </Stack>
                      </div>
                    )}
                  </Section>
                )}
                {Array.isArray(debugTrace) && debugTrace.length > 0 && (
                  <Section title="Debug Trace">
                    <ScrollArea h={160} offsetScrollbars>
                      <Stack gap="xs">
                        {debugTrace.map((t,i)=><Code key={i} size="xs">{t.rule}</Code>)}
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
                        variant={showRawJson ? 'default' : 'outline'}
                        leftSection={showRawJson ? <IconArrowsMinimize size={14} /> : <IconArrowsMaximize size={14} />}
                        onClick={()=>setShowRawJson(v=>!v)}
                      >
                        {showRawJson ? 'Collapse' : 'Expand'}
                      </Button>
                      <Button size="xs" variant="light" onClick={downloadJson} disabled={!result}>JSON</Button>
                      <Button
                        size="xs"
                        variant="light"
                        onClick={async ()=>{
                          if (!docId) return;
                          try {
                            const resp = await fetch(`/api/documents/${docId}/summary.pdf`);
                            if (!resp.ok) throw new Error('download failed');
                            const cd = resp.headers.get('content-disposition') || '';
                            let fname = 'Referral_Summary.pdf';
                            const m = cd.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
                            if (m) fname = decodeURIComponent(m[1] || m[2]);
                            const blob = await resp.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
                            setTimeout(()=>URL.revokeObjectURL(url), 1500);
                          } catch (e) {
                            // eslint-disable-next-line no-console
                            console.error('pdf download error', e);
                          }
                        }}
                        disabled={!docId}
                      >PDF</Button>
                    </Group>
                  }
                >
                  {!showRawJson && (
                    <Text size="xs" c="dimmed">
                      Collapsed • {Object.keys(result || {}).length} top-level keys
                    </Text>
                  )}
                  {showRawJson && (
                    <ScrollArea style={{ maxHeight: '65vh' }} offsetScrollbars>
                      <JsonInput
                        value={JSON.stringify(result,null,2)}
                        readOnly
                        autosize={false}
                        minRows={28}
                        styles={{ input: { fontSize: 12, minHeight: '520px', resize: 'vertical', lineHeight: 1.4 } }}
                      />
                    </ScrollArea>
                  )}
                </Section>
              </Stack>
            )}
          </Paper>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

// Local Section removed; using shared Section component.
