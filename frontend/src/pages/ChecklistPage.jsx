import React, { useEffect, useState, useCallback } from 'react';
import { Group, Text, Badge, Button, Stack, ActionIcon, Tooltip, Loader, ScrollArea, Card, SimpleGrid, CopyButton, Divider, Textarea, SegmentedControl, MultiSelect, Switch } from '@mantine/core';
import { IconRefresh, IconFileText, IconEye, IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import Section from '../components/Section.jsx';

function statusColor(s) {
  switch (s) {
    case 'done': return 'green';
    case 'processing': return 'yellow';
    case 'queued': return 'blue';
    case 'error': return 'red';
    default: return 'gray';
  }
}

function categoryMeta(r, overrideCat) {
  const map = {
    error: { label: 'Error', color: 'red', tone: 'rgba(255,0,0,0.15)', border: '#ff6b6b' },
    processing: { label: 'Processing', color: 'blue', tone: 'rgba(70,130,180,0.15)', border: '#339af0' },
    attention: { label: 'Needs Attention', color: 'orange', tone: 'rgba(255,165,0,0.18)', border: '#ffa94d' },
    ready: { label: 'Ready to Schedule', color: 'green', tone: 'rgba(0,128,0,0.18)', border: '#69db7c' }
  };
  if (overrideCat && map[overrideCat]) return map[overrideCat];
  if (r.status === 'error') return map.error;
  if (r.status === 'queued' || r.status === 'processing') return map.processing;
  const needs = r.manual || (r.actions||[]).length > 0;
  if (needs) return map.attention;
  return map.ready;
}

export default function ChecklistPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [textView, setTextView] = useState('');
  const [overrides, setOverrides] = useState({}); // id -> { note, category }
  const [statusFilter, setStatusFilter] = useState([]); // array of categories
  const [insuranceFilter, setInsuranceFilter] = useState([]); // carriers
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState({}); // id -> bool (false means collapsed)

  const buildText = useCallback((data)=>{
    if (!data) return '';
    const lines = ['PATIENT CHECKLIST:',''];
    for (const item of data.items || []) {
      const line1 = `\u25A1 ${item.name} | DOB: ${item.dob} | Insurance: ${item.insurance} | ID: ${item.memberId}`;
      const acts = (item.actions||[]).join('; ');
      const line2 = `   Additional Actions Required: ${item.none ? 'None' : (acts || 'None')}`;
      lines.push(line1, line2, '');
    }
    lines.push('COMMON ADDITIONAL ACTIONS:');
    lines.push('- "No chart notes/insurance verification required" → Generate insurance verification form');
    lines.push('- "Insufficient information - sleep questionnaire required, call patient"');
    lines.push('- "Wrong test ordered - need order for complete sleep study due to no testing in last 5 years"');
    lines.push('- "Out of network - fax UTS" → Generate UTS referral form');
    lines.push('- "Authorization required - submit/fax request" → Generate authorization form');
    lines.push('- "Missing demographics - call provider for complete patient information"');
    lines.push('- "Provider follow-up required - obtain additional clinical documentation"');
    lines.push('- "Insurance expired/terminated - verify current coverage"');
    lines.push('- "Pediatric specialist referral required"');
    lines.push('- "DME evaluation needed before testing"','');
    lines.push('FORMS GENERATED:');
    lines.push(`\u25A1 Insurance verification forms: ${data.forms.insuranceVerification}`);
    lines.push(`\u25A1 Authorization request forms: ${data.forms.authorizationRequests}`);
    lines.push(`\u25A1 UTS referral forms: ${data.forms.utsReferrals}`);
    lines.push(`\u25A1 Provider follow-up requests: ${data.forms.providerFollowUps}`);
    lines.push(`\u25A1 Patient contact forms: ${data.forms.patientContacts}`,'');
    lines.push(`TOTAL REFERRALS PROCESSED: ${data.totals.processed}`);
    lines.push(`READY TO SCHEDULE: ${data.totals.readyToSchedule}`);
    lines.push(`ADDITIONAL ACTIONS REQUIRED: ${data.totals.additionalActions}`);
    return lines.join('\n');
  },[]);

  const load = useCallback(async ()=>{
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit','300');
      if (statusFilter.length) params.set('status', statusFilter.join(','));
      if (insuranceFilter.length) params.set('insurance', insuranceFilter.join(','));
      if (showArchived) params.set('includeArchived','1');
      const resp = await fetch(`/api/checklist?${params.toString()}`);
      if (!resp.ok) throw new Error('Failed to load checklist');
      const json = await resp.json();
      setRows(json.items || []);
      const ov = {};
      (json.items||[]).forEach(it=>{ if (it.override) ov[it.id] = it.override; });
      setOverrides(ov);
    } catch (e) {
      setError(String(e.message||e));
    } finally { setLoading(false); }
  }, []);

  useEffect(()=>{ load(); }, [load]);
  useEffect(()=>{ // reload when filters change
    load();
  }, [statusFilter, insuranceFilter, showArchived]);
  useEffect(()=>{
    if (!autoRefresh) return;
    const id = setInterval(()=> load().catch(()=>{}), 5000);
    return ()=> clearInterval(id);
  }, [autoRefresh, load]);
  useEffect(()=>{ // refresh textual view when rows change via /api/checklist for authoritative counts
    (async ()=>{ try { const r = await fetch('/api/checklist'); if (r.ok){ const j = await r.json(); setTextView(buildText(j)); } } catch{} })();
  }, [rows, buildText]);

  return (
    <Stack gap="md">
      <Section title="Checklist" actions={
        <Group gap={8} wrap="wrap">
          <Group gap={6} wrap="nowrap">
            <Button size="xs" variant={autoRefresh ? 'default':'outline'} onClick={()=>setAutoRefresh(a=>!a)}>{autoRefresh?'Auto':'Manual'}</Button>
            <ActionIcon size="sm" variant="subtle" onClick={()=>load()} disabled={loading}><IconRefresh size={16} /></ActionIcon>
          </Group>
          <MultiSelect
            size="xs"
            searchable
            placeholder="Filter status"
            data={['ready','attention','processing','error'].map(v=>({value:v,label:v}))}
            value={statusFilter}
            onChange={setStatusFilter}
            clearable
            style={{ minWidth:180 }}
          />
          <MultiSelect
            size="xs"
            searchable
            placeholder="Filter insurance"
            data={Array.from(new Set(rows.map(r=>r.insurance).filter(Boolean))).sort().map(c=>({value:c?.toLowerCase()||'', label:c}))}
            value={insuranceFilter}
            onChange={setInsuranceFilter}
            clearable
            style={{ minWidth:220 }}
          />
          <Switch size="xs" checked={showArchived} onChange={e=>setShowArchived(e.currentTarget.checked)} label="Show Archived" />
        </Group>
      }>
        {error && <Text c="red" size="xs" mb="xs">{error}</Text>}
        <Group gap={8} mb="xs" wrap="wrap">
          <Badge size="xs" color="green" variant="light">Ready to Schedule</Badge>
          <Badge size="xs" color="orange" variant="light">Needs Attention</Badge>
          <Badge size="xs" color="blue" variant="light">Processing</Badge>
          <Badge size="xs" color="red" variant="light">Error</Badge>
        </Group>
  {/* Removed ScrollArea to allow full-height giant list */}
  <div style={{ display:'flex', flexWrap:'wrap', gap:18, alignItems:'stretch', minWidth: 0 }}>
            {rows.map(r=>{
              const name = [r.last, r.first].filter(Boolean).join(', ') || '—';
              const acts = (r.actions||[]);
              const needs = r.manual || acts.length > 0;
              const override = overrides[r.id];
              // Base category from live data
              const effCategory = override?.category || null;
              const cat = categoryMeta(r, effCategory);
              const isExpanded = expanded[r.id] !== false; // default expanded
              return (
                <Card
                  key={r.id}
                  radius="md"
                  padding="sm"
                  withBorder
                  style={{
                    display:'flex', flexDirection:'column', gap:6,
                    borderLeft: `5px solid ${cat.border}`,
                    background: `linear-gradient(135deg, ${cat.tone} 0%, transparent 80%)`,
                    overflow: 'visible',
                    flex: r.status === 'error' ? '1 1 100%' : '1 1 560px',
                    width: r.status === 'error' ? '100%' : 'auto',
                    maxWidth: '780px',
                    minWidth: 0
                  }}
                  aria-label={`${cat.label} referral for ${name}`}
                >
                  <Group justify="space-between" wrap="nowrap" gap={6}>
                    <Badge color={statusColor(r.status)} variant="light" size="sm">{r.status}</Badge>
                    <Group gap={4} wrap="nowrap">
                      {r.status==='done' && (
                        <Tooltip label="Download PDF"><ActionIcon size="sm" component="a" href={`/api/documents/${r.id}/summary.pdf`} target="_blank" rel="noopener"><IconFileText size={14} /></ActionIcon></Tooltip>
                      )}
                      <Tooltip label={r.archived? 'Unarchive':'Archive'}><ActionIcon size="sm" variant="subtle" onClick={async ()=>{
                        const prev = overrides[r.id];
                        setOverrides(o=>({ ...o, [r.id]: { ...(prev||{}), archived: !prev?.archived } }));
                        try { await fetch(`/api/checklist/${r.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ archived: !(prev?.archived) }) }); } catch { setOverrides(o=>({ ...o, [r.id]: prev })); }
                      }}>{r.archived? '↩':'🗄'}</ActionIcon></Tooltip>
                      <Tooltip label="Open in Referral"><ActionIcon size="sm" component="a" href={`/?docId=${r.id}`}><IconEye size={14} /></ActionIcon></Tooltip>
                      <CopyButton value={r.id}>{({ copy }) => (
                        <Tooltip label="Copy ID"><ActionIcon size="sm" variant="subtle" onClick={copy}>ID</ActionIcon></Tooltip>
                      )}</CopyButton>
                    </Group>
                  </Group>
                  <Group justify="space-between" wrap="nowrap" gap={6} mt={2}>
                    <Text size="sm" fw={500} style={{ flex:1, minWidth:0 }}>{name}</Text>
                    <ActionIcon size="sm" variant="subtle" onClick={()=>setExpanded(e=>({ ...e, [r.id]: isExpanded ? false : true }))} aria-label={isExpanded? 'Collapse card':'Expand card'}>
                      {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    </ActionIcon>
                  </Group>
                  <Text size="xs" c="dimmed">DOB: {r.dob || '—'} • Referral: {r.intakeDate || '—'}</Text>
                  <Text size="xs" c="dimmed">Insurance: {r.insurance || '—'} {r.memberId && <>(ID: {r.memberId})</>}</Text>
                  <Group gap={6} wrap="wrap" mt={4}>
                    <Badge size="xs" color={cat.color} variant="filled">{cat.label}</Badge>
                    {r.confidence && <Badge size="xs" color="grape" variant="light">{r.confidence}</Badge>}
                    {needs && <Badge size="xs" color="orange" variant="outline">Review</Badge>}
                  </Group>
                  {isExpanded && <Divider my={6} />}
                  {isExpanded && (
                  <Stack gap={4}>
                    <Group gap={6} justify="space-between" wrap="wrap" align="flex-start">
                      <Text size="xs" fw={500}>Tracking</Text>
                      <SegmentedControl
                        size="xs"
                        value={effCategory || 'auto'}
                        onChange={async (val)=>{
                          const desired = val === 'auto' ? null : val;
                          const prev = overrides[r.id];
                          setOverrides(o=>({ ...o, [r.id]: { ...(prev||{}), category: desired || undefined } }));
                          try {
                            await fetch(`/api/checklist/${r.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ category: desired }) });
                          } catch (e) { /* revert on error */ setOverrides(o=>({ ...o, [r.id]: prev })); }
                        }}
                        data={[
                          { label: 'Auto', value: 'auto' },
                          { label: 'Ready', value: 'ready' },
                          { label: 'Attention', value: 'attention' },
                          { label: 'Processing', value: 'processing' },
                          { label: 'Error', value: 'error' }
                        ]}
                      />
                    </Group>
                    <Textarea
                      placeholder="Add note (internal)"
                      autosize
                      minRows={1}
                      maxRows={4}
                      value={override?.note || ''}
                      onChange={e=>{
                        const val = e.target.value;
                        setOverrides(o=>({ ...o, [r.id]: { ...(o[r.id]||{}), note: val } }));
                      }}
                      onBlur={async ()=>{
                        const ov = overrides[r.id];
                        try { await fetch(`/api/checklist/${r.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ note: ov?.note || '' }) }); } catch {}
                      }}
                      size="xs"
                      styles={{ input:{ fontSize:11 } }}
                    />
                  </Stack>
                  )}
                  {isExpanded && r.status === 'error' && r.error && (
                    <Card withBorder padding="xs" radius="sm" style={{ background:'rgba(255,0,0,0.05)' }} mb={4}>
                      <Text size="xs" c="red" style={{ whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{r.error}</Text>
                    </Card>
                  )}
                  {isExpanded && <Text size="xs" fw={500} mt={8} mb={4}>Actions</Text>}
                  {isExpanded && acts.length === 0 && !r.manual && <Text size="xs" c="dimmed">None</Text>}
                  {isExpanded && r.manual && acts.length === 0 && <Text size="xs" c="yellow">Manual verification required</Text>}
                  {isExpanded && acts.length > 0 && (
                    <Group gap={6} style={{ flexWrap:'wrap' }}>
                      {acts.map((a,i)=>(<Badge key={i} size="xs" color="blue" variant="light" style={{ cursor:'default' }}>{a}</Badge>))}
                    </Group>
                  )}
                  {isExpanded && override?.note && (
                    <Text size="xs" mt={6} c="dimmed" lineClamp={3}>Note: {override.note}</Text>
                  )}
                  {isExpanded && <Text size="xs" mt={10} c="dimmed" style={{wordBreak:'break-all'}}>{r.id}</Text>}
                </Card>
              );
            })}
            {rows.length === 0 && !loading && (
              <Card withBorder padding="md" style={{ flex:'1 1 100%' }}><Text ta="center" c="dimmed" size="xs">No documents yet</Text></Card>
            )}
            {loading && (
              <Card withBorder padding="md" style={{ flex:'1 1 100%' }}><Group justify="center"><Loader size="xs" /><Text size="xs" c="dimmed">Loading...</Text></Group></Card>
            )}
  </div>
      </Section>
      <Section title="Printable View" actions={<Button size="xs" variant="light" onClick={()=>{ const blob = new Blob([textView],{type:'text/plain'}); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='Patient_Checklist.txt'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1200);}}>Download .txt</Button>}>
        <ScrollArea h={360} offsetScrollbars>
          <Text component="pre" size="xs" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{textView || '—'}</Text>
        </ScrollArea>
      </Section>
    </Stack>
  );
}
