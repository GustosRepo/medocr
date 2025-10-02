import React from 'react';
import { Paper, Text, Stack, Skeleton } from '@mantine/core';

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
          <Skeleton height={16} width="40%" />
          <Skeleton height={60} radius="md" />
          <Skeleton height={120} radius="md" />
          <Skeleton height={160} radius="md" />
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
