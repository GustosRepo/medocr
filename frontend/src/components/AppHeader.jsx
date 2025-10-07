import React from 'react';
import { Group, Title, ActionIcon, Text } from '../ui/primitives.jsx';
import { IconSun, IconMoonStars } from '@tabler/icons-react';
import { THEME_STORAGE_KEY, applyThemeClass } from '../ui/utils.js';

export default function AppHeader() {
  const [dark, setDark] = React.useState(() => {
    try { return (localStorage.getItem(THEME_STORAGE_KEY) || 'dark') === 'dark'; } catch { return true; }
  });
  React.useEffect(() => {
    try { localStorage.setItem(THEME_STORAGE_KEY, dark ? 'dark' : 'light'); } catch {}
    applyThemeClass(dark ? 'dark' : 'light');
  }, [dark]);
  const toggle = () => setDark(d => !d);
  return (
    <Group px="md" justify="space-between" className="w-full py-3">
      <Group gap={6} wrap="nowrap" className="items-center">
        <Title order={4} className="tracking-tight text-slate-100">
          MED<span style={{ color: 'var(--brand-accent)' }}>OCR</span>
        </Title>
        <div className="w-px h-4 bg-slate-600/50 mx-1" />
        <Text size="xs" className="text-slate-400">Referral Console</Text>
      </Group>
      <ActionIcon size="sm" onClick={toggle} aria-label="Toggle color scheme">
        {dark ? <IconSun size={18} /> : <IconMoonStars size={18} />}
      </ActionIcon>
    </Group>
  );
}
