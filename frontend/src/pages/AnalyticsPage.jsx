import React, { useEffect, useState } from 'react';
import { Title, Stack, Group, Button, Badge, Text, ScrollArea, Code } from '../ui/primitives.jsx';
import Section from '../components/Section.jsx';
import StatCard from '../components/StatCard.jsx';

const apiBase = '/api';

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [intervalMs, setIntervalMs] = useState(5000);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`${apiBase}/analytics`);
      if (r.ok) {
        setData(await r.json());
      }
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (paused) return;
    const id = setInterval(load, intervalMs);
    return () => clearInterval(id);
  }, [paused, intervalMs]);

  const metrics = data?.metrics || {};
  const latency = data?.latency;

  return (
    <Stack gap="lg" className="page-container">
      <Group justify="space-between" align="flex-end">
        <Title order={2} className="page-title">Analytics</Title>
        <Group gap="xs">
          <Button size="xs" variant={paused? 'light':'default'} onClick={()=>setPaused(p=>!p)}>{paused ? 'Resume' : 'Pause'}</Button>
          <Button size="xs" onClick={load} loading={loading}>Refresh</Button>
        </Group>
      </Group>

      {!data && (
        <Stack gap="sm">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length:6 }).map((_,i)=><div key={i} className="h-20 rounded-md bg-slate-800 animate-pulse" />)}
          </div>
          <div className="h-36 rounded-md bg-slate-800 animate-pulse" />
          <div className="h-40 rounded-md bg-slate-800 animate-pulse" />
        </Stack>
      )}
      {data && (
        <Stack gap="lg">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
            {Object.entries(metrics).map(([k,v]) => (<StatCard key={k} label={k} value={v} />))}
            {latency?.count && <StatCard label="Latency p50" value={`${latency.p50}ms`} />}
            {latency?.count && <StatCard label="Latency p95" value={`${latency.p95}ms`} />}
          </div>
          <Section title="Confidence Drift">
            {data.confidenceDrift ? (
              <Group gap="md" wrap="wrap">
                <Badge color={data.confidenceDriftAlert ? 'yellow' : 'blue'} size="md">{(data.confidenceDrift.pct*100).toFixed(1)}%</Badge>
                <Text size="sm">Base {data.confidenceDrift.baseAvg.toFixed(3)}</Text>
                <Text size="sm">Recent {data.confidenceDrift.recentAvg.toFixed(3)}</Text>
              </Group>
            ) : <Text size="sm" c="dimmed">Insufficient samples</Text>}
          </Section>
          <Section title="Feedback Top Paths">
            {data.feedback?.topPaths?.length ? (
              <Stack gap="xs">
                {data.feedback.topPaths.map((p,i)=>(
                  <Group key={i} gap="xs">
                    <Code size="xs">{p[0]}</Code>
                    <Badge variant="light" size="sm">{p[1]}</Badge>
                  </Group>
                ))}
              </Stack>
            ) : <Text size="sm" c="dimmed">No feedback yet</Text>}
          </Section>
          <Section title="Recent Snapshots">
            <ScrollArea h={220} offsetScrollbars>
              {data.snapshots?.recent?.length ? (
                <Stack gap="xs">
                  {data.snapshots.recent.map((s,i)=>(
                    <Group key={i} gap="sm" wrap="nowrap">
                      <Code size="xs">{s.docId}</Code>
                      <Text size="sm" style={{ flex: 1 }}>{s.cpt}</Text>
                      <Badge size="sm" color={s.ambiguous ? 'yellow' : 'green'}>{s.confidence?.level || s.confidence || ''}</Badge>
                    </Group>
                  ))}
                </Stack>
              ) : <Text size="sm" c="dimmed">None</Text>}
            </ScrollArea>
          </Section>
        </Stack>
      )}
    </Stack>
  );
}
// Stat component removed; replaced by shared StatCard.
