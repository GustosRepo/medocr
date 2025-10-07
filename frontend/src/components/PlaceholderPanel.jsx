import React from 'react';
import { Paper, Text, Stack } from '../ui/primitives.jsx';

export function PlaceholderPanel({ loading }) {
  if (loading) {
    return (
      <Paper
        radius="md"
        p="xl"
        withBorder
        style={{
          borderStyle: 'solid',
          borderColor: 'var(--surface-border)',
          background: 'var(--surface-2)',
          boxShadow: '0 10px 24px rgba(0,0,0,0.45)'
        }}
      >
        <Stack gap="md">
          <div className="h-4 w-2/5 bg-slate-800 rounded animate-pulse" />
          <div className="h-14 w-full bg-slate-800 rounded-md animate-pulse" />
          <div className="h-32 w-full bg-slate-800 rounded-md animate-pulse" />
          <div className="h-40 w-full bg-slate-800 rounded-md animate-pulse" />
        </Stack>
      </Paper>
    );
  }
  return (
    <Paper
      radius="md"
      p="xl"
      withBorder
      style={{
        borderStyle: 'solid',
        borderColor: 'var(--surface-border)',
        background: 'var(--surface-2)',
        textAlign: 'center',
        boxShadow: '0 10px 24px rgba(0,0,0,0.45)'
      }}
    >
      <Stack gap="xs" align="center">
  <Text size="sm" c="dimmed">Upload a PDF or load a sample to see extracted referral data.</Text>
  <Text size="xs" c="dimmed" style={{ opacity:.7 }}>Supported: PDF • Max 10MB</Text>
      </Stack>
    </Paper>
  );
}

export default PlaceholderPanel;
