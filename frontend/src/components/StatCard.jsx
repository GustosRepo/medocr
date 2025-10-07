import React from 'react';
import { Paper, Text } from '../ui/primitives.jsx';

export function StatCard({ label, value }) {
  return (
    <Paper withBorder p="md" radius="md" className="stat-card">
      <Text size="xs" c="dimmed" fw={600} className="stat-label uppercase tracking-wide">{label}</Text>
      <Text fw={600} size="md" className="text-base mt-1">{value ?? '—'}</Text>
    </Paper>
  );
}

export default StatCard;
