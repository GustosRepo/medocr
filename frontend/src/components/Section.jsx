import React from 'react';
import { Paper, Text, Group, Stack } from '@mantine/core';

// Reusable Section container for consistent card styling and headings
export function Section({ title, actions, children, scrollArea, ...paperProps }) {
  return (
    <Paper withBorder radius="md" p="lg" className="card-content-stack" {...paperProps}>
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
