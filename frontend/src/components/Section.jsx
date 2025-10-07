import React from 'react';
import { Paper, Text, Group, Stack } from '../ui/primitives.jsx';

// Reusable Section container for consistent card styling and headings
export function Section({ title, actions, children, scrollArea, dark = true, ...paperProps }) {
  // Explicit dark styling to avoid being overridden by theme global Paper styles
  const darkStyles = dark ? {
    backgroundColor: '#121416',
    borderColor: '#1f2428'
  } : {};
  return (
  <Paper withBorder radius="md" p="lg" className="card-content-stack" style={darkStyles} {...paperProps}>
      {(title || actions) && (
        <Group justify="space-between" align="flex-start" mb="md" gap="sm">
          {title && (
            <Text size="sm" fw={600} c="dimmed" tt="uppercase" className="section-heading" mb={0}>
              {title}
            </Text>
          )}
          {actions && <Group gap="xs">{actions}</Group>}
        </Group>
      )}
      <Stack gap="sm">
        {children}
      </Stack>
    </Paper>
  );
}

export default Section;
