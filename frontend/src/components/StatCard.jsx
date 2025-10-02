import React from 'react';
import { Paper, Text } from '@mantine/core';

export function StatCard({ label, value }) {
  return (
    <Paper withBorder p="md" radius="md" className="stat-card">
      <Text size="xs" tt="uppercase" c="dimmed" fw={600} className="stat-label">{label}</Text>
      <Text fw={600} size="lg" mt="xs">{value ?? '—'}</Text>
    </Paper>
  );
}

export default StatCard;
