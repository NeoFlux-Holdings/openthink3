// CommandPalette — ⌘K/Ctrl+K global search modal. PRD §9.
//
// Three tabs (Threads / Artifacts / Memories) backed by static data for v0;
// real search hits the worker /api/search/* endpoints when those land. The
// palette is a fixed-position blur sheet over the whole app, so it works from
// any route — sidebar, Library, Settings, in-chat, etc.

import { useEffect, useMemo, useRef, useState } from 'react';
import './CommandPalette.css';

type Tab = 'threads' | 'artifacts' | 'memories' | 'sections';

interface Item {
  id: string;
  tab: Tab;
  title: string;
  subtitle?: string;
  href: string;
  group?: string;
  // Discriminator for items that need a side-effect on activate (e.g.
  // workspaces POST /activate). When unset the item is a plain navigation.
  kind?: 'workspace';
  // Carried payload for kind-specific handlers.
  payload?: { workspaceId: string };
  // Timestamp the item was last navigated via the palette. Set only on
  // recent entries — base list items leave this undefined. Lets the
  // Recent group render a `2m ago` chip per row without needing a
  // separate state map.
  lastUsedAt?: number;
}

const SECTIONS: Item[] = [
  { id: 'go-chat', tab: 'sections', title: 'Chat', subtitle: 'Jump to the active thread', href: '#/shell' },
  { id: 'go-library', tab: 'sections', title: 'Library', subtitle: 'Every artifact', href: '#/library' },
  { id: 'go-learning', tab: 'sections', title: 'Learning', subtitle: 'Skills, memories, rubrics', href: '#/learning' },
  { id: 'go-skills', tab: 'sections', title: 'Skills', subtitle: 'Toggle packs and procedures', href: '#/skills' },
  { id: 'go-settings', tab: 'sections', title: 'Settings', subtitle: 'Models, automation, spending', href: '#/settings' },
];

const SAMPLE_THREADS: Item[] = [
  { id: 't-welcome', tab: 'threads', title: 'Welcome', subtitle: 'Today', href: '#/shell', group: 'Today' },
  { id: 't-morning-inbox', tab: 'threads', title: 'Morning inbox triage', subtitle: 'Yesterday', href: '#/shell', group: 'Past week' },
  { id: 't-prd-review', tab: 'threads', title: 'PRD review', subtitle: '3 days ago', href: '#/shell', group: 'Past week' },
  { id: 't-vendors', tab: 'threads', title: 'Vendor comparison', subtitle: '2 weeks ago', href: '#/shell', group: 'Past month' },
];

const SAMPLE_ARTIFACTS: Item[] = [
  { id: 'a-pitch', tab: 'artifacts', title: 'Pitch deck — v3', subtitle: 'slides · 14 slides', href: '#/library' },
  { id: 'a-launch-plan', tab: 'artifacts', title: 'Launch plan', subtitle: 'document · v2', href: '#/library' },
  { id: 'a-pricing', tab: 'artifacts', title: 'Pricing model', subtitle: 'table · 4 columns', href: '#/library' },
];

const SAMPLE_MEMORIES: Item[] = [
  { id: 'm-name', tab: 'memories', title: 'Owner prefers concise replies', subtitle: 'preferences', href: '#/learning' },
  { id: 'm-tz', tab: 'memories', title: 'America/Toronto, ships in afternoons', subtitle: 'user_facts', href: '#/learning' },
];

