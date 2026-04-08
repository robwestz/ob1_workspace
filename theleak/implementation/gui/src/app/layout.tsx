'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Bot,
  ListTodo,
  Brain,
  Monitor,
  Sun,
  HeartPulse,
  Wrench,
  ChevronLeft,
  ChevronRight,
  Activity,
  Menu,
  X,
  Wifi,
  FileText,
} from 'lucide-react';
import { Providers } from './providers';
import './globals.css';

// ---------------------------------------------------------------------------
// Nav config
// ---------------------------------------------------------------------------

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/monitoring', label: 'Monitoring', icon: Wifi },
  { href: '/reports', label: 'Reports', icon: FileText },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/tasks', label: 'Tasks', icon: ListTodo },
  { href: '/memory', label: 'Memory', icon: Brain },
  { href: '/sessions', label: 'Sessions', icon: Monitor },
  { href: '/morning', label: 'Morning Report', icon: Sun },
  { href: '/health', label: 'Health', icon: HeartPulse },
  { href: '/tools', label: 'Tools', icon: Wrench },
] as const;

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function Sidebar({
  collapsed,
  onToggle,
  mobileOpen,
  onMobileClose,
}: {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const pathname = usePathname();

  const sidebarClasses = [
    'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-800 bg-slate-950',
    'transition-all duration-200 ease-in-out',
    collapsed ? 'w-16' : 'w-60',
    mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
  ].join(' ');

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside className={sidebarClasses}>
        {/* Logo area */}
        <div className="flex h-14 items-center justify-between px-4 border-b border-slate-800">
          {!collapsed && (
            <span className="text-lg font-bold tracking-tight text-slate-100">
              OB<span className="text-blue-400">1</span>
            </span>
          )}
          {collapsed && (
            <span className="text-lg font-bold tracking-tight text-blue-400 mx-auto">
              1
            </span>
          )}
          <button
            onClick={onToggle}
            className="hidden md:flex items-center justify-center w-8 h-8 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
          <button
            onClick={onMobileClose}
            className="md:hidden flex items-center justify-center w-8 h-8 rounded-md text-slate-400 hover:text-slate-200"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active =
              href === '/'
                ? pathname === '/'
                : pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                onClick={onMobileClose}
                className={[
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150',
                  active
                    ? 'bg-blue-500/10 text-blue-400'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60',
                  collapsed ? 'justify-center px-0' : '',
                ].join(' ')}
                title={collapsed ? label : undefined}
              >
                <Icon size={18} className="flex-shrink-0" />
                {!collapsed && <span>{label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-800 p-3">
          <div className={`flex items-center gap-2 ${collapsed ? 'justify-center' : ''}`}>
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            {!collapsed && (
              <span className="text-xs text-slate-500">System Online</span>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-800 bg-slate-950/80 backdrop-blur-md px-4 md:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <div className="hidden md:flex items-center gap-2 text-sm text-slate-500">
          <Activity size={14} className="text-blue-400" />
          <span>Agentic Control Plane</span>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="text-xs font-medium text-emerald-400">Connected</span>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Root layout
// ---------------------------------------------------------------------------

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const accessKey = process.env.OB1_ACCESS_KEY ?? '';

  return (
    <html lang="en" className="dark">
      <head>
        <title>OB1 - Agentic Control Plane</title>
        <meta name="description" content="OB1 Agentic Architecture Dashboard" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <Providers supabaseUrl={supabaseUrl} accessKey={accessKey}>
          <div className="flex min-h-screen">
            <Sidebar
              collapsed={collapsed}
              onToggle={() => setCollapsed((v) => !v)}
              mobileOpen={mobileOpen}
              onMobileClose={() => setMobileOpen(false)}
            />

            {/* Main content area */}
            <div
              className={[
                'flex-1 flex flex-col min-w-0 transition-all duration-200',
                collapsed ? 'md:ml-16' : 'md:ml-60',
              ].join(' ')}
            >
              <TopBar onMenuClick={() => setMobileOpen(true)} />
              <main className="flex-1 p-4 md:p-6 lg:p-8">
                {children}
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
