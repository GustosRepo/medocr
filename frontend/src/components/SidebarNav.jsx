import React from 'react';
import { NavLink, ScrollArea, Divider, Box, Text, Anchor, Group, Badge, Tooltip, ActionIcon } from '@mantine/core';
import { Link, useLocation } from 'react-router-dom';
import { IconFileUpload, IconChartBar, IconTimelineEvent, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconChecklist } from '@tabler/icons-react';

const baseLinks = [
  { to: '/', label: 'Referral', icon: IconFileUpload },
  { to: '/checklist', label: 'Checklist', icon: IconChecklist },
  { to: '/analytics', label: 'Analytics', icon: IconChartBar }
];

function isActivePath(current, base) {
  if (base === '/') return current === '/';
  return current === base || current.startsWith(base + '/');
}

export default function SidebarNav({ collapsed, onToggle }) {
  const location = useLocation();
  const navLinks = (import.meta.env.MODE === 'development')
    ? [...baseLinks, { to: '/legacy', label: 'Legacy UI', icon: IconTimelineEvent }]
    : baseLinks;
  const activeStyles = {
    background: 'var(--brand-soft)',
    outline: '1px solid rgba(255, 255, 255, 0.79)',
    color: 'var(--text-primary)'
  };
  const inactiveStyles = {
    background: 'transparent',
    outline: '1px solid transparent',
    color: 'var(--text-muted)'
  };
  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start' }}>
        <Box mb={8} px={0} style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
          <Tooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} position="right" withArrow>
            <ActionIcon
              size="sm"
              variant="subtle"
              onClick={onToggle}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <IconLayoutSidebarLeftExpand size={18} /> : <IconLayoutSidebarLeftCollapse size={18} />}
            </ActionIcon>
          </Tooltip>
        </Box>
        <ScrollArea style={{ flex: 1, width: '100%' }} offsetScrollbars>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
      alignItems: collapsed ? 'center' : 'stretch',
      justifyContent: 'center',
          gap: 4,
          minHeight: '100%',
          padding: collapsed ? '4px 6px' : '8px 10px'
        }}>
        {navLinks.map(l => {
          const active = isActivePath(location.pathname, l.to);
          const Icon = l.icon;
          if (collapsed) {
            return (
              <Tooltip key={l.to} label={l.label} position="right" withArrow>
                <ActionIcon
                  component={Link}
                  to={l.to}
                  variant="subtle"
                  mb={4}
                  aria-label={l.label}
                  style={{
                    borderRadius: 8,
                    transition: 'background .15s ease, outline .15s ease, color .15s ease',
                    ...(active ? activeStyles : inactiveStyles)
                  }}
                >
                  <Icon size={16} />
                </ActionIcon>
              </Tooltip>
            );
          }
          return (
            <NavLink
              key={l.to}
              component={Link}
              to={l.to}
              label={
                <Group gap={6} wrap="nowrap" justify="center" style={{ width: '100%' }}>
                  <Icon size={16} />
                  <Text size="sm" style={{ textAlign: 'center', color: 'inherit' }}>{l.label}</Text>
                  {l.to === '/legacy' && import.meta.env.MODE === 'development' && (
                    <Badge size="xs" color="yellow" variant="light">DEV</Badge>
                  )}
                </Group>
              }
              active={active}
              variant="subtle"
              mb={4}
              style={{
                borderRadius: 8,
                fontWeight: active ? 600 : 500,
                transition: 'background .15s ease, outline .15s ease, color .15s ease',
                ...(active ? activeStyles : inactiveStyles),
                justifyContent: 'center',
                textAlign: 'center'
              }}
            />
          );
        })}
        <Divider
          my="sm"
          label={collapsed ? '' : 'Raw'}
          labelPosition="center"
          style={{ borderColor: 'var(--surface-border-soft)', color: 'var(--text-muted)', marginTop: 8, marginBottom: 8 }}
        />
        <NavLink
          label={collapsed ? 'Metrics' : 'Metrics JSON'}
          component="a"
          href="/api/metrics"
          target="_blank"
          variant="subtle"
          style={{ color: 'var(--text-muted)' }}
        />
        <NavLink
          label={collapsed ? 'Analytics' : 'Analytics JSON'}
          component="a"
          href="/api/analytics"
          target="_blank"
          variant="subtle"
          style={{ color: 'var(--text-muted)' }}
        />
        </div>
        </ScrollArea>
      </div>
      {!collapsed && (
        <Box mt="sm" style={{ textAlign: 'center', width: '100%' }}>
          <Text size="xs" style={{ color: 'var(--text-muted)' }}>Local build • {new Date().getFullYear()}</Text>
          <Anchor href="https://github.com" size="xs" mt={4} target="_blank" style={{ color: 'var(--brand-accent)' }}>Docs</Anchor>
        </Box>
      )}
    </>
  );
}
