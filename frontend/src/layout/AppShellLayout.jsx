import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
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
  const location = useLocation();
  const mobileLinks = useMemo(() => {
    const base = [
      { to: '/', label: 'Referral' },
      { to: '/checklist', label: 'Checklist' },
      { to: '/analytics', label: 'Analytics' },
      { to: '/debug/ocr', label: 'OCR Debug' },
      { to: '/admin/rules', label: 'Rules Editor' }
    ];
    return base;
  }, []);
  const navWidth = collapsed ? 72 : 232;
  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="flex min-h-screen">
        <aside
          className="hidden lg:flex border-r border-slate-800/60 bg-slate-950/30"
          style={{ width: navWidth, transition: 'width 0.18s ease' }}
        >
          <SidebarNav collapsed={collapsed} onToggle={toggleSidebar} />
        </aside>
        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="border-b border-slate-800/60 bg-slate-950/40">
            <div className="px-4 sm:px-6 lg:px-10 py-4">
              <AppHeader />
            </div>
            <nav className="lg:hidden border-t border-slate-800/60 bg-slate-950/80 px-4 sm:px-6 py-3">
              <div className="flex flex-wrap gap-2">
                {mobileLinks.map(link => {
                  const active = link.to === '/' ? location.pathname === '/' : location.pathname.startsWith(link.to);
                  return (
                    <Link
                      key={link.to}
                      to={link.to}
                      className={[
                        'text-xs font-medium px-3 py-1.5 rounded border transition-colors',
                        active ? 'bg-sky-600/20 border-sky-500/60 text-sky-100' : 'border-slate-700 text-slate-300 hover:border-slate-500 hover:text-slate-100'
                      ].join(' ')}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            </nav>
          </header>
          <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-10 py-10">
            <div className="max-w-6xl w-full mx-auto flex flex-col gap-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
