import React, { useState } from 'react';
import { Badge, Group, Stack, Text, Paper, Tooltip } from '../ui/primitives.jsx';
import Section from './Section.jsx';

const SEVERITY_CONFIG = {
  1: { color: 'red',    label: 'STOP',    icon: '🛑', bg: 'rgba(239, 68, 68, 0.08)',  border: '#7f1d1d' },
  2: { color: 'orange', label: 'PENDING', icon: '⏳', bg: 'rgba(249, 115, 22, 0.08)', border: '#7c2d12' },
  3: { color: 'yellow', label: 'FLAG',    icon: '🚩', bg: 'rgba(234, 179, 8, 0.06)',   border: '#713f12' },
  4: { color: 'blue',   label: 'ALERT',   icon: 'ℹ️', bg: 'rgba(59, 130, 246, 0.06)',  border: '#1e3a5f' },
  5: { color: 'gray',   label: 'INFO',    icon: '📝', bg: 'transparent',               border: 'transparent' },
};

function FlagRow({ flag }) {
  const sev = SEVERITY_CONFIG[flag.severity] || SEVERITY_CONFIG[5];
  return (
    <div
      style={{
        background: sev.bg,
        borderLeft: `3px solid ${sev.border}`,
        padding: '6px 10px',
        borderRadius: '4px',
      }}
    >
      <Group gap="xs" align="flex-start" wrap="nowrap">
        <span style={{ fontSize: 12, flexShrink: 0 }}>{sev.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" mb={2}>
            <Badge size="xs" color={sev.color} variant="light">{flag.label || sev.label}</Badge>
            {flag.id && <Text size="xs" c="dimmed" style={{ fontFamily: 'monospace' }}>{flag.id}</Text>}
          </Group>
          <Text size="xs" style={{ lineHeight: 1.4 }}>{flag.action || flag.description || '—'}</Text>
        </div>
      </Group>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    STOP:    { color: 'red',    text: 'STOP — Blocked' },
    PENDING: { color: 'orange', text: 'PENDING — Needs Input' },
    FLAG:    { color: 'yellow', text: 'FLAG — Action Required' },
    ALERT:   { color: 'blue',   text: 'ALERT — Review' },
    CLEAR:   { color: 'green',  text: 'CLEAR — Ready' },
  };
  const cfg = map[status] || map.CLEAR;
  return <Badge color={cfg.color} variant="light">{cfg.text}</Badge>;
}

export default function KbAssessmentPanel({ kb }) {
  const [expanded, setExpanded] = useState(false);
  if (!kb) return null;

  const flagsToShow = expanded ? kb.flags : (kb.flags || []).slice(0, 5);
  const hasMore = (kb.flags || []).length > 5;

  return (
    <Section
      title="Knowledge Base Assessment"
      actions={<StatusBadge status={kb.status} />}
    >
      <Stack gap="md">
        {/* Top row: key metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Test Recommendation */}
          <Paper p="xs" withBorder>
            <Text size="xs" c="dimmed" mb={2}>Recommended Test</Text>
            <Text size="sm" fw={600}>
              {kb.testRecommendation?.recommendedCpt || '—'}
            </Text>
            {kb.testRecommendation?.reason && (
              <Text size="xs" c="dimmed" lineClamp={2} mt={2}>{kb.testRecommendation.reason}</Text>
            )}
          </Paper>

          {/* Payer */}
          <Paper p="xs" withBorder>
            <Text size="xs" c="dimmed" mb={2}>Payer</Text>
            <Text size="sm" fw={600}>
              {kb.payer?.payerName || '—'}
            </Text>
            {kb.payer?.authRequired != null && (
              <Badge size="xs" mt={4} color={kb.payer.authRequired ? 'orange' : 'green'} variant="light">
                {kb.payer.authRequired ? 'Auth Required' : 'No Auth'}
              </Badge>
            )}
          </Paper>

          {/* Cost Estimate */}
          <Paper p="xs" withBorder>
            <Text size="xs" c="dimmed" mb={2}>Allowable Rate</Text>
            <Text size="sm" fw={600}>
              {kb.costEstimate?.allowableRate != null
                ? `$${kb.costEstimate.allowableRate.toFixed(2)}`
                : '—'}
            </Text>
            {kb.costEstimate?.cpt && (
              <Text size="xs" c="dimmed" mt={2}>CPT {kb.costEstimate.cpt}</Text>
            )}
          </Paper>

          {/* Age / Tier */}
          <Paper p="xs" withBorder>
            <Text size="xs" c="dimmed" mb={2}>Patient Age</Text>
            <Text size="sm" fw={600}>
              {kb.age?.age != null ? `${kb.age.age} yrs` : '—'}
            </Text>
            {kb.age?.tier?.label && (
              <Text size="xs" c="dimmed" mt={2}>{kb.age.tier.label}</Text>
            )}
          </Paper>
        </div>

        {/* BCBS Routing (only if BCBS) */}
        {kb.bcbs && (
          <Paper p="xs" withBorder style={{ background: 'rgba(59, 130, 246, 0.04)' }}>
            <Group gap="xs" align="center">
              <Badge size="xs" color="blue" variant="light">BCBS</Badge>
              <Text size="xs">
                {kb.bcbs.affiliate || 'Unknown affiliate'}
                {kb.bcbs.prefix && ` (prefix: ${kb.bcbs.prefix})`}
                {kb.bcbs.state && ` — ${kb.bcbs.state}`}
              </Text>
              {kb.bcbs.authRequirement && (
                <Text size="xs" c="dimmed">| {kb.bcbs.authRequirement}</Text>
              )}
            </Group>
          </Paper>
        )}

        {/* Submission guidance */}
        {kb.payer?.submission && (
          <Paper p="xs" withBorder style={{ background: 'rgba(34, 197, 94, 0.04)' }}>
            <Text size="xs" fw={500} mb={4}>Submission</Text>
            <Group gap="sm" wrap>
              {kb.payer.submission.primary_method && (
                <Text size="xs">Method: <strong>{kb.payer.submission.primary_method}</strong></Text>
              )}
              {kb.payer.submission.portal_name && (
                <Text size="xs">Portal: <strong>{kb.payer.submission.portal_name}</strong></Text>
              )}
              {kb.payer.submission.alternate_method && (
                <Text size="xs" c="dimmed">Alt: {kb.payer.submission.alternate_method}</Text>
              )}
            </Group>
          </Paper>
        )}

        {/* Flags list */}
        {kb.flags?.length > 0 && (
          <div>
            <Group justify="space-between" mb="xs">
              <Text size="xs" fw={500}>Flags ({kb.flagSummary})</Text>
              {hasMore && (
                <button
                  onClick={() => setExpanded(v => !v)}
                  className="text-xs text-sky-400 hover:text-sky-300 cursor-pointer bg-transparent border-none"
                >
                  {expanded ? 'Show less' : `Show all ${kb.flags.length}`}
                </button>
              )}
            </Group>
            <Stack gap={6}>
              {flagsToShow.map((f, i) => (
                <FlagRow key={f.id || i} flag={f} />
              ))}
            </Stack>
          </div>
        )}

        {/* Alt CPTs */}
        {kb.testRecommendation?.alternativeCpts?.length > 0 && (
          <Group gap="xs">
            <Text size="xs" c="dimmed">Alt codes:</Text>
            {kb.testRecommendation.alternativeCpts.map(c => (
              <Badge key={c} size="xs" color="gray" variant="outline">{c}</Badge>
            ))}
          </Group>
        )}
      </Stack>
    </Section>
  );
}
