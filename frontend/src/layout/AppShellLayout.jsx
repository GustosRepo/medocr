import React, { useState, useEffect } from 'react';
import { AppShell } from '@mantine/core';
import AppHeader from '../components/AppHeader.jsx';
import SidebarNav from '../components/SidebarNav.jsx';

export default function AppShellLayout({ children }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar:collapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('sidebar:collapsed', collapsed ? '1' : '0'); } catch {}
  }, [collapsed]);
  const toggleSidebar = () => setCollapsed(c => !c);
  const navWidth = collapsed ? 72 : 232;
  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: navWidth, breakpoint: 'sm' }}
      /* Remove internal padding so our own Box controls all spacing */
      padding={0}
      withBorder
      styles={{
        main: {
          background: 'linear-gradient(150deg, var(--surface-0) 0%, var(--surface-1) 55%, var(--surface-2) 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
          color: 'var(--text-primary)'
        },
        header: {
          backgroundColor: 'rgba(15,26,35,0.85)',
          borderBottom: '1px solid var(--surface-border-soft)',
          boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
          backdropFilter: 'blur(8px)'
        },
        navbar: {
          backgroundColor: 'rgba(15,26,35,0.9)',
          borderRight: '1px solid var(--surface-border-soft)',
          boxShadow: '2px 0 10px rgba(0,0,0,0.35)',
          backdropFilter: 'blur(8px)'
        }
      }}
    >
      <AppShell.Header>
        <AppHeader />
      </AppShell.Header>
      <AppShell.Navbar p={collapsed ? 4 : 'xs'}>
        <SidebarNav collapsed={collapsed} onToggle={toggleSidebar} />
      </AppShell.Navbar>
      <AppShell.Main style={{ paddingTop: 0 }}>
        <div
          style={{
            maxWidth: 1200,
            width: '100%',
            margin: '0 auto',
            padding: 'clamp(40px,5vw,64px) clamp(24px,4.5vw,72px) 64px',
            minHeight: 'calc(100vh - 56px)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'clamp(32px,4vw,56px)',
            transition: 'padding .25s ease, gap .25s ease, max-width .25s ease',
            color: 'var(--text-primary)'
          }}
        >
          {children}
        </div>
      </AppShell.Main>
    </AppShell>
  );
}
