import React from 'react';
import { ScrollArea, Text, Group, Badge, Tooltip, ActionIcon } from '../ui/primitives.jsx';
import { Link, useLocation } from 'react-router-dom';
import { IconFileUpload, IconChartBar, IconTimelineEvent, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconChecklist, IconBug, IconAdjustments, IconChartDots } from '@tabler/icons-react';

const baseLinks = [
  { to: '/', label: 'Referral', icon: IconFileUpload },
  { to: '/checklist', label: 'Checklist', icon: IconChecklist },
  { to: '/analytics', label: 'Analytics', icon: IconChartBar },
  { to: '/benchmark', label: 'Benchmark', icon: IconChartDots },
  { to: '/debug/ocr', label: 'OCR Debug', icon: IconBug },
  { to: '/admin/rules', label: 'Rules Editor', icon: IconAdjustments }
];

function isActivePath(current, base) {
  if (base === '/') return current === '/';
  return current === base || current.startsWith(base + '/');
}

export default function SidebarNav({ collapsed, onToggle }) {
  const location = useLocation();
  const navLinks = baseLinks;
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Top (toggle) */}
      <div style={{ padding: collapsed ? '10px 0 4px' : '12px 0 8px', display: 'flex', justifyContent: 'center' }}>
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
      </div>
      {/* Scrollable nav */}
      <div style={{ flex: 1, minHeight: 0 }}> {/* minHeight:0 so ScrollArea can shrink inside flex */}
        <ScrollArea style={{ height: '100%', width: '100%' }} offsetScrollbars>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: collapsed ? 'center' : 'stretch',
              gap: 6,
              padding: collapsed ? '4px 6px 8px' : '8px 10px 12px'
            }}
          >
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
                      aria-label={l.label}
                      style={{
                        marginBottom: 2,
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
                <Link
                  key={l.to}
                  to={l.to}
                  className="no-underline"
                  style={{
                    borderRadius: 8,
                    fontWeight: active ? 600 : 500,
                    transition: 'background .15s ease, outline .15s ease, color .15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '6px 10px',
                    ...(active ? activeStyles : inactiveStyles)
                  }}
                >
                  <Group gap={6} wrap="nowrap" justify="center" style={{ width: '100%' }}>
                    <Icon size={16} />
                    <Text size="sm" style={{ textAlign: 'center', color: 'inherit' }}>{l.label}</Text>
                    {l.to === '/legacy' && import.meta.env.MODE === 'development' && (
                      <Badge size="xs" color="yellow" variant="light">DEV</Badge>
                    )}
                  </Group>
                </Link>
              );
            })}
            <div style={{ borderTop: '1px solid var(--surface-border-soft)', margin: '8px 0', width: '100%' }} />
            <a
              href="/api/metrics"
              target="_blank"
              className="text-xs text-slate-500 hover:text-slate-300"
              style={{ textDecoration: 'none', padding: '4px 6px' }}
            >
              {collapsed ? 'Metrics' : 'Metrics JSON'}
            </a>
            <a
              href="/api/analytics"
              target="_blank"
              className="text-xs text-slate-500 hover:text-slate-300"
              style={{ textDecoration: 'none', padding: '4px 6px' }}
            >
              {collapsed ? 'Analytics' : 'Analytics JSON'}
            </a>
          </div>
        </ScrollArea>
      </div>
      {/* Footer pinned */}
      {!collapsed && (
        <div style={{ textAlign: 'center', width: '100%', padding: '10px 0 14px' }}>
          <Text size="xs" style={{ color: 'var(--text-muted)' }}>Local build • {new Date().getFullYear()}</Text>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="block text-xs text-sky-400 hover:text-sky-300 mt-1.5"
          >
            Docs
          </a>
        </div>
      )}
    </div>
  );
}
