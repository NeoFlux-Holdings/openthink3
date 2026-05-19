// Reusable left sidebar. Lives in every authenticated app surface (Shell,
// Library, Learning, Skills, Settings) so the navigation never disappears
// when the user clicks between sections. The Shell passes its real thread
// list; the subpages omit `threads` and the section collapses gracefully.

import React, { useEffect, useRef, useState } from 'react';

import type { AppFlowState } from '../App';

interface ThreadPreview {
  lastMessage: string;
  role: string;
  loaded: boolean;
}

export type SidebarRoute =
  | 'shell'
  | 'library'
  | 'learning'
  | 'skills'
  | 'settings';

interface ThreadRow {
  id: string;
  title: string;
  updatedAt: number;
  pinned?: boolean;
}

interface Props {
  flow: AppFlowState;
  active: SidebarRoute;
  threads?: ThreadRow[];
  activeThread?: string | null;
  onSelectThread?: (id: string) => void;
  onArchiveThread?: (id: string) => void;
  onRestoreThread?: (id: string) => void;
  onPinThread?: (id: string, pinned: boolean) => void;
}

const NAV_ITEMS: Array<{
  route: SidebarRoute;
  href: string;
  glyph: string;
  label: string;
}> = [
  { route: 'shell', href: '#/shell', glyph: '◦', label: 'Chat' },
  { route: 'library', href: '#/library', glyph: '◇', label: 'Library' },
  { route: 'learning', href: '#/learning', glyph: '✦', label: 'Learning' },
  { route: 'skills', href: '#/skills', glyph: '⊕', label: 'Skills' },
  { route: 'settings', href: '#/settings', glyph: '⚙', label: 'Settings' },
];

