// Layout wrapper for non-chat surfaces (Library, Learning, Skills, Settings).
// Keeps the sidebar mounted on every page so navigation never disappears —
// previously these screens replaced the whole viewport, which was the bug
// the user flagged.
//
// On mobile (≤920px) the sidebar collapses behind a hamburger drawer and a
// fixed bottom nav surfaces the same route links. The desktop layout is a
// 220px / 1fr grid that mirrors the Shell's first two columns so the visual
// rhythm is identical when you tab between Chat and a subpage.

import { useState, type ReactNode } from 'react';
import type { AppFlowState } from '../App';
import { AppSidebar, type SidebarRoute } from './AppSidebar';
import './AppShell.css';

interface Props {
  flow: AppFlowState;
  active: SidebarRoute;
  children: ReactNode;
}

const MOBILE_NAV: Array<{ route: SidebarRoute; href: string; glyph: string; label: string }> = [
  { route: 'shell', href: '#/shell', glyph: '✦', label: 'Chat' },
  { route: 'library', href: '#/library', glyph: '◇', label: 'Library' },
  { route: 'learning', href: '#/learning', glyph: '✧', label: 'Learn' },
  { route: 'skills', href: '#/skills', glyph: '⊕', label: 'Skills' },
  { route: 'settings', href: '#/settings', glyph: '⚙', label: 'Settings' },
];

export function AppShell({ flow, active, children }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className={`app-shell${drawerOpen ? ' app-shell--drawer-open' : ''}`}>
      <button
        type="button"
        className="app-shell__hamburger"
        aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={drawerOpen}
        onClick={() => setDrawerOpen((v) => !v)}
      >
        <span aria-hidden>{drawerOpen ? '×' : '☰'}</span>
      </button>
      {drawerOpen && (
        <button
          type="button"
          className="app-shell__scrim"
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <AppSidebar flow={flow} active={active} />
      <main className="app-shell__main" onClick={() => drawerOpen && setDrawerOpen(false)}>
        {children}
      </main>
      <nav className="app-shell__tabs" aria-label="Sections">
        {MOBILE_NAV.map((item) => (
          <a
            key={item.route}
            href={item.href}
            className={
              'app-shell__tab' + (item.route === active ? ' app-shell__tab--active' : '')
            }
            aria-current={item.route === active ? 'page' : undefined}
          >
            <span className="app-shell__tab-glyph" aria-hidden>
              {item.glyph}
            </span>
            <span className="app-shell__tab-label">{item.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
