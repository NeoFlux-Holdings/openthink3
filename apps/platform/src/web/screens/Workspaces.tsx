// Workspaces — top-level switcher. PRD §5.5: more than one orchestrator at
// a top level if the user wants. Each workspace is a named Orchestrator DO
// with its own thread history, memories, and settings.

import { useEffect, useRef, useState } from 'react';
import './Workspaces.css';

interface Workspace {
  id: string;
  name: string;
  agentName: string;
  description?: string;
  createdAt: number;
  pinned?: boolean;
  /** ms timestamp; archived workspaces only surface in the archived view. */
  archivedAt?: number;
}

interface PreviewThread {
  id: string;
  title: string;
  updatedAt: number;
}

// Minimal markdown renderer for workspace descriptions. Supports:
//   **bold**, *italic*, `inline code`, [link](url), and line breaks.
// HTML-escapes the input first so a description can't inject markup.
// Returns a list of React nodes so we don't need dangerouslySetInnerHTML.
function renderDescriptionMd(input: string): React.ReactNode[] {
  // Escape HTML-significant chars; we'll re-introduce ones we want
  // via the regex pass below.
  const safe = input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Tokenize via a single regex that captures (link, bold, italic,
  // code) in priority order. The leftover text between matches is
  // emitted as plain spans. Line breaks survive via white-space:
  // pre-wrap on the container, but we still split on \n so links
  // don't accidentally span them.
  const out: React.ReactNode[] = [];
  let key = 0;
  const lines = safe.split('\n');
  for (let li = 0; li < lines.length; li++) {
    if (li > 0) out.push(<br key={`br-${key++}`} />);
    const line = lines[li]!;
    const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) {
        out.push(line.slice(last, m.index));
      }
      if (m[1] && m[2]) {
        // Link — only allow http(s) so a workspace description can't
        // smuggle in a javascript: URL.
        const url = m[2];
        if (/^https?:\/\//i.test(url)) {
          out.push(
            <a
              key={`a-${key++}`}
              href={url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {m[1]}
            </a>,
          );
        } else {
          out.push(m[1]);
        }
      } else if (m[3]) {
        out.push(<strong key={`b-${key++}`}>{m[3]}</strong>);
      } else if (m[4]) {
        out.push(<em key={`i-${key++}`}>{m[4]}</em>);
      } else if (m[5]) {
        out.push(<code key={`c-${key++}`}>{m[5]}</code>);
      }
      last = m.index + m[0].length;
    }
    if (last < line.length) out.push(line.slice(last));
  }
  return out;
}