function relTime(age: number): string {
  const m = Math.round(age / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d}d ago`;
  const mo = Math.round(d / 30);
  return `${mo}mo ago`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  agentName?: string;
}

// Cap on how many recently-navigated palette items we remember.
const RECENT_CAP = 6;

function loadRecent(): Item[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem('openthink:cmdk-recent');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Item[];
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_CAP) : [];
  } catch {
    return [];
  }
}

function recordRecent(it: Item) {
  if (typeof window === 'undefined') return;
  const list = loadRecent().filter((x) => x.id !== it.id);
  list.unshift({ ...it, group: undefined, lastUsedAt: Date.now() });
  window.localStorage.setItem(
    'openthink:cmdk-recent',
    JSON.stringify(list.slice(0, RECENT_CAP)),
  );
}

function clearRecent() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem('openthink:cmdk-recent');
}

export function CommandPalette({ open, onClose, agentName }: Props) {
  const [tab, setTab] = useState<Tab>('threads');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [liveThreads, setLiveThreads] = useState<Item[]>([]);
  // Workspaces injected as Sections rows. Lazy-fetched once per open. The
  // currently-active workspace floats to the top with an "active" subtitle.
  const [liveWorkspaces, setLiveWorkspaces] = useState<Item[]>([]);
  // Snapshot the recent list at open-time so it's stable while the palette
  // is up. Updated on every open from localStorage so a navigation in a
  // separate tab reflects on the next show.
  const [recent, setRecent] = useState<Item[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Pull real threads from the Orchestrator DO every time the palette
  // opens. Fast path even on cold opens — DO listThreads reads from local
  // SQLite, low double-digit ms.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch(`/api/threads/${encodeURIComponent(agentName || 'guest')}`)
      .then((r) => r.json())
      .then((data: { threads?: Array<{ id: string; title: string; updatedAt: number }> }) => {
        if (cancelled || !data.threads) return;
        const now = Date.now();
        const items: Item[] = data.threads.map((t) => {
          const age = now - t.updatedAt;
          const group =
            age < 24 * 60 * 60_000
              ? 'Today'
              : age < 7 * 24 * 60 * 60_000
                ? 'Past week'
                : age < 31 * 24 * 60 * 60_000
                  ? 'Past month'
                  : 'Older';
          return {
            id: `t-${t.id}`,
            tab: 'threads',
            title: t.title || '(untitled)',
            subtitle: relTime(age),
            // Deep-link the specific thread; Shell hydrates from this on
            // mount and on every hash change.
            href: `#/shell?thread=${encodeURIComponent(t.id)}`,
            group,
          };
        });
        setLiveThreads(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, agentName]);

  // Lazy-fetch the workspace list every time the palette opens. Cheap —
  // `/api/workspaces` reads a single KV blob and tags the active id. We
  // re-fetch on every open (rather than cache for the session) so a switch
  // performed elsewhere reflects on the next ⌘K.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch('/api/workspaces')
      .then((r) => r.json())
      .then((data: {
        workspaces?: Array<{ id: string; name: string; agentName: string; pinned?: boolean }>;
        activeId?: string | null;
      }) => {
        if (cancelled || !data.workspaces) return;
        const activeId = data.activeId ?? null;
        const sorted = [...data.workspaces].sort((a, b) => {
          // Active first, then pinned, then alphabetical.
          if (a.id === activeId && b.id !== activeId) return -1;
          if (b.id === activeId && a.id !== activeId) return 1;
          if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        const items: Item[] = sorted.map((w) => ({
          id: `ws-${w.id}`,
          tab: 'sections',
          title: `Switch to ${w.name}`,
          subtitle:
            w.id === activeId
              ? `active workspace · ${w.agentName}`
              : w.pinned
                ? `pinned · ${w.agentName}`
                : w.agentName,
          // Visual fallback href if the kind-specific handler fails — lands
          // the user on the Workspaces screen so they can self-recover.
          href: '#/workspaces',
          group: 'Workspaces',
          kind: 'workspace',
          payload: { workspaceId: w.id },
        }));
        setLiveWorkspaces(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Reset state on open; auto-focus the input. Also re-load the recent
  // list from localStorage so cross-tab navigation reflects.
  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      setRecent(loadRecent());
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Close on Esc anywhere on the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const allItems = useMemo<Item[]>(() => {
    // Prefer live thread data when we got any back from the DO; otherwise
    // fall back to the seed list so the palette still has something to
    // show when the worker hasn't booted.
    const threads = liveThreads.length > 0 ? liveThreads : SAMPLE_THREADS;
    // Workspaces sit at the top of Sections so ⌘K → typing a workspace name
    // surfaces it before the static go-to-section rows. When the user has
    // zero workspaces, fall back to just the static sections.
    return [
      ...liveWorkspaces,
      ...SECTIONS,
      ...threads,
      ...SAMPLE_ARTIFACTS,
      ...SAMPLE_MEMORIES,
    ];
  }, [liveThreads, liveWorkspaces]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inTab = (it: Item) => (q.length === 0 ? it.tab === tab : true);
    if (q.length === 0) {
      const base = allItems.filter(inTab);
      // When the query is empty AND there are recent items, prepend
      // them with a `Recent` group so they bubble above the tab-
      // default list. Reusable items get deduped by id (recent
      // already has them with the canonical id from when they were
      // last picked).
      if (recent.length > 0) {
        const recentIds = new Set(recent.map((r) => r.id));
        const recentInTab = recent.filter((r) => r.tab === tab);
        const remainder = base.filter((it) => !recentIds.has(it.id));
        return [
          ...recentInTab.map((r) => ({ ...r, group: 'Recent' })),
          ...remainder,
        ];
      }
      return base;
    }
    // Score every item with a fuzzy matcher (substring + subsequence
    // with word-boundary bonuses) and keep only positive-score hits.
    // Sort by descending score so a typo-near "stng" surfaces
    // "Settings" above "Spending".
    const scored: Array<{ item: Item; score: number }> = [];
    for (const it of allItems) {
      const score = fuzzyScore(q, it.title, it.subtitle);
      if (score > 0) scored.push({ item: it, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.item);
  }, [allItems, tab, query, recent]);

  // Keep cursor in range when filter changes.
  useEffect(() => {
    setCursor((c) => Math.max(0, Math.min(filtered.length - 1, c)));
  }, [filtered.length]);

  const navigate = (it: Item) => {
    recordRecent(it);
    // Workspace activation has a side-effect (POST /activate) and demands a
    // full reload so the App's bootstrap effect picks up the new agentName.
    // Same pattern as AppSidebar's activateWorkspace handler — kept here so
    // ⌘K can do the whole flow without bouncing through the sidebar picker.
    if (it.kind === 'workspace' && it.payload?.workspaceId) {
      const wsId = it.payload.workspaceId;
      onClose();
      void fetch(`/api/workspaces/${encodeURIComponent(wsId)}/activate`, {
        method: 'POST',
      })
        .catch(() => undefined)
        .finally(() => {
          // Land on the shell (where the active workspace lives) and force a
          // reload so flow.agentName re-reads from /api/workspaces.
          window.location.hash = '#/shell';
          window.location.reload();
        });
      return;
    }
    window.location.hash = it.href.replace(/^#/, '');
    onClose();
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[cursor];
      if (item) navigate(item);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const tabs: Tab[] = ['threads', 'artifacts', 'memories', 'sections'];
      const i = tabs.indexOf(tab);
      setTab(tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length] ?? 'threads');
    }
  };

  if (!open) return null;

  // Group items by their .group label when present (recent threads view).
  const grouped: Array<{ label?: string; items: Item[] }> = [];
  let currentLabel: string | undefined = undefined;
  for (const item of filtered) {
    if (item.group && item.group !== currentLabel) {
      grouped.push({ label: item.group, items: [item] });
      currentLabel = item.group;
    } else if (grouped.length > 0 && (item.group === currentLabel || !item.group)) {
      grouped[grouped.length - 1]!.items.push(item);
    } else {
      grouped.push({ items: [item] });
      currentLabel = undefined;
    }
  }

  return (
    <div className="cmdk" role="dialog" aria-label="Search">
      <button
        type="button"
        className="cmdk__scrim"
        aria-label="Close search"
        onClick={onClose}
      />
      <div className="cmdk__panel">
        <div className="cmdk__input-row">
          <span className="cmdk__input-glyph" aria-hidden>
            ✦
          </span>
          <input
            ref={inputRef}
            className="cmdk__input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search threads, artifacts, memories…"
            aria-label="Search"
          />
          <span className="cmdk__hint" aria-hidden>
            esc
          </span>
          <button
            type="button"
            className="cmdk__close-mobile"
            aria-label="Close search"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="cmdk__tabs" role="tablist">
          {(['threads', 'artifacts', 'memories', 'sections'] satisfies Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`cmdk__tab${tab === t ? ' cmdk__tab--active' : ''}`}
              onClick={() => {
                setTab(t);
                setCursor(0);
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="cmdk__body">
        <div className="cmdk__results">
          {filtered.length === 0 && (
            <div className="cmdk__empty">
              <p>No matches.</p>
              <span className="ot-micro">try a different word or switch tabs with Tab</span>
            </div>
          )}
          {grouped.map((group, gi) => (
            <div key={gi} className="cmdk__group">
              {group.label && (
                <div className="cmdk__group-label">
                  <span>{group.label}</span>
                  {/* Clear-recent affordance only on the Recent group;
                      lives inline with the label so it's findable
                      without crowding regular group headers. Wipes the
                      localStorage cache + the in-memory snapshot so
                      the group disappears from the current open. */}
                  {group.label === 'Recent' && (
                    <button
                      type="button"
                      className="cmdk__group-clear"
                      onClick={() => {
                        clearRecent();
                        setRecent([]);
                      }}
                      title="Clear recent palette history"
                    >
                      clear
                    </button>
                  )}
                </div>
              )}
              {group.items.map((it) => {
                const flatIndex = filtered.indexOf(it);
                const active = flatIndex === cursor;
                return (
                  <button
                    key={it.id}
                    className={`cmdk__item${active ? ' cmdk__item--active' : ''}`}
                    onClick={() => navigate(it)}
                    onMouseEnter={() => setCursor(flatIndex)}
                  >
                    <span className="cmdk__item-title">{it.title}</span>
                    {it.subtitle && <span className="cmdk__item-sub">{it.subtitle}</span>}
                    {it.lastUsedAt && (
                      <span
                        className="cmdk__item-when ot-micro"
                        title={new Date(it.lastUsedAt).toLocaleString()}
                      >
                        {relTime(Date.now() - it.lastUsedAt)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {/* Preview pane — surfaces extended context for the cursored
            item. Reads as "what does Enter on this item actually do?"
            so the user can hover-scan options without committing.
            Hidden when the results are empty, since there's nothing
            to preview. */}
        {filtered.length > 0 && filtered[cursor] && (
          <aside className="cmdk__preview" aria-label="Item preview">
            <PalettePreview item={filtered[cursor]} />
          </aside>
        )}
        </div>
        <footer className="cmdk__footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>tab</kbd> switch tabs</span>
          <span><kbd>esc</kbd> close</span>
        </footer>
      </div>
    </div>
  );
}

// Preview pane that lives beside the results list. Re-derives the
// "what will Enter do" message from the item's tab + kind so the
// user doesn't have to memorize what each command actually
// accomplishes. Pure presentational — no state, no fetches.
function PalettePreview({ item }: { item: Item }) {
  // Per-tab explanatory copy. The Sections tab gets a slightly
  // richer "what you'll find there" body; the rest fall back to the
  // item's own subtitle since that's already context-aware.
  const kindLabel: Record<Tab, string> = {
    sections: 'Navigation',
    threads: 'Chat thread',
    artifacts: 'Artifact',
    memories: 'Memory',
  };
  const sectionBody: Record<string, string> = {
    'go-chat': 'Resumes the active thread. Picks up wherever you left off.',
    'go-library':
      'Every artifact this agent has produced, with filters, bulk-tag, and a zip-export bundle.',
    'go-learning':
      'Skills, memories, and rubrics. Where the agent\'s long-term context lives.',
    'go-skills':
      'Toggle which skill packs the orchestrator can load. Author your own from the JSX editor.',
    'go-settings':
      'Models, automation, spending caps, audit log, and the sync panel.',
  };
  const isWorkspace = item.kind === 'workspace';
  const body =
    item.tab === 'sections'
      ? (sectionBody[item.id] ?? item.subtitle)
      : item.subtitle;
  const hintText = isWorkspace
    ? 'Activates this workspace + reloads the shell against its data.'
    : item.tab === 'sections'
      ? 'Press Enter or click to navigate.'
      : item.tab === 'threads'
        ? 'Press Enter to open this thread in chat.'
        : item.tab === 'artifacts'
          ? 'Press Enter to jump into Library, focused on this artifact.'
          : 'Press Enter to open this memory in Learning.';
  return (
    <div className="cmdk__preview-body">
      <div className="cmdk__preview-kind ot-micro">
        {kindLabel[item.tab]}
        {item.group && ` · ${item.group}`}
      </div>
      <h4 className="cmdk__preview-title">{item.title}</h4>
      {body && <p className="cmdk__preview-sub">{body}</p>}
      <div className="cmdk__preview-meta">
        <span className="cmdk__preview-meta-label ot-micro">target</span>
        <code className="cmdk__preview-href">{item.href}</code>
      </div>
      {item.lastUsedAt && (
        <div className="cmdk__preview-meta">
          <span className="cmdk__preview-meta-label ot-micro">last used</span>
          <span className="ot-micro">{relTime(Date.now() - item.lastUsedAt)}</span>
        </div>
      )}
      <p className="cmdk__preview-hint ot-micro">{hintText}</p>
    </div>
  );
}

// Fuzzy score for a command-palette item against a lowercase query.
// Returns 0 when no match exists, a positive number otherwise — higher
// is a better match. Algorithm:
//   1. Title substring match: high base (100) + bonus when the match
//      starts at the title's beginning or a word boundary.
//   2. Subtitle substring match: low base (40).
//   3. Subsequence match in title (chars appear in order, possibly
//      with gaps): medium base (60), penalized by total gap length.
//      Bonus for consecutive runs + word-boundary starts.
// Scores stay deterministic so the same query ranks the same items
// the same way across renders.
function fuzzyScore(q: string, title: string, subtitle?: string): number {
  if (!q) return 1;
  const t = title.toLowerCase();
  // 1. Exact substring in title.
  const tIdx = t.indexOf(q);
  if (tIdx >= 0) {
    let score = 100;
    if (tIdx === 0) score += 30;                  // starts the title
    else if (/[\s-_/.]/.test(t.charAt(tIdx - 1))) score += 15; // word boundary
    // Shorter titles rank higher (a 5-char match in "settings" beats
    // the same match buried in a 60-char description).
    score += Math.max(0, 20 - title.length);
    return score;
  }
  // 2. Exact substring in subtitle.
  if (subtitle) {
    const s = subtitle.toLowerCase();
    if (s.includes(q)) return 40;
  }
  // 3. Subsequence in title.
  let qi = 0;
  let prevHit = -2;
  let runs = 0; // count of consecutive-character runs (more = tighter match)
  let boundaryHits = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t.charCodeAt(i) === q.charCodeAt(qi)) {
      if (i === prevHit + 1) {
        // Same run as the previous char; not a new run.
      } else {
        runs += 1;
        if (i === 0 || /[\s-_/.]/.test(t.charAt(i - 1))) boundaryHits += 1;
      }
      prevHit = i;
      qi += 1;
    }
  }
  if (qi < q.length) return 0; // didn't consume the whole query
  let score = 60;
  // Penalize stringier matches (more runs = more gaps between hits).
  score -= Math.max(0, (runs - 1) * 6);
  score += boundaryHits * 8;
  // Shorter titles → tighter match.
  score += Math.max(0, 15 - title.length / 2);
  return Math.max(1, score);
}
