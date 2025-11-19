import React, { useEffect, useState, useCallback } from 'react';
import { Group, Text, Badge, Button, Stack, ActionIcon, Tooltip, ScrollArea, MultiSelect } from '../ui/primitives.jsx';
import { IconRefresh, IconFileText, IconEye, IconChevronDown, IconChevronRight, IconCircleCheck, IconAlertTriangle, IconClock } from '@tabler/icons-react';
import Section from '../components/Section.jsx';
import OllamaMonitor from '../components/OllamaMonitor.jsx';

function statusColor(s) {
  switch (s) {
    case 'done': return 'green';
    case 'processing': return 'yellow';
    case 'queued': return 'blue';
    case 'error': return 'red';
    default: return 'gray';
  }
}

// Decision tree routing configuration
const routeConfig = {
  ready_to_schedule: { color: 'green', label: 'Ready to Schedule', icon: IconCircleCheck, priority: 'low' },
  insurance_verification: { color: 'yellow', label: 'Insurance Verification', icon: IconAlertTriangle, priority: 'medium' },
  authorization_request: { color: 'orange', label: 'Prior Auth', icon: IconClock, priority: 'medium' },
  provider_followup: { color: 'blue', label: 'Provider Followup', icon: IconAlertTriangle, priority: 'high' },
  manual_review: { color: 'red', label: 'Manual Review', icon: IconAlertTriangle, priority: 'high' }
};

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
  const [routeFilter, setRouteFilter] = useState(''); // decision tree route filter
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState({}); // id -> bool (false means collapsed); persisted
  const [printExpanded, setPrintExpanded] = useState(false);
  const COLLAPSE_KEY = 'medocr.checklist.collapsed';

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

  async function load(){
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit','300');
      if (statusFilter.length) params.set('status', statusFilter.join(','));
      if (insuranceFilter.length) params.set('insurance', insuranceFilter.join(','));
      if (showArchived) params.set('includeArchived','1');
      // cache bust to ensure fresh when toggling archived
      params.set('_t', Date.now().toString());
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
  }

  // Load persisted collapsed ids once
  useEffect(()=>{
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          const map = {};
            arr.forEach(id=>{ map[id] = false; });
          setExpanded(prev=>({ ...map, ...prev }));
        }
      }
    } catch {}
  }, []);

  // Persist on changes
  useEffect(()=>{
    try {
      const collapsedIds = Object.entries(expanded).filter(([,v])=>v===false).map(([k])=>k);
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsedIds));
    } catch {}
  }, [expanded]);

  useEffect(()=>{ load(); }, []); // initial
  useEffect(()=>{ load(); }, [statusFilter, insuranceFilter, showArchived]);
  useEffect(()=>{
    if (!autoRefresh) return;
    const id = setInterval(()=> { load().catch(()=>{}); }, 5000);
    return ()=> clearInterval(id);
  }, [autoRefresh, statusFilter, insuranceFilter, showArchived]);
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
          {/* Simplified filters (inputs) */}
          <MultiSelect
            placeholder="Status"
            data={[ 'ready','attention','processing','error' ]}
            value={statusFilter}
            onChange={setStatusFilter}
            className="min-w-[160px]"
          />
          <MultiSelect
            placeholder="Insurance"
            data={[...new Set(rows.map(r=>r.insurance).filter(Boolean))].slice(0,40)}
            value={insuranceFilter}
            onChange={setInsuranceFilter}
            searchable
            className="min-w-[200px]"
          />
          <select
            value={routeFilter}
            onChange={e => setRouteFilter(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs min-w-[180px]"
          >
            <option value="">All Routes</option>
            {Object.entries(routeConfig).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-300">
            <input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)} /> Archived
          </label>
        </Group>
      }>
        {error && <Text c="red" size="xs" mb="xs">{error}</Text>}
        <Group gap={8} mb="xs" wrap="wrap">
          <Text size="xs" c="dimmed" fw={500}>Status:</Text>
          <Badge size="xs" color="green" variant="light">Ready to Schedule</Badge>
          <Badge size="xs" color="orange" variant="light">Needs Attention</Badge>
          <Badge size="xs" color="blue" variant="light">Processing</Badge>
          <Badge size="xs" color="red" variant="light">Error</Badge>
        </Group>
        <Group gap={8} mb="xs" wrap="wrap">
          <Text size="xs" c="dimmed" fw={500}>Decision Tree Routes:</Text>
          {Object.entries(routeConfig).map(([key, cfg]) => (
            <Badge key={key} size="xs" color={cfg.color} variant="dot" leftSection={<cfg.icon size={10} />}>
              {cfg.label}
            </Badge>
          ))}
        </Group>
  {/* Removed ScrollArea to allow full-height giant list */}
  <div style={{ display:'flex', flexWrap:'wrap', gap:18, alignItems:'stretch', minWidth: 0 }}>
            {rows.filter(r => {
              // Client-side route filter
              if (routeFilter && r.routing?.route?.action !== routeFilter) return false;
              return true;
            }).map(r=>{
              const name = [r.last, r.first].filter(Boolean).join(', ') || '—';
              const acts = (r.actions||[]);
              const needs = r.manual || acts.length > 0;
              const override = overrides[r.id];
              // Base category from live data
              const effCategory = override?.category || null;
              const cat = categoryMeta(r, effCategory);
              const isExpanded = expanded[r.id] !== false; // default expanded
              
              // Decision tree routing info
              const routing = r.routing?.route;
              const routeAction = routing?.action;
              const routeMeta = routeAction ? routeConfig[routeAction] : null;
              const validationSteps = r.routing?.validationSteps || [];
              const passedSteps = validationSteps.filter(s => s.passed).length;
              const totalSteps = validationSteps.length;
              return (
        <div
          key={r.id}
          className="ref-card"
          style={{
            borderLeft: `5px solid ${cat.border}`,
            background: `linear-gradient(135deg, ${cat.tone} 0%, transparent 80%)`,
            flex: r.status === 'error' ? '1 1 100%' : '1 1 560px',
            width: r.status === 'error' ? '100%' : 'auto',
            maxWidth: '780px'
          }}
          aria-label={`${cat.label} referral for ${name}`}
        >
                  <Group justify="space-between" wrap="nowrap" gap={6}>
                    <Badge color={statusColor(r.status)} variant="light" size="sm">{r.status}</Badge>
                    <Group gap={4} wrap="nowrap">
                      {r.status==='done' && (
                        <Tooltip label="Download PDF"><ActionIcon size="sm" component="a" href={`/api/documents/${r.id}/summary.pdf`} target="_blank" rel="noopener"><IconFileText size={14} /></ActionIcon></Tooltip>
                      )}
                      {(() => { const isArchived = override?.archived ?? r.archived; return (
                        <Tooltip label={isArchived? 'Unarchive':'Archive'}>
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            aria-label={isArchived? 'Unarchive referral':'Archive referral'}
                            onClick={async ()=>{
                              const prevOv = overrides[r.id];
                              const nextArchived = ! (prevOv?.archived ?? r.archived);
                              // Optimistic override update
                              setOverrides(o=>({ ...o, [r.id]: { ...(prevOv||{}), archived: nextArchived } }));
                              // Optimistic rows update: if hiding, remove; if showing archived, just flag
                              setRows(curr => curr.map(row => row.id === r.id ? { ...row, archived: nextArchived, override: { ...(row.override||{}), archived: nextArchived } } : row).filter(row => (showArchived || !row.archived)));
                              try {
                                const resp = await fetch(`/api/checklist/${r.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ archived: nextArchived }) });
                                if (!resp.ok) throw new Error('fail');
                              } catch {
                                // revert
                                setOverrides(o=>({ ...o, [r.id]: prevOv }));
                                setRows(()=> rows); // fallback reload soon via auto refresh
                              }
                            }}
                          >{isArchived? '↩':'🗄'}</ActionIcon>
                        </Tooltip>
                      ); })()}
                      <Tooltip label="Open in Referral"><ActionIcon size="sm" component="a" href={`/?docId=${r.id}`}><IconEye size={14} /></ActionIcon></Tooltip>
                        <Tooltip label="Copy ID"><ActionIcon size="sm" variant="subtle" onClick={()=>{ navigator.clipboard.writeText(r.id).catch(()=>{}); }}>ID</ActionIcon></Tooltip>
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
                    {routeMeta && (
                      <Tooltip label={`Decision Tree: ${routeMeta.label} (Priority: ${routeMeta.priority})`}>
                        <Badge size="xs" color={routeMeta.color} variant="dot" leftSection={<routeMeta.icon size={10} />}>
                          {routeMeta.label}
                        </Badge>
                      </Tooltip>
                    )}
                    {totalSteps > 0 && (
                      <Tooltip label={`Validation: ${passedSteps}/${totalSteps} checks passed`}>
                        <Badge size="xs" color={passedSteps === totalSteps ? 'green' : 'orange'} variant="light">
                          {passedSteps}/{totalSteps} ✓
                        </Badge>
                      </Tooltip>
                    )}
                    {r.confidence && <Badge size="xs" color="grape" variant="light">{r.confidence}</Badge>}
                    {needs && <Badge size="xs" color="orange" variant="outline">Review</Badge>}
                  </Group>
                  {isExpanded && <div style={{ borderTop:'1px solid #2a323c', margin:'6px 0' }} />}
                  {isExpanded && (
                  <Stack gap={4}>
                    <Group gap={6} justify="space-between" wrap="wrap" align="flex-start">
                      <Text size="xs" fw={500}>Tracking</Text>
                        <select
                          className="bg-slate-800 text-xs rounded border border-slate-600 px-2 py-1"
                          value={effCategory || 'auto'}
                          onChange={async e=>{
                            const val = e.target.value;
                            const desired = val === 'auto' ? null : val;
                            const prev = overrides[r.id];
                            setOverrides(o=>({ ...o, [r.id]: { ...(prev||{}), category: desired || undefined } }));
                            try { await fetch(`/api/checklist/${r.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ category: desired }) }); } catch { setOverrides(o=>({ ...o, [r.id]: prev })); }
                          }}
                        >
                          <option value="auto">Auto</option>
                          <option value="ready">Ready</option>
                          <option value="attention">Attention</option>
                          <option value="processing">Processing</option>
                          <option value="error">Error</option>
                        </select>
                    </Group>
                    <textarea
                      placeholder="Add note (internal)"
                      className="bg-slate-900 border border-slate-600 rounded p-2 text-[11px] resize-y"
                      rows={2}
                      value={override?.note || ''}
                      onChange={e=>{ const val = e.target.value; setOverrides(o=>({ ...o, [r.id]: { ...(o[r.id]||{}), note: val } })); }}
                      onBlur={async ()=>{ const ov = overrides[r.id]; try { await fetch(`/api/checklist/${r.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ note: ov?.note || '' }) }); } catch {} }}
                    />
                  </Stack>
                  )}
                  {isExpanded && r.status === 'error' && r.error && (
                    <div style={{ background:'rgba(255,0,0,0.05)', border:'1px solid #ff6b6b55', borderRadius:6, padding:6, marginBottom:4 }}>
                      <Text size="xs" c="red" style={{ whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{r.error}</Text>
                    </div>
                  )}
                  {isExpanded && routing?.nextSteps && routing.nextSteps.length > 0 && (
                    <>
                      <Text size="xs" fw={500} mt={8} mb={4}>Next Steps (Decision Tree)</Text>
                      <Stack gap={3}>
                        {routing.nextSteps.map((step, i) => (
                          <Group key={i} gap={4} wrap="nowrap">
                            <Text size="xs" c="dimmed">•</Text>
                            <Text size="xs">{step.action}</Text>
                            {step.estimatedTime && <Text size="xs" c="dimmed">({step.estimatedTime})</Text>}
                          </Group>
                        ))}
                      </Stack>
                    </>
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
                </div>
              );
            })}
            {rows.length === 0 && !loading && (
              <div style={{ flex:'1 1 100%', border:'1px solid #27313b', borderRadius:8, padding:12, textAlign:'center' }}><Text c="dimmed" size="xs">No documents yet</Text></div>
            )}
            {loading && (
              <div style={{ flex:'1 1 100%', border:'1px solid #27313b', borderRadius:8, padding:12 }}><Group justify="center"><Text size="xs" c="dimmed">Loading...</Text></Group></div>
            )}
  </div>
      </Section>
      <Section
        title="Printable View"
        actions={<Group gap={6} wrap="nowrap">
          <Button size="xs" variant="light" onClick={()=>{ const blob = new Blob([textView],{type:'text/plain'}); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='Patient_Checklist.txt'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1200);}}>Download .txt</Button>
          <ActionIcon size="sm" variant="subtle" aria-label={printExpanded? 'Collapse printable view':'Expand printable view'} onClick={()=>setPrintExpanded(v=>!v)}>
            {printExpanded? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </ActionIcon>
        </Group>}
      >
        {printExpanded && (
          <ScrollArea h={360} offsetScrollbars>
            <Text component="pre" size="xs" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{textView || '—'}</Text>
          </ScrollArea>
        )}
      </Section>
      <Section title="Ollama LLM Monitor">
        <OllamaMonitor />
      </Section>
    </Stack>
  );
}