function previewRelTime(age: number): string {
  const m = Math.round(age / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

interface Props {
  onActivate: (workspace: Workspace) => void;
}

export function Workspaces({ onActivate }: Props) {
  const [list, setList] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Per-workspace last-activity timestamp (max of the workspace's
  // recent thread updatedAts). Lazy-populated alongside spend; sort-by-
  // activity uses it once available, falls back to `createdAt`
  // otherwise so the list never blanks while loading.
  const [activityByWs, setActivityByWs] = useState<Record<string, number>>({});
  const [sortMode, setSortMode] = useState<
    'pinned' | 'activity' | 'created' | 'manual'
  >(() => {
    if (typeof window === 'undefined') return 'pinned';
    return (window.localStorage.getItem('openthink:workspaces-sort') as
      | 'pinned'
      | 'activity'
      | 'created'
      | 'manual'
      | null) ?? 'pinned';
  });
  // Drag-reorder state. Only meaningful when `sortMode === 'manual'`
  // — the other modes ignore the dragged-to position because their
  // sort is deterministic.
  const [draggingWsId, setDraggingWsId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const persistOrder = (next: Workspace[]) => {
    void fetch('/api/workspaces/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: next.map((w) => w.id) }),
    }).catch(() => undefined);
  };
  useEffect(() => {
    window.localStorage.setItem('openthink:workspaces-sort', sortMode);
  }, [sortMode]);
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [busy, setBusy] = useState(false);
  // Agent-name preview: derived from the workspace name by default
  // (lowercase, alphanum-hyphenated — same rule the server uses), but
  // editable. Once the user touches the field manually OR clicks
  // regenerate, we stop auto-deriving so a slip of the workspace name
  // doesn't blow away their custom value.
  const [draftAgentName, setDraftAgentName] = useState('');
  const [agentNameTouched, setAgentNameTouched] = useState(false);
  const [suggestingName, setSuggestingName] = useState(false);

  const slugify = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  // Mirror workspace-name → agent-name while the user hasn't touched
  // the agent-name field directly.
  useEffect(() => {
    if (!agentNameTouched) setDraftAgentName(slugify(draftName));
  }, [draftName, agentNameTouched]);

  const regenerateAgentName = async () => {
    setSuggestingName(true);
    try {
      const res = await fetch('/api/onboarding/suggest-name');
      const data = (await res.json()) as { name?: string };
      if (data.name) {
        setDraftAgentName(data.name);
        setAgentNameTouched(true);
      }
    } catch {
      /* leave whatever was there */
    } finally {
      setSuggestingName(false);
    }
  };
  const [spendByAgent, setSpendByAgent] = useState<Record<string, { count24h: number; costCents24h: number }>>({});
  // Per-workspace 14-day activity heatmap. Each entry is a fixed-size
  // 14-slot array where slot 13 = today, slot 0 = 13 days ago. Bucket
  // values are thread-update counts per day; the heatmap strip below
  // each workspace row uses these to show usage rhythm at a glance.
  const [heatmapByWs, setHeatmapByWs] = useState<Record<string, number[]>>({});
  // Per-workspace hover-preview cache. Keyed by ws.id so we only fetch
  // once per workspace per session; subsequent hovers reuse the cache.
  const [previewByWs, setPreviewByWs] = useState<
    Record<string, { threads: PreviewThread[]; loaded: boolean }>
  >({});
  const [hoveringId, setHoveringId] = useState<string | null>(null);
  // Pinned preview — when the user clicks the pin button inside a
  // hover preview, that workspace's preview popover stays open even
  // after the pointer leaves. Useful for sticking around to read +
  // copy a thread title without losing the popover the moment the
  // cursor crosses a sibling card. Only one workspace can be pinned
  // at a time; clicking the pin on a different card swaps it.
  const [pinnedPreviewId, setPinnedPreviewId] = useState<string | null>(null);
  // Debounce so a fast pointer sweep doesn't trigger a fetch per card.
  const hoverTimerRef = useRef<number | null>(null);

  const startHover = (ws: Workspace) => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      setHoveringId(ws.id);
      if (previewByWs[ws.id]?.loaded) return;
      void fetch(`/api/threads/${encodeURIComponent(ws.agentName)}?limit=3`)
        .then((r) => r.json())
        .then((data: { threads?: PreviewThread[] }) => {
          setPreviewByWs((prev) => ({
            ...prev,
            [ws.id]: { threads: data.threads ?? [], loaded: true },
          }));
        })
        .catch(() => {
          setPreviewByWs((prev) => ({
            ...prev,
            [ws.id]: { threads: [], loaded: true },
          }));
        });
    }, 180);
  };

  // Esc dismisses any pinned preview without forcing the user to
  // hunt for the pin button again. Skipped while typing so the input
  // can still blur normally.
  useEffect(() => {
    if (!pinnedPreviewId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const editable = (e.target as HTMLElement | null)?.isContentEditable;
      if (tag === 'input' || tag === 'textarea' || editable) return;
      setPinnedPreviewId(null);
      setHoveringId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinnedPreviewId]);

  const endHover = () => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    // If a preview is pinned we keep it visible — the card with the
    // pinned id stays in the "previewing" state until the user
    // explicitly unpins.
    if (pinnedPreviewId) return;
    setHoveringId(null);
  };

  useEffect(() => () => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
  }, []);

  const refresh = async () => {
    try {
      const res = await fetch('/api/workspaces');
      const data = (await res.json()) as { workspaces: Workspace[]; activeId: string | null };
      setList(data.workspaces);
      setActiveId(data.activeId);
    } catch {
      /* no-op */
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  // After we have the workspace list, fan out per-workspace spend +
  // last-activity rolls so the cards have something to render. Spend
  // sequential to keep the worker happy; activity is one round-trip
  // per workspace too, but uses `/threads/<agent>?limit=1` which is
  // cheap (a single SQLite query inside the DO).
  useEffect(() => {
    let cancelled = false;
    const loadAll = async () => {
      const acc: Record<string, { count24h: number; costCents24h: number }> = {};
      const activity: Record<string, number> = {};
      const heat: Record<string, number[]> = {};
      // Pre-compute the day boundary so we don't recompute per
      // workspace. Floor "today" to local midnight; slot N covers the
      // 24h window starting (13 - N) days ago.
      const now = Date.now();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const todayStartMs = todayStart.getTime();
      const HEATMAP_DAYS = 14;
      for (const ws of list) {
        if (cancelled) return;
        try {
          const res = await fetch(
            `/api/invocations/${encodeURIComponent(ws.agentName)}/summary`,
          );
          const data = (await res.json()) as { count24h?: number; costCents24h?: number };
          acc[ws.id] = {
            count24h: data.count24h ?? 0,
            costCents24h: data.costCents24h ?? 0,
          };
        } catch {
          /* leave undefined */
        }
        try {
          // Pull up to 50 recent threads — enough to populate a 14-day
          // bucket array for typical usage. The newest entry also
          // doubles as the "last activity" sort key.
          const tRes = await fetch(
            `/api/threads/${encodeURIComponent(ws.agentName)}?limit=50`,
          );
          const tData = (await tRes.json()) as {
            threads?: Array<{ updatedAt: number }>;
          };
          const threads = tData.threads ?? [];
          if (threads[0]?.updatedAt) activity[ws.id] = threads[0].updatedAt;
          // Bucket every thread updatedAt into a 14-slot array.
          // Slot 13 = today, slot 0 = 13 days ago. Anything older
          // is dropped (no out-of-bounds writes).
          const buckets = new Array<number>(HEATMAP_DAYS).fill(0);
          for (const t of threads) {
            if (typeof t.updatedAt !== 'number') continue;
            const daysAgo = Math.floor((todayStartMs - t.updatedAt) / 86_400_000);
            if (daysAgo < 0) {
              buckets[HEATMAP_DAYS - 1]! += 1;
              continue;
            }
            if (daysAgo >= HEATMAP_DAYS) continue;
            const slot = HEATMAP_DAYS - 1 - daysAgo;
            buckets[slot]! += 1;
          }
          heat[ws.id] = buckets;
        } catch {
          /* leave undefined → falls back to createdAt for sort */
        }
      }
      if (!cancelled) {
        setSpendByAgent(acc);
        setActivityByWs(activity);
        setHeatmapByWs(heat);
      }
    };
    if (list.length > 0) void loadAll();
    return () => {
      cancelled = true;
    };
  }, [list]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftName.trim()) return;
    setBusy(true);
    try {
      await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draftName.trim(),
          agentName: draftAgentName.trim() || undefined,
          description: draftDesc.trim() || undefined,
        }),
      });
      setDraftName('');
      setDraftDesc('');
      setDraftAgentName('');
      setAgentNameTouched(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const activate = async (ws: Workspace) => {
    await fetch(`/api/workspaces/${ws.id}/activate`, { method: 'POST' });
    setActiveId(ws.id);
    onActivate(ws);
  };

  const pin = async (id: string) => {
    setList((prev) => prev.map((w) => (w.id === id ? { ...w, pinned: !w.pinned } : w)));
    await fetch(`/api/workspaces/${id}/pin`, { method: 'POST' });
  };

  const remove = async (id: string) => {
    if (list.length <= 1) return;
    setList((prev) => prev.filter((w) => w.id !== id));
    await fetch(`/api/workspaces/${id}`, { method: 'DELETE' });
  };

  // Snapshot all workspaces (active + archived) to a JSON download
  // file. Same shape the import endpoint accepts; round-trip-safe so
  // a user can copy their setup across machines or rehydrate after a
  // wipe.
  const exportSnapshot = async () => {
    try {
      const [activeRes, archivedRes] = await Promise.all([
        fetch('/api/workspaces'),
        fetch('/api/workspaces?archived=1'),
      ]);
      const active = ((await activeRes.json()) as { workspaces?: Workspace[] }).workspaces ?? [];
      const archivedRows = ((await archivedRes.json()) as { workspaces?: Workspace[] }).workspaces ?? [];
      const doc = {
        exportedAt: new Date().toISOString(),
        version: 1,
        workspaces: [...active, ...archivedRows],
      };
      const blob = new Blob([JSON.stringify(doc, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      a.href = url;
      a.download = `workspaces-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 500);
    } catch {
      /* no-op */
    }
  };
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const importSnapshot = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const body = Array.isArray(parsed)
        ? { workspaces: parsed }
        : parsed && Array.isArray(parsed.workspaces)
          ? { workspaces: parsed.workspaces }
          : null;
      if (!body) {
        return;
      }
      await fetch('/api/workspaces/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await refresh();
    } catch {
      /* no-op */
    }
  };

  // Soft-delete — archived workspaces survive but stop showing up in
  // the picker. The user can restore them from the Archived section.
  // Same "must keep at least one active" guard as remove() so the
  // sidebar never lands on a totally empty list.
  const archive = async (id: string) => {
    if (list.filter((w) => typeof w.archivedAt !== 'number').length <= 1) {
      return;
    }
    setList((prev) =>
      prev.map((w) => (w.id === id ? { ...w, archivedAt: Date.now() } : w)),
    );
    await fetch(`/api/workspaces/${id}/archive`, { method: 'POST' });
    // Refresh archived list if it's currently shown.
    if (showArchived) void loadArchived();
  };
  const restore = async (id: string) => {
    setList((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w;
        const { archivedAt: _archivedAt, ...rest } = w;
        return rest as Workspace;
      }),
    );
    await fetch(`/api/workspaces/${id}/restore`, { method: 'POST' });
    if (showArchived) void loadArchived();
  };

  // Archived workspaces panel — lazy-loaded the first time the user
  // expands it. Refetched after every archive/restore so the counts
  // stay accurate without forcing a global refresh.
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<Workspace[]>([]);
  const [archivedCount, setArchivedCount] = useState<number | null>(null);
  const loadArchived = async () => {
    try {
      const res = await fetch('/api/workspaces?archived=1');
      const data = (await res.json()) as {
        workspaces?: Workspace[];
        archivedCount?: number;
      };
      setArchived(data.workspaces ?? []);
      setArchivedCount(data.archivedCount ?? null);
    } catch {
      /* no-op */
    }
  };
  useEffect(() => {
    if (showArchived) void loadArchived();
  }, [showArchived]);
  // Also pull the count on initial mount so the toggle's badge is
  // accurate before the user expands the section.
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/workspaces?archived=1')
      .then((r) => r.json())
      .then((data: { archivedCount?: number }) => {
        if (cancelled) return;
        setArchivedCount(data.archivedCount ?? 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="workspaces">
      <header className="workspaces__header">
        <div className="workspaces__header-row">
          <h2>Workspaces</h2>
          {list.length > 0 && (
            <div className="workspaces__io">
              <button
                type="button"
                className="workspaces__io-btn"
                onClick={() => void exportSnapshot()}
                title="Download every workspace (active + archived) as a JSON snapshot"
              >
                Export ↓
              </button>
              <button
                type="button"
                className="workspaces__io-btn"
                onClick={() => importInputRef.current?.click()}
                title="Import a workspaces snapshot (dedupes by name+agent)"
              >
                Import ↑
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importSnapshot(file);
                  e.target.value = '';
                }}
              />
            </div>
          )}
        </div>
        <p className="workspaces__lede">
          Each workspace is its own agent — separate threads, memories, and skills.
          Spin up one per project, persona, or client; switch in a click.
        </p>
      </header>

      <form className="workspaces__new" onSubmit={create}>
        <div className="workspaces__new-row">
          <input
            className="ot-input workspaces__name"
            placeholder="workspace name — 'work', 'side projects', 'reading'…"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            autoCapitalize="words"
            autoComplete="off"
          />
          <button type="submit" className="ot-btn" disabled={busy || !draftName.trim()}>
            {busy ? 'Creating…' : 'Create workspace'}
          </button>
        </div>
        <input
          className="ot-input workspaces__desc"
          placeholder="what's this workspace for? (optional, supports **bold**, *italic*, `code`, [link](https://…))"
          value={draftDesc}
          onChange={(e) => setDraftDesc(e.target.value)}
        />
        {(draftName.trim() || draftAgentName) && (
          <div className="workspaces__agent-row">
            <label
              className="ot-micro workspaces__agent-label"
              htmlFor="ws-agent-name"
            >
              agent name
            </label>
            <input
              id="ws-agent-name"
              className="ot-input workspaces__agent-input"
              value={draftAgentName}
              onChange={(e) => {
                setDraftAgentName(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, '-')
                    .replace(/-+/g, '-'),
                );
                setAgentNameTouched(true);
              }}
              placeholder="auto-derived from workspace name"
              autoComplete="off"
            />
            <button
              type="button"
              className="ot-btn ot-btn--ghost workspaces__agent-suggest"
              onClick={() => void regenerateAgentName()}
              disabled={suggestingName}
              title="Suggest a different two-word name"
            >
              {suggestingName ? 'Suggesting…' : '↻ Suggest'}
            </button>
            {agentNameTouched && (
              <button
                type="button"
                className="ot-btn ot-btn--ghost workspaces__agent-reset"
                onClick={() => {
                  setAgentNameTouched(false);
                  setDraftAgentName(slugify(draftName));
                }}
                title="Reset to auto-derived"
              >
                ×
              </button>
            )}
          </div>
        )}
      </form>

      {list.length > 1 && (
        <div className="workspaces__sort" role="radiogroup" aria-label="Sort workspaces">
          <span className="ot-micro workspaces__sort-label">Sort by</span>
          {(['pinned', 'activity', 'created', 'manual'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={sortMode === mode}
              className={`workspaces__sort-opt${sortMode === mode ? ' workspaces__sort-opt--active' : ''}`}
              onClick={() => setSortMode(mode)}
              title={
                mode === 'pinned'
                  ? 'Pinned first, then alphabetical'
                  : mode === 'activity'
                    ? 'Most-recently-active first'
                    : mode === 'created'
                      ? 'Most-recently-created first'
                      : 'Drag to reorder · uses the order you set'
              }
            >
              {mode === 'pinned'
                ? 'pinned'
                : mode === 'activity'
                  ? 'last activity'
                  : mode === 'created'
                    ? 'created'
                    : 'manual ⠿'}
            </button>
          ))}
        </div>
      )}
      <ul className="workspaces__list">
        {list.length === 0 && (
          <li className="workspaces__empty">
            <p>You don't have any workspaces yet. Create one above to get started.</p>
          </li>
        )}
        {(() => {
          // Sort the workspace list on the fly using the user-picked
          // mode. We never mutate `list` itself so the create/refresh
          // path stays predictable.
          const sorted = list.slice();
          if (sortMode === 'activity') {
            sorted.sort((a, b) => {
              const aT = activityByWs[a.id] ?? a.createdAt;
              const bT = activityByWs[b.id] ?? b.createdAt;
              return bT - aT;
            });
          } else if (sortMode === 'created') {
            sorted.sort((a, b) => b.createdAt - a.createdAt);
          } else if (sortMode === 'manual') {
            // No-op — list is already in the canonical server order
            // (which is what manual mode honors). Drag operations
            // rewrite `list` directly so the UI reflects the new
            // arrangement immediately + a PUT persists it.
          } else {
            sorted.sort((a, b) => {
              if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
          }
          return sorted;
        })().map((ws) => (
          <li
            key={ws.id}
            className={`workspaces__item${ws.id === activeId ? ' workspaces__item--active' : ''}${ws.pinned ? ' workspaces__item--pinned' : ''}${hoveringId === ws.id || pinnedPreviewId === ws.id ? ' workspaces__item--previewing' : ''}${pinnedPreviewId === ws.id ? ' workspaces__item--preview-pinned' : ''}${draggingWsId === ws.id ? ' workspaces__item--dragging' : ''}${dragOverId === ws.id && draggingWsId && draggingWsId !== ws.id ? ' workspaces__item--over' : ''}`}
            // Drag-to-reorder — only enabled in manual sort mode so the
            // user can't reorder a list that's about to re-sort itself
            // on next render. The mode chip's title surfaces this so
            // discovery isn't accidental.
            draggable={sortMode === 'manual'}
            onDragStart={(e) => {
              if (sortMode !== 'manual') return;
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', ws.id);
              setDraggingWsId(ws.id);
            }}
            onDragOver={(e) => {
              if (!draggingWsId || draggingWsId === ws.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDragOverId(ws.id);
            }}
            onDragLeave={() => {
              setDragOverId((cur) => (cur === ws.id ? null : cur));
            }}
            onDrop={(e) => {
              e.preventDefault();
              const src = draggingWsId;
              setDraggingWsId(null);
              setDragOverId(null);
              if (!src || src === ws.id) return;
              setList((prev) => {
                const fromIdx = prev.findIndex((w) => w.id === src);
                const toIdx = prev.findIndex((w) => w.id === ws.id);
                if (fromIdx < 0 || toIdx < 0) return prev;
                const next = prev.slice();
                const [moved] = next.splice(fromIdx, 1);
                next.splice(toIdx, 0, moved!);
                persistOrder(next);
                return next;
              });
            }}
            onDragEnd={() => {
              setDraggingWsId(null);
              setDragOverId(null);
            }}
            onMouseEnter={() => startHover(ws)}
            onMouseLeave={endHover}
            onFocus={() => startHover(ws)}
            onBlur={endHover}
            // Make the row itself a keyboard target so Tab lands on it
            // and ArrowUp / ArrowDown move between cards without having
            // to chase the action buttons. Enter activates the
            // workspace (Switch). `p` toggles pin (no Shift required —
            // Tab focuses the li, not a text input). Home / End jump.
            tabIndex={0}
            role="button"
            aria-label={`Workspace ${ws.name}${ws.id === activeId ? ', active' : ''}${ws.pinned ? ', pinned' : ''}. Enter to switch.`}
            data-ws-id={ws.id}
            onKeyDown={(e) => {
              const target = e.currentTarget as HTMLLIElement;
              // Don't hijack keys when focus has descended into a child
              // button or input — Tab into the buttons should still work
              // normally. We check the actual event target, not
              // currentTarget.
              const eventTarget = e.target as HTMLElement;
              if (eventTarget !== target) return;
              const NAV_KEYS = [
                'ArrowDown',
                'ArrowUp',
                'Home',
                'End',
                'Enter',
                ' ',
                'p',
                'P',
              ];
              if (!NAV_KEYS.includes(e.key)) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (ws.id !== activeId) void activate(ws);
                return;
              }
              if (e.key === 'p' || e.key === 'P') {
                e.preventDefault();
                void pin(ws.id);
                return;
              }
              // Movement keys — walk the rendered DOM order so the
              // user follows the same sort the eye sees.
              const list = target.parentElement;
              if (!list) return;
              const items = Array.from(
                list.querySelectorAll<HTMLLIElement>('.workspaces__item'),
              );
              const idx = items.indexOf(target);
              if (idx < 0 || items.length === 0) return;
              e.preventDefault();
              let next = idx;
              if (e.key === 'ArrowDown') {
                next = Math.min(items.length - 1, idx + 1);
              } else if (e.key === 'ArrowUp') {
                next = Math.max(0, idx - 1);
              } else if (e.key === 'Home') {
                next = 0;
              } else if (e.key === 'End') {
                next = items.length - 1;
              }
              if (next !== idx) {
                items[next]?.focus();
                items[next]?.scrollIntoView({
                  block: 'nearest',
                  inline: 'nearest',
                });
              }
            }}
          >
            <div className="workspaces__item-meta">
              <div className="workspaces__item-row">
                <strong className="workspaces__item-name">{ws.name}</strong>
                {ws.id === activeId && <span className="ot-pill ot-pill--accent">active</span>}
                {ws.pinned && <span className="ot-pill">pinned</span>}
              </div>
              <div className="workspaces__item-sub">
                agent <code>{ws.agentName}</code> · created{' '}
                {new Date(ws.createdAt).toLocaleDateString()}
                {activityByWs[ws.id] && (
                  <>
                    {' · last active '}
                    <span
                      className="workspaces__item-activity"
                      title={new Date(activityByWs[ws.id]!).toLocaleString()}
                    >
                      {previewRelTime(Date.now() - activityByWs[ws.id]!)}
                    </span>
                  </>
                )}
                {spendByAgent[ws.id] && (
                  <>
                    {' · '}
                    <span className="workspaces__item-spend">
                      ${(spendByAgent[ws.id]!.costCents24h / 100).toFixed(2)} ·{' '}
                      {spendByAgent[ws.id]!.count24h} runs today
                    </span>
                  </>
                )}
              </div>
              {ws.description && (
                <div className="workspaces__item-desc">
                  {renderDescriptionMd(ws.description)}
                </div>
              )}
              {/* 14-day activity heatmap — one bar per day, height
                  proportional to thread updates that day. Empty days
                  render as a faint baseline so the strip's shape
                  stays legible at a glance. Hover shows the absolute
                  count + the day label. */}
              {heatmapByWs[ws.id] && heatmapByWs[ws.id]!.some((v) => v > 0) && (() => {
                const buckets = heatmapByWs[ws.id]!;
                const peak = Math.max(1, ...buckets);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                return (
                  <div
                    className="workspaces__heatmap"
                    role="img"
                    aria-label={`14-day activity for ${ws.name}`}
                  >
                    {buckets.map((count, i) => {
                      const daysAgo = buckets.length - 1 - i;
                      const day = new Date(today);
                      day.setDate(day.getDate() - daysAgo);
                      const isToday = daysAgo === 0;
                      const label =
                        daysAgo === 0
                          ? 'today'
                          : daysAgo === 1
                            ? 'yesterday'
                            : `${daysAgo}d ago`;
                      return (
                        <span
                          key={i}
                          className={`workspaces__heatmap-cell${count > 0 ? ' workspaces__heatmap-cell--has' : ''}${isToday ? ' workspaces__heatmap-cell--today' : ''}`}
                          style={{
                            height: count > 0 ? `${Math.max(20, (count / peak) * 100)}%` : '8%',
                          }}
                          title={`${label} · ${count} thread update${count === 1 ? '' : 's'}`}
                        />
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            <div className="workspaces__item-actions">
              {ws.id !== activeId && (
                <button type="button" className="ot-btn" onClick={() => void activate(ws)}>
                  Switch
                </button>
              )}
              <button
                type="button"
                className="ot-btn ot-btn--ghost"
                onClick={() => void pin(ws.id)}
              >
                {ws.pinned ? 'Unpin' : 'Pin'}
              </button>
              {list.length > 1 && (
                <button
                  type="button"
                  className="ot-btn ot-btn--ghost"
                  onClick={() => void archive(ws.id)}
                  title="Archive this workspace (restorable from Archived below)"
                >
                  Archive
                </button>
              )}
            </div>
            {(hoveringId === ws.id || pinnedPreviewId === ws.id) && (
              <div
                className={`workspaces__preview${pinnedPreviewId === ws.id ? ' workspaces__preview--pinned' : ''}`}
                role={pinnedPreviewId === ws.id ? 'region' : 'tooltip'}
                aria-label={`Recent threads in ${ws.name}`}
                onMouseEnter={() => {
                  // Keep the preview open while the pointer is over it
                  // so the user can click the pin button without it
                  // disappearing on mouse-leave from the parent card.
                  if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
                  setHoveringId(ws.id);
                }}
                onMouseLeave={endHover}
              >
                <div className="workspaces__preview-head">
                  <span>Recent threads</span>
                  <button
                    type="button"
                    className={`workspaces__preview-pin${pinnedPreviewId === ws.id ? ' workspaces__preview-pin--on' : ''}`}
                    onClick={() => {
                      setPinnedPreviewId((cur) => (cur === ws.id ? null : ws.id));
                      // Make sure the popover stays "hovered" — toggling
                      // pin shouldn't dismiss the panel.
                      setHoveringId(ws.id);
                    }}
                    aria-label={pinnedPreviewId === ws.id ? 'Unpin preview' : 'Pin preview open'}
                    title={pinnedPreviewId === ws.id ? 'Unpin (click anywhere else to dismiss)' : 'Pin this preview open'}
                  >
                    {pinnedPreviewId === ws.id ? '📌' : '⌖'}
                  </button>
                </div>
                {!previewByWs[ws.id]?.loaded ? (
                  <div className="workspaces__preview-loading ot-micro">
                    loading…
                  </div>
                ) : previewByWs[ws.id]!.threads.length === 0 ? (
                  <div className="workspaces__preview-empty ot-micro">
                    No threads yet — switch to this workspace and start
                    one.
                  </div>
                ) : (
                  <ul className="workspaces__preview-list">
                    {previewByWs[ws.id]!.threads.map((t) => (
                      <li key={t.id} className="workspaces__preview-row">
                        <span className="workspaces__preview-title">
                          {t.title || '(untitled)'}
                        </span>
                        <span className="workspaces__preview-age ot-micro">
                          {previewRelTime(Date.now() - t.updatedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {(archivedCount === null || archivedCount > 0) && (
        <div className="workspaces__archived-section">
          <button
            type="button"
            className="workspaces__archived-toggle"
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
          >
            <span>{showArchived ? '▾ Archived' : '▸ Show archived'}</span>
            {archivedCount !== null && archivedCount > 0 && (
              <span className="workspaces__archived-count">{archivedCount}</span>
            )}
          </button>
          {showArchived && (
            archived.length === 0 ? (
              <p className="ot-micro" style={{ padding: '8px 4px' }}>
                No archived workspaces.
              </p>
            ) : (
              <ul className="workspaces__archived-list">
                {archived.map((ws) => (
                  <li key={ws.id} className="workspaces__archived-item">
                    <div className="workspaces__archived-meta">
                      <strong>{ws.name}</strong>
                      <span className="ot-micro">
                        agent <code>{ws.agentName}</code>
                        {ws.archivedAt && (
                          <>
                            {' · archived '}
                            <span
                              title={new Date(ws.archivedAt).toLocaleString()}
                            >
                              {previewRelTime(Date.now() - ws.archivedAt)}
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                    <div className="workspaces__archived-actions">
                      <button
                        type="button"
                        className="ot-btn ot-btn--ghost"
                        onClick={() => void restore(ws.id)}
                        title="Restore this workspace back to the active list"
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        className="ot-btn ot-btn--ghost workspaces__archived-delete"
                        onClick={() => void remove(ws.id)}
                        title="Permanently delete this archived workspace"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}
    </div>
  );
}