export function AppSidebar({
  flow,
  active,
  threads = [],
  activeThread,
  onSelectThread,
  onArchiveThread,
  onRestoreThread,
  onPinThread,
}: Props) {
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<ThreadRow[]>([]);
  const [archivedCount, setArchivedCount] = useState<number | null>(null);
  // Thread filter survives reloads via localStorage so a user who's
  // narrowed their sidebar to "morning" doesn't have to retype the
  // filter every session. Cleared via the inline × button.
  const [threadFilter, setThreadFilter] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem('openthink:threadFilter') ?? '';
  });
  useEffect(() => {
    if (threadFilter) {
      window.localStorage.setItem('openthink:threadFilter', threadFilter);
    } else {
      window.localStorage.removeItem('openthink:threadFilter');
    }
  }, [threadFilter]);
  // Collapsed (icons-only) mode. Persists to localStorage so it survives
  // reloads + flips across both Shell and AppShell parents — both use
  // CSS `:has(.shell__sidebar--icons)` to shrink the sidebar column to
  // 56px and the nav switches to glyph-only rendering.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('openthink:sidebarCollapsed') === '1';
  });
  useEffect(() => {
    if (collapsed) {
      window.localStorage.setItem('openthink:sidebarCollapsed', '1');
    } else {
      window.localStorage.removeItem('openthink:sidebarCollapsed');
    }
  }, [collapsed]);
  // Workspace quick-pick state — clicking the identity avatar opens a
  // small dropdown listing workspaces. Lazy-loaded on first open.
  const [wsPickerOpen, setWsPickerOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Array<{
    id: string;
    name: string;
    agentName: string;
    pinned?: boolean;
  }>>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  // Nav badge counts — pulled from /api/learning/summary on mount + every
  // 60s. Cheap (one D1 aggregate). Powers the small badges next to the
  // Library / Learning / Skills nav items.
  const [navCounts, setNavCounts] = useState<{
    pending: number;
    memories: number;
    skills: number;
  }>({ pending: 0, memories: 0, skills: 0 });

  useEffect(() => {
    let cancelled = false;
    const pull = () =>
      fetch('/api/learning/summary')
        .then((r) => r.json())
        .then((data: {
          pending?: { count: number };
          memories?: { total: number };
          skills?: { total: number };
        }) => {
          if (cancelled) return;
          setNavCounts({
            pending: data.pending?.count ?? 0,
            memories: data.memories?.total ?? 0,
            skills: data.skills?.total ?? 0,
          });
        })
        .catch(() => undefined);
    void pull();
    const id = window.setInterval(pull, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Hover-preview tooltip: 400ms delay before fetching/showing so a quick
  // mouse-swipe across the list doesn't fire dozens of requests. Cache by
  // id so re-hovering the same row is instant. Touch users (no hover) get
  // nothing because `pointerType !== 'mouse'` short-circuits the open call.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoverTop, setHoverTop] = useState(0);
  const [previews, setPreviews] = useState<Record<string, ThreadPreview>>({});
  const hoverTimer = useRef<number | null>(null);

  const cancelHover = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const openHover = (id: string, top: number) => {
    cancelHover();
    hoverTimer.current = window.setTimeout(() => {
      setHoveredId(id);
      setHoverTop(top);
      // Fetch preview if we don't have it cached. tail=1 gives us just the
      // most recent message which is what the tooltip needs.
      if (!previews[id]) {
        void fetch(
          `/api/threads/${encodeURIComponent(flow.agentName || 'guest')}/${encodeURIComponent(id)}?tail=1`,
        )
          .then((r) => r.json())
          .then(
            (data: {
              ok?: boolean;
              messages?: Array<{ role: string; content: string }>;
            }) => {
              const m = data.messages?.[data.messages.length - 1];
              setPreviews((prev) => ({
                ...prev,
                [id]: {
                  lastMessage: m?.content ?? '',
                  role: m?.role ?? '',
                  loaded: true,
                },
              }));
            },
          )
          .catch(() => {
            setPreviews((prev) => ({
              ...prev,
              [id]: { lastMessage: '', role: '', loaded: true },
            }));
          });
      }
    }, 400);
  };

  const closeHover = () => {
    cancelHover();
    setHoveredId(null);
  };

  useEffect(() => () => cancelHover(), []);

  // Eager-pull workspaces on mount so the pinned-workspaces row can
  // render without waiting for the user to open the picker. Cached for
  // the session — workspace creation is rare enough we don't bother
  // refreshing. The Workspaces screen (link at the bottom of the
  // picker) is the canonical place for managing them.
  useEffect(() => {
    if (workspaces.length > 0) return;
    void fetch('/api/workspaces')
      .then((r) => r.json())
      .then((data: {
        workspaces?: Array<{ id: string; name: string; agentName: string; pinned?: boolean }>;
        activeId?: string | null;
      }) => {
        setWorkspaces(data.workspaces ?? []);
        setActiveWorkspaceId(data.activeId ?? null);
      })
      .catch(() => undefined);
  }, [workspaces.length]);

  const togglePinWorkspace = async (id: string) => {
    // Optimistic flip + re-sort. Pinned float to the top of the picker.
    setWorkspaces((prev) => {
      const next = prev.map((w) => (w.id === id ? { ...w, pinned: !w.pinned } : w));
      return next.sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    });
    try {
      await fetch(`/api/workspaces/${encodeURIComponent(id)}/pin`, { method: 'POST' });
    } catch {
      /* keep optimistic; next picker open re-pulls and reconciles */
    }
  };

  // Close the workspace picker on click-outside or Escape so it doesn't
  // camp on the sidebar.
  useEffect(() => {
    if (!wsPickerOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('.shell__ws-picker')) return;
      if (t && t.closest('.shell__identity-avatar')) return;
      setWsPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWsPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [wsPickerOpen]);

  const activateWorkspace = async (ws: {
    id: string;
    agentName: string;
  }) => {
    setActiveWorkspaceId(ws.id);
    setWsPickerOpen(false);
    try {
      await fetch(`/api/workspaces/${encodeURIComponent(ws.id)}/activate`, {
        method: 'POST',
      });
      // Hash to /shell with the new agent so the Shell hydrates fresh.
      // The App's workspace-bootstrap effect re-reads the active workspace
      // on next render, but a hash change forces a route refresh which
      // unmounts the current Shell + remounts with the new agentName.
      window.location.hash = '#/shell';
      // Force a small reload so flow.agentName picks up the change. The
      // alternative is plumbing setFlow through to here, which is more
      // surgery than this small affordance warrants.
      window.location.reload();
    } catch {
      // Surface failure inline-ish; the user can retry from the
      // Workspaces screen.
    }
  };

  // Lazy-load the archived list only when the user expands the section,
  // and refresh whenever Shell tells us a thread was archived (which it
  // signals by passing a fresh `onRestoreThread` reference).
  useEffect(() => {
    if (!showArchived) return;
    let cancelled = false;
    void fetch(
      `/api/threads/${encodeURIComponent(flow.agentName || 'guest')}?archived=1&limit=25`,
    )
      .then((r) => r.json())
      .then((data: { threads?: ThreadRow[] }) => {
        if (cancelled) return;
        setArchived(data.threads ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [showArchived, flow.agentName, threads.length]);

  // Cheap badge count — pulls up to 50 archived rows once on mount and
  // every time `threads.length` shifts (a thread was archived or restored,
  // so the count needs a refresh). 50-cap means we show "50+" past that;
  // a single agent rarely accumulates that many but the label handles it.
  useEffect(() => {
    let cancelled = false;
    void fetch(
      `/api/threads/${encodeURIComponent(flow.agentName || 'guest')}?archived=1&limit=50`,
    )
      .then((r) => r.json())
      .then((data: { threads?: ThreadRow[] }) => {
        if (cancelled) return;
        setArchivedCount(data.threads?.length ?? 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [flow.agentName, threads.length]);
  return (
    <aside className={`shell__sidebar${collapsed ? ' shell__sidebar--icons' : ''}`}>
      <div className="shell__brand-row">
        <a href="#" className="ot-brand shell__brand">
          <span className="ot-brand-dot" />
          <span className="shell__brand-text">OpenThink</span>
        </a>
        <button
          type="button"
          className="shell__collapse-toggle"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar to icons'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>
      <button
        type="button"
        className="shell__new"
        onClick={(e) => {
          e.preventDefault();
          // Fire a custom event so the Shell (which owns the WS bridge +
          // thread state) gets to create the new thread. Subpages bounce to
          // /shell first; the Shell intercepts the event after mount.
          if (active !== 'shell') {
            window.location.hash = '#/shell?newThread=1';
            return;
          }
          window.dispatchEvent(new CustomEvent('openthink:new-thread'));
        }}
      >
        <span className="shell__new-plus" aria-hidden>+</span>
        New task
      </button>
      <button
        type="button"
        className="shell__search"
        onClick={() => window.dispatchEvent(new CustomEvent('openthink:open-palette'))}
        aria-label="Open search"
      >
        <span className="shell__search-glyph" aria-hidden>⌘K</span>
        <span className="shell__search-input shell__search-input--placeholder">Search…</span>
      </button>
      <nav className="shell__nav">
        {NAV_ITEMS.map((item) => {
          // Badge logic: Learning surfaces pending (the highest-priority
          // "you have something to review" signal). Skills/Library could
          // grow badges as the spec expands but for now we keep them
          // unbadged to avoid noise.
          const badge =
            item.route === 'learning' && navCounts.pending > 0
              ? navCounts.pending
              : null;
          return (
            <a
              key={item.route}
              className={
                'shell__nav-item' +
                (item.route === active ? ' shell__nav-item--active' : '')
              }
              href={item.href}
              aria-current={item.route === active ? 'page' : undefined}
            >
              <span className="shell__nav-glyph" aria-hidden>
                {item.glyph}
              </span>{' '}
              <span className="shell__nav-label">{item.label}</span>
              {badge != null && (
                <span
                  className="shell__nav-badge"
                  aria-label={`${badge} pending`}
                  title={`${badge} pending`}
                >
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </a>
          );
        })}
      </nav>
      {(() => {
        // Pinned-workspaces quick-access row — surfaces every pinned
        // workspace (excluding the currently active one, which the
        // identity row already represents) as a clickable chip. Lets
        // users switch workspaces without opening the picker. Hidden
        // when there are no pinned non-active workspaces.
        const pinnedSwitchable = workspaces.filter(
          (w) => w.pinned && w.id !== activeWorkspaceId,
        );
        if (pinnedSwitchable.length === 0) return null;
        return (
          <div className="shell__pinned-ws">
            <span className="shell__section shell__section--mini">
              Pinned workspaces
            </span>
            <div className="shell__pinned-ws-list">
              {pinnedSwitchable.map((ws) => (
                <button
                  key={ws.id}
                  type="button"
                  className="shell__pinned-ws-chip"
                  onClick={() => void activateWorkspace(ws)}
                  title={`Switch to ${ws.name} (${ws.agentName})`}
                >
                  <span className="shell__pinned-ws-glyph" aria-hidden>
                    ✦
                  </span>
                  <span className="shell__pinned-ws-name">{ws.name}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}
      {threads.length > 0 && (() => {
        const filterText = threadFilter.trim().toLowerCase();
        const filteredThreads = filterText
          ? threads.filter((t) => t.title.toLowerCase().includes(filterText))
          : threads;
        return (
        <div className="shell__threads">
          <div className="shell__section-row">
            <span className="shell__section">Recent threads</span>
            {threads.length > 1 && onArchiveThread && (
              <button
                type="button"
                className="shell__section-action"
                onClick={() => {
                  if (
                    !window.confirm(
                      `Archive all ${threads.length} threads? They'll stay restorable from the Archived section.`,
                    )
                  ) {
                    return;
                  }
                  for (const t of threads) onArchiveThread(t.id);
                }}
                title="Archive every thread above"
              >
                clear
              </button>
            )}
          </div>
          {/* Inline filter — visible from 3 threads up (or any time the
             user has something typed, so the input stays available to
             clear). Below the threshold the list is short enough to
             scan visually and the input would be chrome-noise. */}
          {(threads.length >= 3 || threadFilter) && (
            <div className="shell__thread-filter">
              <span className="shell__thread-filter-glyph" aria-hidden>
                ⌕
              </span>
              <input
                className="shell__thread-filter-input"
                placeholder="Search threads…"
                value={threadFilter}
                onChange={(e) => setThreadFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && threadFilter) {
                    e.preventDefault();
                    e.stopPropagation();
                    setThreadFilter('');
                  }
                }}
                aria-label="Search threads"
              />
              {threadFilter && (
                <>
                  <span
                    className="shell__thread-filter-count"
                    title={`${filteredThreads.length} of ${threads.length} threads match`}
                  >
                    {filteredThreads.length}/{threads.length}
                  </span>
                  <button
                    type="button"
                    className="shell__thread-filter-clear"
                    onClick={() => setThreadFilter('')}
                    aria-label="Clear filter"
                    title="Clear filter (Esc)"
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          )}
          {filteredThreads.length === 0 && filterText && (
            <span className="ot-micro shell__thread-filter-empty">
              No matches for "{threadFilter}"
            </span>
          )}
          {(() => {
            const pinned = filteredThreads.filter((t) => t.pinned);
            const rest = filteredThreads.filter((t) => !t.pinned);
            const renderRow = (t: ThreadRow) => (
              <div
                key={t.id}
                className={
                  'shell__thread-row' +
                  (t.id === activeThread ? ' shell__thread-row--active' : '') +
                  (t.pinned ? ' shell__thread-row--pinned' : '')
                }
                onPointerEnter={(e) => {
                  if (e.pointerType !== 'mouse') return;
                  if (t.id === activeThread) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  openHover(t.id, rect.top);
                }}
                onPointerLeave={() => closeHover()}
              >
                <button
                  className="shell__thread"
                  onClick={() => onSelectThread?.(t.id)}
                  onKeyDown={(e) => {
                    // Arrow-key walk through the rendered thread list
                    // (pinned + rest in DOM order). Lets users sweep
                    // through 20+ threads with the keyboard instead of
                    // mousing. Enter is the button's native activate.
                    if (
                      e.key !== 'ArrowDown' &&
                      e.key !== 'ArrowUp' &&
                      e.key !== 'Home' &&
                      e.key !== 'End'
                    ) {
                      return;
                    }
                    const list = (e.currentTarget as HTMLElement)
                      .closest('.shell__threads')
                      ?.querySelectorAll<HTMLButtonElement>('.shell__thread');
                    if (!list) return;
                    const items = Array.from(list);
                    const idx = items.indexOf(e.currentTarget as HTMLButtonElement);
                    if (idx < 0 || items.length === 0) return;
                    e.preventDefault();
                    let next = idx;
                    if (e.key === 'ArrowDown')
                      next = Math.min(items.length - 1, idx + 1);
                    else if (e.key === 'ArrowUp') next = Math.max(0, idx - 1);
                    else if (e.key === 'Home') next = 0;
                    else if (e.key === 'End') next = items.length - 1;
                    if (next !== idx) {
                      items[next]?.focus();
                      items[next]?.scrollIntoView({
                        block: 'nearest',
                        inline: 'nearest',
                      });
                    }
                  }}
                >
                  {t.pinned && (
                    <span className="shell__thread-pin-glyph" aria-hidden>📌</span>
                  )}
                  {filterText
                    ? renderHighlightedTitle(t.title, filterText)
                    : t.title}
                </button>
                {onPinThread && (
                  <button
                    type="button"
                    className={`shell__thread-pin${t.pinned ? ' shell__thread-pin--on' : ''}`}
                    onClick={() => onPinThread(t.id, !t.pinned)}
                    title={t.pinned ? 'Unpin' : 'Pin to top'}
                    aria-label={t.pinned ? 'Unpin' : 'Pin'}
                  >
                    {t.pinned ? '★' : '☆'}
                  </button>
                )}
                {onArchiveThread && (
                  <button
                    type="button"
                    className="shell__thread-archive"
                    onClick={() => onArchiveThread(t.id)}
                    title="Archive this thread"
                    aria-label="Archive"
                  >
                    ×
                  </button>
                )}
              </div>
            );
            return (
              <>
                {pinned.length > 0 && (
                  <>
                    <div className="shell__pinned-label">Pinned</div>
                    {pinned.map(renderRow)}
                    {rest.length > 0 && (
                      <div className="shell__pinned-divider" aria-hidden />
                    )}
                  </>
                )}
                {rest.map(renderRow)}
              </>
            );
          })()}
          {(archivedCount === null || archivedCount > 0) && (
            <button
              type="button"
              className="shell__archived-toggle"
              onClick={() => setShowArchived((v) => !v)}
            >
              <span>{showArchived ? '▾ Archived' : '▸ Show archived'}</span>
              {archivedCount != null && archivedCount > 0 && (
                <span className="shell__archived-count">
                  {archivedCount >= 50 ? '50+' : archivedCount}
                </span>
              )}
            </button>
          )}
          {showArchived && (
            <div className="shell__archived">
              {archived.length === 0 ? (
                <span className="ot-micro">No archived threads.</span>
              ) : (
                <>
                  {archived.length >= 2 && onRestoreThread && (
                    <button
                      type="button"
                      className="shell__archived-restore-all"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Restore all ${archived.length} archived threads?`,
                          )
                        ) {
                          return;
                        }
                        // Optimistic: blank the local list, then fire
                        // restores for each id. The parent handler
                        // already optimistically un-archives in its
                        // own state, so the active thread list
                        // re-populates without a refetch.
                        const ids = archived.map((t) => t.id);
                        setArchived([]);
                        for (const id of ids) onRestoreThread(id);
                      }}
                      title={`Restore all ${archived.length} archived threads`}
                    >
                      ↺ Restore all ({archived.length})
                    </button>
                  )}
                  {archived.map((t) => (
                    <div
                      key={t.id}
                      className="shell__thread-row shell__thread-row--archived"
                    >
                      <button
                        className="shell__thread"
                        onClick={() => onSelectThread?.(t.id)}
                        title={t.title}
                      >
                        <span className="shell__thread-archived-title">
                          {t.title}
                        </span>
                        <span className="shell__thread-archived-time ot-micro">
                          archived {relativeTime(t.updatedAt)}
                        </span>
                      </button>
                      {onRestoreThread && (
                        <button
                          type="button"
                          className="shell__thread-archive"
                          onClick={() => {
                            onRestoreThread(t.id);
                            setArchived((prev) => prev.filter((x) => x.id !== t.id));
                          }}
                          title="Restore this thread"
                          aria-label="Restore"
                        >
                          ↺
                        </button>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
        );
      })()}
      <footer className="shell__identity">
        <div className="shell__identity-row shell__identity-row--link">
          <button
            type="button"
            className="shell__identity-avatar shell__identity-avatar--button"
            onClick={() => setWsPickerOpen((v) => !v)}
            title="Switch workspace"
            aria-haspopup="menu"
            aria-expanded={wsPickerOpen}
          >
            {(flow.agentName || 'a').slice(0, 1).toUpperCase()}
          </button>
          <a href="#/workspaces" className="shell__identity-meta shell__identity-meta--link">
            <span className="shell__identity-name">{flow.agentName || 'agent'}</span>
            <span className="shell__identity-host" title={flow.customDomain ?? undefined}>
              <span className="shell__identity-pulse" /> live ·{' '}
              {flow.customDomain ?? `${flow.subdomain ?? flow.agentName ?? 'workers'}.dev`}
            </span>
          </a>
          {flow.workersPaid && (
            <span className="shell__identity-plan" title="Workers Paid plan active">
              paid
            </span>
          )}
        </div>
        {wsPickerOpen && (() => {
          // Sort pinned workspaces first so the "favorites" stay on top.
          // Active workspace floats above unpinned siblings of equal class.
          const sorted = [...workspaces].sort((a, b) => {
            if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
            if (a.id === activeWorkspaceId) return -1;
            if (b.id === activeWorkspaceId) return 1;
            return a.name.localeCompare(b.name);
          });
          const pinnedCount = sorted.filter((w) => w.pinned).length;
          return (
          <div className="shell__ws-picker" role="menu">
            <div className="shell__ws-picker-head">Workspaces</div>
            {sorted.length === 0 ? (
              <div className="ot-micro shell__ws-picker-empty">Loading…</div>
            ) : (
              sorted.map((ws, i) => (
                <div
                  key={ws.id}
                  className={`shell__ws-picker-item${ws.id === activeWorkspaceId ? ' shell__ws-picker-item--active' : ''}`}
                  role="menuitem"
                >
                  <button
                    type="button"
                    className="shell__ws-picker-activate"
                    onClick={() => void activateWorkspace(ws)}
                  >
                    <span className="shell__ws-picker-avatar" aria-hidden>
                      {ws.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="shell__ws-picker-meta">
                      <span className="shell__ws-picker-name">
                        {ws.pinned && (
                          <span className="shell__ws-picker-pin-glyph" aria-hidden>📌</span>
                        )}
                        {ws.name}
                      </span>
                      <span className="shell__ws-picker-sub ot-micro">{ws.agentName}</span>
                    </span>
                    {ws.id === activeWorkspaceId && (
                      <span className="shell__ws-picker-check" aria-hidden>✓</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className={`shell__ws-picker-pin${ws.pinned ? ' shell__ws-picker-pin--on' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void togglePinWorkspace(ws.id);
                    }}
                    title={ws.pinned ? 'Unpin from top' : 'Pin to top'}
                    aria-label={ws.pinned ? 'Unpin workspace' : 'Pin workspace'}
                  >
                    {ws.pinned ? '★' : '☆'}
                  </button>
                  {/* Visual divider between the pinned cluster and the rest. */}
                  {pinnedCount > 0 && i === pinnedCount - 1 && i < sorted.length - 1 && (
                    <span className="shell__ws-picker-divider" aria-hidden />
                  )}
                </div>
              ))
            )}
            <a className="shell__ws-picker-manage" href="#/workspaces">
              Manage workspaces →
            </a>
          </div>
          );
        })()}
        <div className="shell__budget">
          <div className="shell__budget-bar">
            <div className="shell__budget-fill" style={{ width: '34%' }} />
          </div>
          <span className="shell__budget-label">$1.71 / $5.00 today</span>
        </div>
      </footer>
      {hoveredId && (() => {
        const t = threads.find((x) => x.id === hoveredId);
        const p = previews[hoveredId];
        if (!t) return null;
        return (
          <div
            className="shell__thread-tooltip"
            style={{ top: Math.max(8, hoverTop - 8) }}
            role="tooltip"
          >
            <div className="shell__thread-tooltip-title">{t.title}</div>
            {p?.loaded ? (
              p.lastMessage ? (
                <div className="shell__thread-tooltip-msg">
                  <span className="shell__thread-tooltip-role">
                    {p.role === 'user' ? 'You' : flow.agentName || 'agent'} ·{' '}
                  </span>
                  {p.lastMessage.slice(0, 140)}
                  {p.lastMessage.length > 140 ? '…' : ''}
                </div>
              ) : (
                <div className="shell__thread-tooltip-msg ot-micro">No messages yet.</div>
              )
            ) : (
              <div className="shell__thread-tooltip-msg">
                <span className="ot-skel ot-skel--row" style={{ width: '80%' }} />
                <span className="ot-skel ot-skel--row" style={{ width: '60%' }} />
              </div>
            )}
            <div className="shell__thread-tooltip-time">
              {relativeTime(t.updatedAt)}
            </div>
          </div>
        );
      })()}
    </aside>
  );
}

// Highlight every case-insensitive match of `q` within `title`. Returns
// a fragment with `<mark>` around the matched slices. Skips work when
// `q` is empty so the common non-filtered path stays cheap.
function renderHighlightedTitle(title: string, q: string): React.ReactNode {
  if (!q) return title;
  const lower = title.toLowerCase();
  const needle = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let idx = lower.indexOf(needle, i);
  let key = 0;
  while (idx >= 0) {
    if (idx > i) parts.push(title.slice(i, idx));
    parts.push(
      <mark key={key++} className="shell__thread-hl">
        {title.slice(idx, idx + needle.length)}
      </mark>,
    );
    i = idx + needle.length;
    idx = lower.indexOf(needle, i);
  }
  if (i < title.length) parts.push(title.slice(i));
  return <>{parts}</>;
}

// Cheap relative-time formatter. Used only here so it lives close to the
// callsite. Falls back to absolute date past 7 days.
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 60 * 60_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60_000) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 7 * 24 * 60 * 60_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}
