import React from 'react';
import { Group, Title, ActionIcon, Text, Divider } from '@mantine/core';
import { useMantineColorScheme } from '@mantine/core';
import { IconSun, IconMoonStars } from '@tabler/icons-react';

export default function AppHeader() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const toggle = () => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark');
  return (
    <Group h="100%" px="md" justify="space-between">
      <Group gap={6} wrap="nowrap">
        <Title order={4} style={{ letterSpacing: '-0.5px', color: 'var(--text-primary)' }}>
          MED<span style={{ color: 'var(--brand-accent)' }}>OCR</span>
        </Title>
        <Divider orientation="vertical" mx={4} style={{ borderColor: 'var(--surface-border-soft)' }} />
        <Text size="xs" style={{ color: 'var(--text-muted)' }}>Referral Console</Text>
      </Group>
      <ActionIcon size="lg" variant="subtle" color="brand" onClick={toggle} aria-label="Toggle color scheme">
        {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoonStars size={18} />}
      </ActionIcon>
    </Group>
  );
}
