import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildZipBlob, readZipBlob } from '../utils/zip';
import { SyncPanel } from './SyncPanel';
import { ArtifactPreview } from '../shell/ArtifactPreview';
import { showToast } from '../shell/Toast';
import './Settings.css';

interface Props {
  agentName: string;
  email: string;
}

type SettingsTab =
  | 'general'
  | 'behavior'
  | 'automation'
  | 'spending'
  | 'knowledge'
  | 'invocations'
  | 'cloudflare'
  | 'access'
  | 'skills'
  | 'sync'
  | 'audit'
  | 'danger';

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'automation', label: 'Automation' },
  { id: 'spending', label: 'Spending' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'invocations', label: 'Invocations' },
  { id: 'cloudflare', label: 'Cloudflare' },
  { id: 'access', label: 'Access' },
  { id: 'skills', label: 'Skills' },
  { id: 'sync', label: 'Sync' },
  { id: 'audit', label: 'Audit log' },
  { id: 'danger', label: 'Danger zone' },
];

export function Settings({ agentName, email }: Props) {
  // Tab state respects the URL hash so deep-links (`#/settings?tab=audit&id=<id>`)
  // open the right section + auto-expand the right row. The tab change
  // also rewrites the hash so back/forward navigation feels native.
  const [tab, setTab] = useState<SettingsTab>(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    const t = params.get('tab');
    const valid: SettingsTab[] = [
      'general',
      'behavior',
      'automation',
      'spending',
      'knowledge',
      'invocations',
      'cloudflare',
      'access',
      'skills',
      'sync',
      'audit',
      'danger',
    ];
    return valid.includes(t as SettingsTab) ? (t as SettingsTab) : 'automation';
  });
  const selectTab = (next: SettingsTab) => {
    setTab(next);
    // Strip query so we don't carry a stale `id=...` across tab switches.
    window.history.replaceState(null, '', '#/settings?tab=' + next);
  };
  // Keyboard navigation: `[` and `]` (or `j`/`k`) step through the
  // tabs. We skip input/textarea targets so the user can still type
  // brackets into the Behavior prompt or the Audit search box without
  // triggering tab walks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) {
          return;
        }
      }
      // Avoid hijacking ⌘/Ctrl-modified keys (those belong to the
      // browser or other shortcuts).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const ids = TABS.map((t) => t.id);
      const here = ids.indexOf(tab);
      if (here < 0) return;
      let next = here;
      if (e.key === ']' || e.key === 'k' || e.key === 'K') {
        next = (here + 1) % ids.length;
      } else if (e.key === '[' || e.key === 'j' || e.key === 'J') {
        next = (here - 1 + ids.length) % ids.length;
      } else {
        return;
      }
      e.preventDefault();
      const nextId = ids[next];
      if (nextId) selectTab(nextId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Track which tabs currently have pending (unsaved) edits. Tabs
  // dispatch `openthink:settings-dirty` events carrying their id +
  // dirty bool; we render a small accent dot in the nav so the user
  // can see at a glance that they've got staged changes in another
  // pane. Also gates a beforeunload prompt so a hard refresh doesn't
  // silently lose Behavior edits.
  const [dirtyTabs, setDirtyTabs] = useState<Set<SettingsTab>>(new Set());
  // Per-tab active-filter counts. Tabs that have user-applied filters
  // (kind, date, search, density toggles, etc.) dispatch
  // `openthink:settings-filter-count` events with `{tab, count}` so
  // the nav can surface a small numeric badge. Count of 0 = no
  // filters active (badge hidden).
  const [filterCounts, setFilterCounts] = useState<Record<string, number>>({});
  // Per-tab "attention" markers — tabs that have a real situation the
  // user should look at (sync behind, spend cap reached, pending
  // memory suggestions, etc.) dispatch `openthink:settings-attention`
  // with `{tab, reason}` to surface, or `{tab, reason: null}` to clear.
  // Rendered as a warning-colored "!" dot on the tab, distinct from
  // the dirty dot and the filter-count badge.
  const [attentionTabs, setAttentionTabs] = useState<Record<string, string>>({});
  // Set of tabs whose attention badge just lit up (or changed reason).
  // Drives a transient "pulse" animation so a new alert grabs the
  // user's eye even when they're focused on another pane. Entries
  // age out after ~2.5s via a per-tab timer so the animation doesn't
  // run forever and become noise. Excluded for the active tab (no
  // sense pulsing what the user is already looking at).
  const [pulsingTabs, setPulsingTabs] = useState<Set<string>>(new Set());
  // Stable map of pulse-clear timers keyed by tab. Held in a ref so
  // rapid re-bumps can reset their own deadline without leaking.
  const pulseTimersRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const onAttention = (e: Event) => {
      const detail = (e as CustomEvent<{ tab: SettingsTab; reason: string | null }>).detail;
      if (!detail) return;
      setAttentionTabs((prev) => {
        if (detail.reason) {
          if (prev[detail.tab] === detail.reason) return prev;
          // Fresh attention OR a changed reason — trigger the pulse
          // unless the user is already looking at this tab.
          const tabId: string = detail.tab;
          // We can't read `tab` here without re-rendering, so we
          // dispatch the pulse from the same handler. The pulse
          // listener handles the active-tab suppression itself.
          window.queueMicrotask(() => {
            window.dispatchEvent(
              new CustomEvent('openthink:settings-attention-pulse', {
                detail: { tab: tabId },
              }),
            );
          });
          return { ...prev, [tabId]: detail.reason };
        } else {
          if (!(detail.tab in prev)) return prev;
          const next = { ...prev };
          delete next[detail.tab];
          return next;
        }
      });
    };
    window.addEventListener('openthink:settings-attention', onAttention);
    return () =>
      window.removeEventListener('openthink:settings-attention', onAttention);
  }, []);
  // Pulse handler — independent listener so it can read the current
  // `tab` value via closure when the parent re-renders. Suppresses
  // the pulse on the active tab so the user doesn't see an animation
  // on what they're actively viewing.
  useEffect(() => {
    const onPulse = (e: Event) => {
      const detail = (e as CustomEvent<{ tab: string }>).detail;
      if (!detail) return;
      // Snapshot timers ref into a local so the listener doesn't go
      // stale across re-renders.
      const timers = pulseTimersRef.current;
      if (detail.tab === tab) return;
      setPulsingTabs((prev) => {
        if (prev.has(detail.tab)) return prev;
        const next = new Set(prev);
        next.add(detail.tab);
        return next;
      });
      // Reset any in-flight clear for this tab — fresh attention
      // should restart the timer rather than fade halfway through.
      if (timers[detail.tab]) {
        window.clearTimeout(timers[detail.tab]);
      }
      timers[detail.tab] = window.setTimeout(() => {
        setPulsingTabs((prev) => {
          if (!prev.has(detail.tab)) return prev;
          const next = new Set(prev);
          next.delete(detail.tab);
          return next;
        });
        delete timers[detail.tab];
      }, 2500);
    };
    window.addEventListener('openthink:settings-attention-pulse', onPulse);
    return () => {
      window.removeEventListener('openthink:settings-attention-pulse', onPulse);
    };
  }, [tab]);
  // Clear any pulse on a tab the user is about to view — they're
  // about to see the dot directly, no need to animate. Also frees
  // the timer so it doesn't fire after the user has already
  // acknowledged the alert by clicking through.
  useEffect(() => {
    const timers = pulseTimersRef.current;
    if (pulsingTabs.has(tab)) {
      setPulsingTabs((prev) => {
        if (!prev.has(tab)) return prev;
        const next = new Set(prev);
        next.delete(tab);
        return next;
      });
      if (timers[tab]) {
        window.clearTimeout(timers[tab]);
        delete timers[tab];
      }
    }
  }, [tab, pulsingTabs]);

  // Cross-tab danger-row attention — the Audit component only mounts
  // when its tab is active, so we need a lightweight poll at the
  // shell level to detect new danger rows arriving in the background.
  // Polls every 30s for the single most-recent danger row; compares
  // to the user's localStorage cursor; dispatches attention when the
  // newest danger row is past the cursor. Re-evaluates immediately
  // when the Audit pane bumps the cursor.
  useEffect(() => {
    let cancelled = false;
    const evaluate = async () => {
      try {
        const res = await fetch(
          `/api/audit/${encodeURIComponent(agentName || 'default')}?kind=danger&limit=1`,
        );
        const data = (await res.json()) as { entries?: AuditEntry[] };
        const newest = data.entries?.[0]?.createdAt ?? 0;
        if (cancelled) return;
        const cursor = Number(
          window.localStorage.getItem('openthink:audit-danger-seen') ?? '0',
        );
        const reason =
          newest > cursor
            ? 'unread danger event since last Audit visit'
            : null;
        window.dispatchEvent(
          new CustomEvent('openthink:settings-attention', {
            detail: { tab: 'audit', reason },
          }),
        );
      } catch {
        /* quiet — transient errors don't change the badge state */
      }
    };
    void evaluate();
    const id = window.setInterval(evaluate, 30_000);
    const onBumped = () => void evaluate();
    window.addEventListener('openthink:audit-danger-seen-bumped', onBumped);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('openthink:audit-danger-seen-bumped', onBumped);
    };
  }, [agentName]);
  useEffect(() => {
    const onFilterCount = (e: Event) => {
      const detail = (e as CustomEvent<{ tab: SettingsTab; count: number }>).detail;
      if (!detail) return;
      setFilterCounts((prev) => {
        if ((prev[detail.tab] ?? 0) === detail.count) return prev;
        const next = { ...prev };
        if (detail.count > 0) next[detail.tab] = detail.count;
        else delete next[detail.tab];
        return next;
      });
    };
    window.addEventListener('openthink:settings-filter-count', onFilterCount);
    return () =>
      window.removeEventListener('openthink:settings-filter-count', onFilterCount);
  }, []);
  useEffect(() => {
    const onDirty = (e: Event) => {
      const detail = (e as CustomEvent<{ tab: SettingsTab; dirty: boolean }>).detail;
      if (!detail) return;
      setDirtyTabs((prev) => {
        const next = new Set(prev);
        if (detail.dirty) next.add(detail.tab);
        else next.delete(detail.tab);
        return next;
      });
    };
    window.addEventListener('openthink:settings-dirty', onDirty);
    return () => window.removeEventListener('openthink:settings-dirty', onDirty);
  }, []);
  useEffect(() => {
    if (dirtyTabs.size === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirtyTabs]);

  return (
    <div className="settings">
      <aside className="settings__nav">
        <h2>Settings</h2>
        <ul>
          {TABS.map((t) => {
            const dirty = dirtyTabs.has(t.id);
            const filterCount = filterCounts[t.id] ?? 0;
            const attention = attentionTabs[t.id];
            return (
              <li key={t.id}>
                <button
                  className={`settings__tab${tab === t.id ? ' settings__tab--active' : ''}${dirty ? ' settings__tab--dirty' : ''}${attention ? ' settings__tab--attention' : ''}`}
                  onClick={() => selectTab(t.id)}
                  aria-label={
                    dirty
                      ? `${t.label} (unsaved changes)`
                      : attention
                        ? `${t.label} (${attention})`
                        : filterCount > 0
                          ? `${t.label} (${filterCount} active filter${filterCount === 1 ? '' : 's'})`
                          : t.label
                  }
                >
                  {t.label}
                  {dirty && <span className="settings__tab-dot" aria-hidden>•</span>}
                  {!dirty && attention && (
                    <span
                      className={`settings__tab-attention${
                        pulsingTabs.has(t.id) ? ' settings__tab-attention--pulse' : ''
                      }`}
                      title={attention}
                      aria-hidden
                    >
                      !
                    </span>
                  )}
                  {!dirty && !attention && filterCount > 0 && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="settings__tab-filter-badge"
                      title={`${filterCount} active filter${filterCount === 1 ? '' : 's'} · click to clear`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        // Broadcast a clear request. Tabs that source
                        // their own filters listen for this and reset
                        // their state — saves the user a click into
                        // the tab to find the clear button.
                        window.dispatchEvent(
                          new CustomEvent('openthink:settings-clear-filters', {
                            detail: { tab: t.id },
                          }),
                        );
                      }}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          ev.stopPropagation();
                          window.dispatchEvent(
                            new CustomEvent('openthink:settings-clear-filters', {
                              detail: { tab: t.id },
                            }),
                          );
                        }
                      }}
                    >
                      {filterCount}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <section className="settings__main">
        {tab === 'general' && <General agentName={agentName} email={email} />}
        {tab === 'behavior' && <Behavior agentName={agentName} />}
        {tab === 'automation' && <Automation agentName={agentName} />}
        {tab === 'spending' && <Spending agentName={agentName} />}
        {tab === 'knowledge' && <Knowledge agentName={agentName} />}
        {tab === 'invocations' && <Invocations agentName={agentName} />}
        {tab === 'cloudflare' && <Cloudflare />}
        {tab === 'access' && <Access email={email} agentName={agentName} />}
        {tab === 'skills' && <SkillsTab />}
        {tab === 'sync' && <Sync />}
        {tab === 'audit' && <Audit agentName={agentName} />}
        {tab === 'danger' && <DangerZone agentName={agentName} />}
      </section>
    </div>
  );
}

function General({ agentName, email }: { agentName: string; email: string }) {
  const [exporting, setExporting] = useState(false);

  const exportAllThreads = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // First pull the canonical thread list. We grab up to 50; if a user
      // somehow has more, they'd need a paginated export — out of scope.
      const listRes = await fetch(
        `/api/threads/${encodeURIComponent(agentName || 'default')}?limit=50`,
      );
      const listData = (await listRes.json()) as {
        threads?: Array<{ id: string; title: string; updatedAt: number; pinned?: boolean }>;
      };
      const threads = listData.threads ?? [];
      if (threads.length === 0) {
        showToast('No threads to export', 'info');
        return;
      }
      // Fetch each thread's tail in parallel (capped at 6 concurrent so we
      // don't slam the DO). 200-turn tail covers every realistic thread.
      const bodies: Array<{
        thread: { id: string; title: string };
        messages: Array<{ role: string; content: string; createdAt: number }>;
      }> = [];
      const cohort = 6;
      for (let i = 0; i < threads.length; i += cohort) {
        const batch = threads.slice(i, i + cohort);
        const fetched = await Promise.all(
          batch.map(async (t) => {
            const res = await fetch(
              `/api/threads/${encodeURIComponent(agentName || 'default')}/${encodeURIComponent(t.id)}?tail=200`,
            );
            const data = (await res.json()) as {
              ok?: boolean;
              thread?: { id: string; title: string };
              messages?: Array<{ role: string; content: string; createdAt: number }>;
            };
            return {
              thread: data.thread ?? { id: t.id, title: t.title },
              messages: data.messages ?? [],
            };
          }),
        );
        bodies.push(...fetched);
      }
      // Format: one big markdown file with a top header + each thread as
      // an H1 section. Same per-message shape as the single-thread export
      // (`## <role> · <ISO ts>`) so a downstream parser only needs one
      // recognizer.
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const header = [
        `# ${agentName} — full thread archive`,
        '',
        `_exported ${new Date().toLocaleString()} · ${bodies.length} thread${bodies.length === 1 ? '' : 's'}_`,
        '',
      ].join('\n');
      const sections = bodies
        .map((b) => {
          const heading = `\n---\n\n# ${b.thread.title || b.thread.id}\n`;
          const body = b.messages
            .map((m) => {
              const who = m.role === 'user' ? 'You' : agentName || 'agent';
              const when = new Date(m.createdAt).toISOString();
              return `\n## ${who} · ${when}\n\n${m.content}\n`;
            })
            .join('');
          return heading + (body || '\n_(no messages)_\n');
        })
        .join('\n');
      const md = header + sections;
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${agentName || 'agent'}-all-threads-${stamp}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 500);
      showToast(`Exported ${bodies.length} thread${bodies.length === 1 ? '' : 's'}`, 'ok');
    } catch {
      showToast('Export failed', 'err');
    } finally {
      setExporting(false);
    }
  };

  return (
    <SettingsPane title="General" lede="Identity, language, time zone.">
      <Field label="Agent name" value={agentName} />
      <Field label="Owner email" value={email} />
      <Field label="Time zone" value={Intl.DateTimeFormat().resolvedOptions().timeZone} />
      <div className="settings__field">
        <span className="ot-label">Data export</span>
        <p className="ot-micro">
          Download every thread this agent has, as a single markdown file. Useful
          for backups or migrating off OpenThink.
        </p>
        <button
          type="button"
          className="ot-btn ot-btn--ghost"
          onClick={() => void exportAllThreads()}
          disabled={exporting}
          style={{ width: 'max-content' }}
        >
          {exporting ? 'Building archive…' : 'Export all threads ↓'}
        </button>
      </div>
      <ConfigBackup agentName={agentName} />
      <FullSnapshotExport agentName={agentName} />
    </SettingsPane>
  );
}

// Full-agent snapshot — bundles every JSON-shaped piece of state
// scoped to this agent into a single .zip. Reuses the shared zip
// writer. Each section lands as a top-level file in the archive so
// a restore script (or human curator) can pick + choose. Doesn't
// include the artifact binaries (those have their own Library
// export); does include the artifact MANIFEST so a recipient knows
// what was in R2 at snapshot time.
function FullSnapshotExport({ agentName }: { agentName: string }) {
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  // Last import outcome — surfaced inline below the buttons so the
  // user can review per-section results after the toast fades.
  const [importSummary, setImportSummary] = useState<{
    at: number;
    restored: Array<{ section: string; detail: string }>;
    skipped: Array<{ section: string; detail: string }>;
    manualOnly: string[];
    error?: string;
  } | null>(null);

  const importSnapshot = async (file: File) => {
    setImportBusy(true);
    try {
      const entries = await readZipBlob(file);
      if (entries.length === 0) {
        showToast('Not a valid snapshot zip (or contains compressed entries)', 'err');
        return;
      }
      // Parse each entry as JSON and dispatch to the right write
      // endpoint. Currently only `config.json` is auto-restorable —
      // the rest get counted into the toast so the user knows what
      // their snapshot contained even if it isn't auto-replayed yet.
      const dec = new TextDecoder();
      const sections = new Map<string, unknown>();
      for (const e of entries) {
        try {
          sections.set(e.name, JSON.parse(dec.decode(e.data)));
        } catch {
          /* skip un-parseable */
        }
      }
      // Restore phases — each returns a small summary so the final
      // toast can read like "Restored config · 47 memories · 2 sections
      // manual-only".
      const restored: string[] = [];
      const skipped: string[] = [];
      const summaryRestored: Array<{ section: string; detail: string }> = [];
      const summarySkipped: Array<{ section: string; detail: string }> = [];

      const config = sections.get('config.json');
      if (
        config &&
        typeof config === 'object' &&
        !Array.isArray(config) &&
        window.confirm(
          `Merge ${Object.keys(config).length} config keys into this agent? Same-named keys overwrite; untouched keys survive.`,
        )
      ) {
        try {
          const res = await fetch(
            `/api/settings/${encodeURIComponent(agentName || 'default')}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(config),
            },
          );
          if (res.ok) {
            restored.push('config');
            summaryRestored.push({
              section: 'config',
              detail: `${Object.keys(config).length} key${Object.keys(config).length === 1 ? '' : 's'} merged`,
            });
          }
        } catch {
          /* config restore failed — surfaced via the final toast */
        }
      }

      const memoriesSection = sections.get('memories.json') as
        | { memories?: Array<unknown> }
        | unknown[]
        | undefined;
      const memoriesList = Array.isArray(memoriesSection)
        ? memoriesSection
        : Array.isArray(memoriesSection?.memories)
          ? memoriesSection!.memories!
          : null;
      if (
        memoriesList &&
        memoriesList.length > 0 &&
        window.confirm(
          `Restore ${memoriesList.length} memor${memoriesList.length === 1 ? 'y' : 'ies'}? Duplicates (same category + content) are skipped.`,
        )
      ) {
        try {
          const res = await fetch('/api/learning/memories/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ memories: memoriesList }),
          });
          const data = (await res.json()) as {
            ok: boolean;
            added?: number;
            skipped?: number;
          };
          if (data.ok) {
            restored.push(`${data.added ?? 0} memor${data.added === 1 ? 'y' : 'ies'}`);
            summaryRestored.push({
              section: 'memories',
              detail: `${data.added ?? 0} added`,
            });
            if (data.skipped) {
              skipped.push(`${data.skipped} memor${data.skipped === 1 ? 'y' : 'ies'} (dup)`);
              summarySkipped.push({
                section: 'memories',
                detail: `${data.skipped} duplicate${data.skipped === 1 ? '' : 's'}`,
              });
            }
          }
        } catch {
          /* memory restore failed — surfaced via the final toast */
        }
      }

      const knowledgeSection = sections.get('knowledge.json') as
        | { items?: Array<unknown> }
        | unknown[]
        | undefined;
      const knowledgeList = Array.isArray(knowledgeSection)
        ? knowledgeSection
        : Array.isArray(knowledgeSection?.items)
          ? knowledgeSection!.items!
          : null;
      if (
        knowledgeList &&
        knowledgeList.length > 0 &&
        window.confirm(
          `Restore ${knowledgeList.length} knowledge item${knowledgeList.length === 1 ? '' : 's'}? URL items insert directly; file/text items keep their R2 keys (the underlying bytes would need to be uploaded separately).`,
        )
      ) {
        try {
          const res = await fetch(
            `/api/knowledge/${encodeURIComponent(agentName || 'default')}/bulk`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ items: knowledgeList }),
            },
          );
          const data = (await res.json()) as {
            ok: boolean;
            added?: number;
            skipped?: number;
          };
          if (data.ok) {
            restored.push(`${data.added ?? 0} knowledge`);
            summaryRestored.push({
              section: 'knowledge',
              detail: `${data.added ?? 0} added`,
            });
            if (data.skipped) {
              skipped.push(`${data.skipped} knowledge (dup)`);
              summarySkipped.push({
                section: 'knowledge',
                detail: `${data.skipped} duplicate${data.skipped === 1 ? '' : 's'}`,
              });
            }
          }
        } catch {
          /* knowledge restore failed */
        }
      }

      const stillManualOnly = [
        'threads.json',
        'skills.json',
        'audit.json',
        'invocations.json',
        'artifacts.json',
        'workflows.json',
      ].filter((n) => sections.has(n));
      showToast(
        restored.length > 0
          ? `Restored ${restored.join(' · ')}${
              skipped.length > 0 ? ` · skipped ${skipped.join(' · ')}` : ''
            }${
              stillManualOnly.length > 0
                ? ` · ${stillManualOnly.length} section${stillManualOnly.length === 1 ? '' : 's'} manual-only`
                : ''
            }`
          : stillManualOnly.length > 0
            ? `Snapshot has ${stillManualOnly.length} section${stillManualOnly.length === 1 ? '' : 's'} — none auto-restorable yet`
            : 'Snapshot was empty',
        restored.length > 0 ? 'ok' : 'info',
      );
      // Persist the per-section result inline so the user can review
      // it after the toast fades — useful for snapshots with several
      // dozen items where the toast can't fit the full breakdown.
      setImportSummary({
        at: Date.now(),
        restored: summaryRestored,
        skipped: summarySkipped,
        manualOnly: stillManualOnly,
      });
    } catch {
      showToast('Couldn’t read snapshot zip', 'err');
    } finally {
      setImportBusy(false);
    }
  };

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const enc = new TextEncoder();
      // Fan out every endpoint in parallel; tolerate per-source
      // failures so a missing optional binding (e.g. no D1 audit
      // table yet) doesn't abort the whole snapshot.
      const fetchJSON = async (
        path: string,
      ): Promise<unknown | null> => {
        try {
          const r = await fetch(path);
          if (!r.ok) return null;
          return await r.json();
        } catch {
          return null;
        }
      };
      const [
        config,
        threads,
        memories,
        skills,
        knowledge,
        audit,
        invocations,
        artifacts,
        workflows,
      ] = await Promise.all([
        fetchJSON(`/api/settings/${encodeURIComponent(agentName || 'default')}`),
        fetchJSON(`/api/threads/${encodeURIComponent(agentName || 'default')}?limit=200`),
        fetchJSON('/api/learning/memories'),
        fetchJSON('/api/skills'),
        fetchJSON(`/api/knowledge/${encodeURIComponent(agentName || 'default')}`),
        fetchJSON(`/api/audit/${encodeURIComponent(agentName || 'default')}?limit=100`),
        fetchJSON(`/api/invocations/${encodeURIComponent(agentName || 'default')}`),
        fetchJSON(`/api/artifacts/list/${encodeURIComponent(agentName || 'default')}`),
        fetchJSON('/api/goal?limit=50'),
      ]);

      const stamp = new Date().toISOString();
      const manifest = {
        agent: agentName || 'default',
        exportedAt: stamp,
        version: '0.1.0',
        sections: {
          config: !!config,
          threads: !!threads,
          memories: !!memories,
          skills: !!skills,
          knowledge: !!knowledge,
          audit: !!audit,
          invocations: !!invocations,
          artifacts: !!artifacts,
          workflows: !!workflows,
        },
      };

      const entries: Array<{ name: string; data: Uint8Array }> = [];
      const j = (name: string, payload: unknown) => {
        if (payload === null) return;
        entries.push({
          name,
          data: enc.encode(JSON.stringify(payload, null, 2)),
        });
      };
      j('manifest.json', manifest);
      j('config.json', config);
      j('threads.json', threads);
      j('memories.json', memories);
      j('skills.json', skills);
      j('knowledge.json', knowledge);
      j('audit.json', audit);
      j('invocations.json', invocations);
      j('artifacts.json', artifacts);
      j('workflows.json', workflows);

      const blob = buildZipBlob(entries);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stampSlug = stamp.slice(0, 16).replace(/[:T]/g, '-');
      a.download = `${agentName || 'agent'}-snapshot-${stampSlug}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 500);
      showToast(`Snapshot exported · ${entries.length - 1} sections`, 'ok');
    } catch {
      showToast('Snapshot failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings__field">
      <span className="ot-label">Full agent snapshot</span>
      <p className="ot-micro">
        One-shot zip bundling every JSON shape the agent owns: config,
        thread tails, memories, skills, knowledge, audit log, invocations,
        artifact manifest, workflow runs. Each section lands as its own
        top-level JSON file so a downstream restore can pick + choose.
      </p>
      <div className="settings__config-backup-row">
        <button
          type="button"
          className="ot-btn ot-btn--ghost"
          onClick={() => void run()}
          disabled={busy || importBusy}
        >
          {busy ? 'Bundling…' : '↓ Export snapshot (zip)'}
        </button>
        <input
          ref={importFileRef}
          type="file"
          accept="application/zip,.zip"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importSnapshot(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="ot-btn ot-btn--ghost"
          onClick={() => importFileRef.current?.click()}
          disabled={busy || importBusy}
          title="Import a snapshot zip — currently only the config section auto-replays"
        >
          {importBusy ? 'Reading…' : '↑ Import snapshot (zip)'}
        </button>
      </div>
      {importSummary && (
        <div
          className="settings__import-summary"
          role="status"
          aria-live="polite"
        >
          <div className="settings__import-summary-head">
            <strong>Last import · {new Date(importSummary.at).toLocaleTimeString()}</strong>
            <button
              type="button"
              className="settings__import-summary-dismiss"
              onClick={() => setImportSummary(null)}
              aria-label="Dismiss import summary"
            >
              ×
            </button>
          </div>
          {importSummary.restored.length > 0 && (
            <div className="settings__import-summary-group">
              <span className="ot-micro">Restored</span>
              <ul>
                {importSummary.restored.map((r) => (
                  <li key={`r-${r.section}`}>
                    <span className="settings__import-summary-tag settings__import-summary-tag--ok">
                      {r.section}
                    </span>
                    <span>{r.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {importSummary.skipped.length > 0 && (
            <div className="settings__import-summary-group">
              <span className="ot-micro">Skipped</span>
              <ul>
                {importSummary.skipped.map((s) => (
                  <li key={`s-${s.section}`}>
                    <span className="settings__import-summary-tag settings__import-summary-tag--info">
                      {s.section}
                    </span>
                    <span>{s.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {importSummary.manualOnly.length > 0 && (
            <div className="settings__import-summary-group">
              <span className="ot-micro">Manual-only sections in this snapshot</span>
              <p className="settings__import-summary-manual">
                {importSummary.manualOnly
                  .map((m) => m.replace(/\.json$/, ''))
                  .join(', ')}{' '}
                — auto-restore endpoints for these aren't wired yet.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Full-config backup/restore — dumps the agent's settings blob (the
// shallow-merged KV value behind /api/settings/<agent>) to a JSON file
// the user can stash + later import. Captures Behavior, Automation,
// Spending cap, deny-list, response style, model overrides, etc. —
// everything that lives in `settings:<agent>` KV. Doesn't cover
// threads (those have their own Export), Knowledge (separate route),
// or Skills (separate route).
function ConfigBackup({ agentName }: { agentName: string }) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const exportConfig = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/settings/${encodeURIComponent(agentName || 'default')}`,
      );
      const data = (await res.json()) as Record<string, unknown> | null;
      const blob = new Blob([JSON.stringify(data ?? {}, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      a.download = `${agentName || 'agent'}-config-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 500);
      showToast('Config exported', 'ok');
    } catch {
      showToast('Export failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  const importConfig = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        showToast('Not a valid config blob', 'err');
        return;
      }
      if (
        !window.confirm(
          'Merge this config into the current agent? Existing fields with the same name will be overwritten.',
        )
      ) {
        return;
      }
      const res = await fetch(
        `/api/settings/${encodeURIComponent(agentName || 'default')}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed),
        },
      );
      if (res.ok) {
        showToast('Config imported', 'ok');
      } else {
        showToast('Import failed', 'err');
      }
    } catch {
      showToast('Couldn’t parse JSON', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings__field">
      <span className="ot-label">Agent config backup</span>
      <p className="ot-micro">
        Dumps every key in this agent's settings blob (Behavior,
        Automation, Spending cap, deny list, response style, model
        overrides) to a JSON file. Importing merges into the live
        config — same-named keys are overwritten.
      </p>
      <div className="settings__config-backup-row">
        <button
          type="button"
          className="ot-btn ot-btn--ghost"
          onClick={() => void exportConfig()}
          disabled={busy}
        >
          ↓ Export config
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importConfig(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="ot-btn ot-btn--ghost"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          ↑ Import config
        </button>
      </div>
    </div>
  );
}

function Automation({ agentName }: { agentName: string }) {
  const [mode, setModeState] = useState<'full_auto' | 'smart_auto' | 'manual'>('smart_auto');
  const [denyTools, setDenyTools] = useState<string[]>([]);
  const [denyDraft, setDenyDraft] = useState('');
  // Load persisted mode + deny list from KV on mount.
  useEffect(() => {
    void fetch(`/api/settings/${encodeURIComponent(agentName || 'default')}`)
      .then((r) => r.json())
      .then((data: { approvalMode?: string; denyTools?: unknown } | null) => {
        if (
          data &&
          (data.approvalMode === 'full_auto' ||
            data.approvalMode === 'smart_auto' ||
            data.approvalMode === 'manual')
        ) {
          setModeState(data.approvalMode);
        }
        if (data && Array.isArray(data.denyTools)) {
          setDenyTools(data.denyTools.filter((t): t is string => typeof t === 'string'));
        }
      })
      .catch(() => undefined);
  }, [agentName]);
  const setMode = (next: 'full_auto' | 'smart_auto' | 'manual') => {
    setModeState(next);
    // Persist to KV so the next chat session picks it up. The Shell reads
    // /api/settings/<agentId> on socket-open and dispatches set-approval-mode
    // through the WS bridge. The route does a shallow merge, so passing
    // only the changed field is correct.
    void fetch(`/api/settings/${encodeURIComponent(agentName || 'default')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalMode: next }),
    })
      .then((r) => {
        if (r.ok) showToast(`Automation set to ${next.replace('_', ' ')}`, 'ok');
        else showToast('Save failed', 'err');
      })
      .catch(() => showToast('Save failed', 'err'));
  };

  const persistDenyTools = (next: string[]) => {
    void fetch(`/api/settings/${encodeURIComponent(agentName || 'default')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ denyTools: next }),
    })
      .then((r) => {
        if (r.ok) showToast('Deny list saved', 'ok');
        else showToast('Save failed', 'err');
      })
      .catch(() => showToast('Save failed', 'err'));
  };

  const addDenyTool = () => {
    const v = denyDraft.trim().toLowerCase();
    if (!v) return;
    if (denyTools.includes(v)) {
      setDenyDraft('');
      return;
    }
    const next = [...denyTools, v];
    setDenyTools(next);
    setDenyDraft('');
    persistDenyTools(next);
  };
  const removeDenyTool = (t: string) => {
    const next = denyTools.filter((x) => x !== t);
    setDenyTools(next);
    persistDenyTools(next);
  };
  return (
    <SettingsPane title="Automation" lede="How much rope the agent gets.">
      <div className="settings__mode-picker">
        <ModeOption
          name="full_auto"
          title="Full Auto"
          subtitle="Execute every tool unless the spend cap stops it."
          active={mode === 'full_auto'}
          onPick={() => setMode('full_auto')}
        />
        <ModeOption
          name="smart_auto"
          title="Smart Auto"
          subtitle="Read-only is automatic. Side-effect calls prompt for approval."
          active={mode === 'smart_auto'}
          onPick={() => setMode('smart_auto')}
          recommended
        />
        <ModeOption
          name="manual"
          title="Manual"
          subtitle="Always prompt. Best for critical-infrastructure agents."
          active={mode === 'manual'}
          onPick={() => setMode('manual')}
        />
      </div>
      <div className="settings__deny">
        <h4>Always require approval for these tools</h4>
        <p className="ot-micro">
          Tools listed here are blocked from auto-run regardless of mode. Prefix-match
          works: <code>coder.</code> blocks <code>coder.exec</code> and <code>coder.review</code>.
        </p>
        <div className="settings__deny-row">
          {denyTools.map((t) => (
            <span key={t} className="settings__deny-chip">
              <code>{t}</code>
              <button
                type="button"
                onClick={() => removeDenyTool(t)}
                aria-label={`Remove ${t}`}
                className="settings__deny-chip-x"
              >
                ×
              </button>
            </span>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addDenyTool();
            }}
            className="settings__deny-form"
          >
            <input
              className="ot-input settings__deny-input"
              type="text"
              placeholder="e.g. coder.exec, browser-session.takeover"
              value={denyDraft}
              onChange={(e) => setDenyDraft(e.target.value)}
            />
            <button
              type="submit"
              className="ot-btn ot-btn--ghost"
              disabled={!denyDraft.trim()}
            >
              Add
            </button>
          </form>
        </div>
      </div>
      <div className="settings__overrides">
        <h4>Per-skill overrides</h4>
        <p className="ot-micro">
          Override the global mode on a per-skill basis (e.g. <code>pack:gstack</code> Full
          Auto, <code>stripe-payments</code> Manual).
        </p>
        <table className="settings__overrides-table">
          <thead>
            <tr>
              <th>Skill</th>
              <th>Mode</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>cloudflare-workers</td>
              <td>
                <select defaultValue="smart_auto" className="ot-input">
                  <option value="full_auto">Full Auto</option>
                  <option value="smart_auto">Smart Auto</option>
                  <option value="manual">Manual</option>
                </select>
              </td>
            </tr>
            <tr>
              <td>stripe-payments</td>
              <td>
                <select defaultValue="manual" className="ot-input">
                  <option value="full_auto">Full Auto</option>
                  <option value="smart_auto">Smart Auto</option>
                  <option value="manual">Manual</option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SettingsPane>
  );
}

// Same RFC4180 quoting rule the Invocations and Audit exports use.
function escapeCsv(val: unknown): string {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Shape of a `tool_call` audit row's payload that the per-tool
// drilldown actually consumes. Other fields may be present (caller
// agent, args summary, etc.) — those flow through `[k: string]:
// unknown` so we don't choke on unknown keys.
interface ToolCallPayload {
  tool?: string;
  costCents?: number;
  durationMs?: number;
  agent?: string;
  ok?: boolean;
  error?: string;
  [k: string]: unknown;
}

// Export today's per-tool spend as a structured JSON document — sibling
// to the CSV path for downstream tools that want a tree (jq, dashboards)
// over a tabular view. Same `spend` source-of-truth so filters carry
// through. Pretty-printed at 2 spaces for legibility.
function downloadSpendJson(
  agentName: string,
  spend: {
    spentCentsToday: number;
    spentCentsYesterday?: number;
    capCents: number;
    perTool: Array<{ tool: string; cents: number; hourly?: number[] }>;
    resetAt: number;
  },
) {
  if (spend.perTool.length === 0) return;
  const now = Date.now();
  const doc = {
    agent: agentName || 'agent',
    exportedAt: new Date(now).toISOString(),
    exportedAtMs: now,
    capCents: spend.capCents,
    capDollars: spend.capCents / 100,
    spentCentsToday: spend.spentCentsToday,
    spentDollarsToday: Number((spend.spentCentsToday / 100).toFixed(4)),
    spentCentsYesterday: spend.spentCentsYesterday,
    capUtilizationPct:
      spend.capCents > 0
        ? Number(((spend.spentCentsToday / spend.capCents) * 100).toFixed(2))
        : 0,
    resetAtMs: spend.resetAt,
    resetAtIso: new Date(spend.resetAt).toISOString(),
    perTool: spend.perTool.map((row) => ({
      tool: row.tool,
      cents: row.cents,
      dollars: Number((row.cents / 100).toFixed(4)),
      sharePct:
        spend.spentCentsToday > 0
          ? Number(((row.cents / spend.spentCentsToday) * 100).toFixed(2))
          : 0,
      hourly: row.hourly ?? [],
    })),
  };
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.download = `spend-${agentName || 'agent'}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
  showToast(`Exported ${spend.perTool.length} row${spend.perTool.length === 1 ? '' : 's'} as JSON`, 'ok');
}

// Export today's per-tool spend as a CSV. One row per tool with the
// running total, share of cap, and cents — plus a footer row carrying
// the cap and reset timestamp for context.
function downloadSpendCsv(
  agentName: string,
  spend: {
    spentCentsToday: number;
    capCents: number;
    perTool: Array<{ tool: string; cents: number; hourly?: number[] }>;
    resetAt: number;
  },
) {
  if (spend.perTool.length === 0) return;
  const lines = ['Tool,Cents,Share %'];
  for (const row of spend.perTool) {
    const share = spend.spentCentsToday > 0
      ? ((row.cents / spend.spentCentsToday) * 100).toFixed(1)
      : '0.0';
    lines.push([row.tool, row.cents, share].map(escapeCsv).join(','));
  }
  lines.push('');
  lines.push(
    [
      'TOTAL',
      spend.spentCentsToday,
      spend.capCents > 0
        ? ((spend.spentCentsToday / spend.capCents) * 100).toFixed(1) + ' % of cap'
        : '',
    ]
      .map(escapeCsv)
      .join(','),
  );
  lines.push('');
  lines.push(`Cap (cents),${spend.capCents}`);
  lines.push(`Reset at,${new Date(spend.resetAt).toISOString()}`);
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.download = `spend-${agentName || 'agent'}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
  showToast(`Exported ${spend.perTool.length} row${spend.perTool.length === 1 ? '' : 's'}`, 'ok');
}

interface CrossWorkspaceSpend {
  /** Workspace ID. */
  id: string;
  /** Workspace human-readable name. */
  name: string;
  /** Underlying agent id used in spend queries. */
  agentName: string;
  /** Spend today in cents. */
  spentCentsToday: number;
  /** Daily cap in cents (informational). */
  capCents: number;
  /** Whether the per-workspace data is from D1 or stub. */
  source: 'd1' | 'stub';
  /** True while the underlying /stripe/spend fetch is in flight. */
  loading: boolean;
}

function Spending({ agentName }: { agentName: string }) {
  const [cap, setCap] = useState(5);
  // Saved-cap snapshot — the persisted value the worker is using. We
  // compare against `cap` to know when the slider has unsaved edits +
  // to detect when a debounced save lands.
  const [savedCap, setSavedCap] = useState<number | null>(null);
  const capTimerRef = useRef<number | null>(null);
  const [spend, setSpend] = useState<{
    spentCentsToday: number;
    spentCentsYesterday?: number;
    capCents: number;
    perTool: Array<{ tool: string; cents: number; hourly?: number[] }>;
    resetAt: number;
    source: 'd1' | 'stub';
  } | null>(null);
  // Cross-workspace breakdown — populated only when the user has 2+
  // workspaces (single-workspace setups already see their total via
  // the per-tool table above; the breakdown would be redundant).
  // Lazy-loaded once per Spending tab mount; refreshes on workspace
  // change events from other tabs would be nice but for v1 the
  // user can flip away + back to refresh.
  const [crossWorkspaceSpend, setCrossWorkspaceSpend] = useState<CrossWorkspaceSpend[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/workspaces')
      .then((r) => r.json())
      .then(async (data: { workspaces?: Array<{ id: string; name: string; agentName: string }> }) => {
        const wsList = data.workspaces ?? [];
        if (wsList.length <= 1) return; // single-workspace = skip
        // Seed loading rows so the panel renders skeletons while we
        // fan out per-workspace spend fetches.
        if (cancelled) return;
        setCrossWorkspaceSpend(
          wsList.map((w) => ({
            id: w.id,
            name: w.name,
            agentName: w.agentName,
            spentCentsToday: 0,
            capCents: 0,
            source: 'stub' as const,
            loading: true,
          })),
        );
        // Fan out per-workspace in cohorts of 4 so we don't fire
        // 20 parallel fetches on a heavy account.
        const cohort = 4;
        for (let i = 0; i < wsList.length; i += cohort) {
          const batch = wsList.slice(i, i + cohort);
          const results = await Promise.all(
            batch.map((ws) =>
              fetch(`/api/stripe/spend/${encodeURIComponent(ws.agentName)}`)
                .then((r) => r.json() as Promise<{
                  spentCentsToday?: number;
                  capCents?: number;
                  source?: 'd1' | 'stub';
                }>)
                .catch(() => ({ spentCentsToday: 0, capCents: 0, source: 'stub' as const })),
            ),
          );
          if (cancelled) return;
          setCrossWorkspaceSpend((prev) => {
            if (!prev) return prev;
            const next = prev.slice();
            batch.forEach((ws, j) => {
              const idx = next.findIndex((r) => r.id === ws.id);
              if (idx < 0) return;
              const r = results[j]!;
              next[idx] = {
                ...next[idx]!,
                spentCentsToday: r.spentCentsToday ?? 0,
                capCents: r.capCents ?? 0,
                source: r.source ?? 'stub',
                loading: false,
              };
            });
            return next;
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  // Surfaces the most recent `tool-blocked` event so the user sees an
  // inline banner ("cap hit") without having to dig into the audit log.
  const [blockedNotice, setBlockedNotice] = useState<{
    tool: string;
    reason: string;
    at: number;
  } | null>(null);
  // Per-tool drilldown — when set, fetch + render the last ~20 audit
  // rows whose payload.tool matches. Clicking a legend row toggles
  // expansion (and a second click on the same tool collapses it).
  // Keeping it as a single string (rather than a Set) enforces the
  // "only one open at a time" UX and avoids drilldown soup.
  const [expandedTool, setExpandedTool] = useState<string | null>(() => {
    // Honor deep-links like `#/settings?tab=spending&tool=<name>` so
    // jump-to-related from the Audit pane lands directly on the
    // tool's drilldown. Falls back to null when the param is absent
    // or malformed so the standard "no row expanded" state holds.
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(
      window.location.hash.split('?')[1] ?? '',
    );
    const tool = params.get('tool');
    return tool && tool.length > 0 && tool.length < 200 ? tool : null;
  });
  const [toolCalls, setToolCalls] = useState<
    Array<{ id: string; payload: ToolCallPayload; createdAt: number }>
  >([]);
  const [toolCallsLoading, setToolCallsLoading] = useState(false);
  useEffect(() => {
    if (!expandedTool) {
      setToolCalls([]);
      return;
    }
    let cancelled = false;
    setToolCallsLoading(true);
    // Server-side `q=` does payload LIKE, narrowing the result set;
    // we then strict-equal payload.tool client-side to drop any
    // substring collisions (e.g. "research" matching "researcher.*").
    const url = `/api/audit/${encodeURIComponent(agentName || 'default')}?kind=tool_call&q=${encodeURIComponent(expandedTool)}&limit=100`;
    fetch(url)
      .then((r) => r.json())
      .then((data: { entries?: Array<{ id: string; payload: unknown; createdAt: number }> }) => {
        if (cancelled) return;
        const rows: Array<{ id: string; payload: ToolCallPayload; createdAt: number }> = [];
        for (const e of data.entries ?? []) {
          const p = (e.payload ?? {}) as ToolCallPayload;
          if (p && p.tool === expandedTool) {
            rows.push({ id: e.id, payload: p, createdAt: e.createdAt });
            if (rows.length >= 20) break;
          }
        }
        setToolCalls(rows);
      })
      .catch(() => {
        if (!cancelled) setToolCalls([]);
      })
      .finally(() => {
        if (!cancelled) setToolCallsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [expandedTool, agentName]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch(
          `/api/stripe/spend/${encodeURIComponent(agentName || 'default')}`,
        );
        const data = (await res.json()) as typeof spend;
        if (!cancelled && data) {
          setSpend(data);
          const dollars = data.capCents / 100;
          // Seed `savedCap` from the server's value, but don't clobber
          // a slider drag in progress: if the user has already touched
          // the slider (cap != savedCap), keep their pending value.
          setSavedCap((prevSaved) => {
            if (prevSaved === null) setCap(dollars);
            else if (Math.abs(prevSaved - cap) < 0.001) setCap(dollars);
            return dollars;
          });
        }
      } catch {
        /* keep prior state */
      }
    };
    void refresh();
    // Light poll so the bar reflects live tool calls as they land.
    const id = window.setInterval(refresh, 5_000);

    // WS-driven instant updates — `openthink:spend` carries the post-call
    // rollup (so the bar moves the moment a tool charges), and
    // `openthink:tool-blocked` triggers an immediate re-pull + a banner.
    const onSpend = (e: Event) => {
      const detail = (e as CustomEvent<{
        spentCentsToday: number;
        capCents: number;
        dailyResetAt: number;
      }>).detail;
      if (!detail) return;
      setSpend((prev) =>
        prev
          ? {
              ...prev,
              spentCentsToday: detail.spentCentsToday,
              capCents: detail.capCents,
              resetAt: detail.dailyResetAt,
            }
          : prev,
      );
    };
    const onBlocked = (e: Event) => {
      const detail = (e as CustomEvent<{ tool: string; reason: string }>).detail;
      if (!detail) return;
      setBlockedNotice({ tool: detail.tool, reason: detail.reason, at: Date.now() });
      void refresh();
    };
    window.addEventListener('openthink:spend', onSpend);
    window.addEventListener('openthink:tool-blocked', onBlocked);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('openthink:spend', onSpend);
      window.removeEventListener('openthink:tool-blocked', onBlocked);
    };
  }, [agentName]);

  // Auto-dismiss the blocked banner after a beat so it doesn't camp on
  // the tab indefinitely.
  useEffect(() => {
    if (!blockedNotice) return;
    const t = window.setTimeout(() => setBlockedNotice(null), 8_000);
    return () => window.clearTimeout(t);
  }, [blockedNotice]);

  // Threshold notifier — fire a toast the first time spend crosses
  // 80% / 95% of the daily cap so the user knows they're approaching
  // the wall before the orchestrator slams into it. The 100%-reached
  // case is already covered by the `tool-blocked` banner above. We
  // key on the daily resetAt so a new day starts the threshold ladder
  // fresh; the highest-fired bucket survives reloads via localStorage
  // so a refresh doesn't fire the same toast twice.
  useEffect(() => {
    if (!spend) return;
    const pct = spend.capCents > 0
      ? (spend.spentCentsToday / spend.capCents) * 100
      : 0;
    if (pct < 80) return;
    const dayKey = `${spend.resetAt}`;
    const storeKey = 'openthink:spend-threshold-fired';
    let store: Record<string, number> = {};
    try {
      const raw = window.localStorage.getItem(storeKey);
      if (raw) store = JSON.parse(raw) as Record<string, number>;
    } catch {
      /* corrupt — start fresh */
    }
    const fired = store[dayKey] ?? 0;
    let nextBucket: 80 | 95 | null = null;
    if (pct >= 95 && fired < 95) nextBucket = 95;
    else if (pct >= 80 && fired < 80) nextBucket = 80;
    if (nextBucket === null) return;
    store[dayKey] = nextBucket;
    // Drop any entries whose key (= a past resetAt timestamp) is more
    // than a week stale so the cache doesn't grow unbounded.
    const now = Date.now();
    for (const k of Object.keys(store)) {
      const ts = Number(k);
      if (Number.isFinite(ts) && now - ts > 7 * 24 * 3_600_000) {
        delete store[k];
      }
    }
    try {
      window.localStorage.setItem(storeKey, JSON.stringify(store));
    } catch {
      /* quota — non-fatal, the toast still fires once per session */
    }
    const dollars = (spend.spentCentsToday / 100).toFixed(2);
    const capDollars = (spend.capCents / 100).toFixed(2);
    showToast(
      nextBucket === 95
        ? `⚠ Spend at ${Math.round(pct)}% of cap · $${dollars} / $${capDollars}`
        : `Heads up — spend at ${Math.round(pct)}% of cap · $${dollars} / $${capDollars}`,
      nextBucket === 95 ? 'err' : 'info',
    );
  }, [spend]);

  // Broadcast attention to the Settings nav whenever spend crosses
  // 80% of the cap. Clears when spend drops below (cap raised, new
  // day, etc.). Lets the user see at a glance — from any tab — that
  // something on Spending needs a look.
  useEffect(() => {
    if (!spend) return;
    const pct = spend.capCents > 0
      ? (spend.spentCentsToday / spend.capCents) * 100
      : 0;
    const reason =
      pct >= 100
        ? 'spend cap reached'
        : pct >= 95
          ? `spend at ${Math.round(pct)}% of cap`
          : pct >= 80
            ? `spend at ${Math.round(pct)}% of cap`
            : null;
    window.dispatchEvent(
      new CustomEvent('openthink:settings-attention', {
        detail: { tab: 'spending', reason },
      }),
    );
  }, [spend]);

  const spentDollars = spend ? spend.spentCentsToday / 100 : 0;
  const fillPct = spend
    ? Math.min(100, (spend.spentCentsToday / spend.capCents) * 100)
    : 0;
  // Cap-warning banner state — surfaces when the user is approaching
  // their daily cap (≥85% used) but hasn't hit it yet (the existing
  // `blockedNotice` covers post-block state). Dismissible per-day:
  // we key the suppression on the YYYY-MM-DD stamp so today's
  // dismissal doesn't carry into tomorrow. Default is "show".
  const [capWarningDismissedDate, setCapWarningDismissedDate] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem('openthink:spend-cap-warn-dismissed');
  });
  const todayDateKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const dismissCapWarning = () => {
    setCapWarningDismissedDate(todayDateKey);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(
        'openthink:spend-cap-warn-dismissed',
        todayDateKey,
      );
    }
  };
  const capWarning = (() => {
    if (!spend || spend.capCents === 0) return null;
    if (capWarningDismissedDate === todayDateKey) return null;
    // Hit-or-passed cap is the existing blockedNotice surface; the
    // approach-banner ducks out at 100% so the two affordances don't
    // stack on top of each other.
    if (fillPct >= 100) return null;
    if (fillPct < 85) return null;
    const remainingCents = Math.max(0, spend.capCents - spend.spentCentsToday);
    const severity = fillPct >= 95 ? 'severe' : 'warn';
    return {
      severity,
      pct: Math.round(fillPct),
      remainingDollars: remainingCents / 100,
    };
  })();
  const resetIn = spend ? Math.max(0, spend.resetAt - Date.now()) : 0;
  const resetH = Math.floor(resetIn / 60_000 / 60);
  const resetM = Math.floor((resetIn / 60_000) % 60);

  // Today-vs-yesterday delta — surfaced as a small chip under the bar.
  // Returns `null` when there's nothing useful to compare (both windows
  // empty, or yesterday unavailable from this version of the API).
  const spendDelta = (() => {
    if (!spend) return null;
    const today = spend.spentCentsToday;
    const yest = spend.spentCentsYesterday;
    if (yest == null) return null;
    if (today === 0 && yest === 0) return null;
    if (yest === 0) {
      return {
        kind: 'up' as const,
        label: `+$${(today / 100).toFixed(2)} vs yesterday`,
        title: 'No spend yesterday',
      };
    }
    const diffCents = today - yest;
    const pct = Math.round((diffCents / yest) * 100);
    if (pct === 0) {
      return {
        kind: 'flat' as const,
        label: 'flat vs yesterday',
        title: `${(yest / 100).toFixed(2)} both days`,
      };
    }
    return {
      kind: pct > 0 ? ('up' as const) : ('down' as const),
      label: `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% vs yesterday`,
      title: `Yesterday: $${(yest / 100).toFixed(2)} · today: $${(today / 100).toFixed(2)}`,
    };
  })();

  return (
    <SettingsPane title="Spending" lede="Hard cap — overrides every approval mode.">
      {blockedNotice && (
        <div className="settings__blocked" role="alert">
          <span className="settings__blocked-glyph" aria-hidden>⊘</span>
          <div>
            <strong>Spend cap reached</strong>
            <p className="ot-micro">
              <code>{blockedNotice.tool}</code> was blocked · {blockedNotice.reason}
            </p>
          </div>
          <button
            type="button"
            className="settings__blocked-dismiss"
            onClick={() => setBlockedNotice(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      <Field
        label="Daily cap"
        value={
          savedCap !== null && Math.abs(savedCap - cap) > 0.0001
            ? `$${cap.toFixed(2)} · saving…`
            : `$${cap.toFixed(2)}`
        }
      />
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={cap}
        onChange={(e) => {
          const next = Number(e.target.value);
          setCap(next);
          // Debounce the persist so a slider drag doesn't fire one PUT
          // per micro-step. 400ms after the last input the agent's
          // settings blob picks up the new `spendCapCents`.
          if (capTimerRef.current) window.clearTimeout(capTimerRef.current);
          capTimerRef.current = window.setTimeout(() => {
            const cents = Math.round(next * 100);
            void fetch(
              `/api/settings/${encodeURIComponent(agentName || 'default')}`,
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ spendCapCents: cents }),
              },
            )
              .then(() => {
                setSavedCap(next);
                setSpend((prev) =>
                  prev ? { ...prev, capCents: cents } : prev,
                );
                showToast(`Daily cap set to $${next.toFixed(2)}`, 'ok');
              })
              .catch(() => showToast('Cap save failed', 'err'));
          }, 400);
        }}
        className="settings__slider"
        aria-label="Daily spend cap"
      />
      <div className="settings__spent">
        <span className="ot-label">Spent today</span>
        <div className="settings__spent-bar">
          <div className="settings__spent-fill" style={{ width: `${fillPct}%` }} />
        </div>
        <div className="settings__spent-row">
          <span>
            ${spentDollars.toFixed(2)} / ${cap.toFixed(2)}
          </span>
          {spendDelta && (
            <span
              className={`settings__spent-delta settings__spent-delta--${spendDelta.kind}`}
              title={spendDelta.title}
            >
              {spendDelta.label}
            </span>
          )}
          <span className="ot-micro">
            {resetIn > 0 ? `resets in ${resetH}h ${resetM}m` : 'resetting…'}
            {spend?.source === 'stub' && ' · sample data'}
          </span>
        </div>
        {capWarning && (
          <div
            className={`settings__cap-warn settings__cap-warn--${capWarning.severity}`}
            role="status"
          >
            <span className="settings__cap-warn-glyph" aria-hidden>
              {capWarning.severity === 'severe' ? '⚠' : '◐'}
            </span>
            <div className="settings__cap-warn-body">
              <strong>
                {capWarning.severity === 'severe'
                  ? `Very close to daily cap — ${capWarning.pct}% used`
                  : `Approaching daily cap — ${capWarning.pct}% used`}
              </strong>
              <p className="ot-micro">
                ${capWarning.remainingDollars.toFixed(2)} headroom before the
                next tool call gets blocked. Raise the cap above, pause
                spending, or wait{' '}
                {resetIn > 0 ? `${resetH}h ${resetM}m` : 'a moment'} for the
                reset window.
              </p>
            </div>
            <button
              type="button"
              className="settings__cap-warn-dismiss"
              onClick={dismissCapWarning}
              aria-label="Dismiss for today"
              title="Dismiss this warning until tomorrow"
            >
              ×
            </button>
          </div>
        )}
      </div>
      <div>
        <div className="spend-header">
          <h4>Per-tool today</h4>
          {spend && spend.perTool.length > 0 && (
            <span className="spend-header__exports">
              <button
                type="button"
                className="ot-btn ot-btn--ghost spend-header__export"
                onClick={() => downloadSpendCsv(agentName, spend)}
                title="Download today's per-tool spend as CSV (tabular)"
              >
                Export CSV ↓
              </button>
              <button
                type="button"
                className="ot-btn ot-btn--ghost spend-header__export"
                onClick={() => downloadSpendJson(agentName, spend)}
                title="Download today's per-tool spend as JSON (structured, includes hourly arrays)"
              >
                Export JSON ↓
              </button>
            </span>
          )}
        </div>
        {spend && spend.perTool.length > 0 ? (
          <>
            {/* Stacked horizontal bar — each tool's share rendered as a
                color-shifted segment proportional to its cents. Click a
                segment to focus that tool's table row. */}
            <div className="spend-bar" role="img" aria-label="Tool-spend distribution">
              {(() => {
                const palette = [
                  'var(--ot-accent)',
                  'var(--ot-accent-deep)',
                  '#b87b0a',
                  '#4f7a4d',
                  '#4b6eaf',
                  '#7b4fb5',
                  '#8a1c14',
                  '#1f5c3a',
                ];
                return spend!.perTool.map((row, i) => {
                  const pct = spend!.spentCentsToday > 0
                    ? (row.cents / spend!.spentCentsToday) * 100
                    : 0;
                  return (
                    <span
                      key={row.tool}
                      className="spend-bar__seg"
                      style={{
                        width: `${pct}%`,
                        background: palette[i % palette.length],
                      }}
                      title={`${row.tool} · $${(row.cents / 100).toFixed(2)} · ${pct.toFixed(0)}%`}
                    />
                  );
                });
              })()}
            </div>
            <ul className="spend-legend">
              {spend.perTool.map((row, i) => {
                const palette = [
                  'var(--ot-accent)',
                  'var(--ot-accent-deep)',
                  '#b87b0a',
                  '#4f7a4d',
                  '#4b6eaf',
                  '#7b4fb5',
                  '#8a1c14',
                  '#1f5c3a',
                ];
                const share = spend.spentCentsToday > 0
                  ? (row.cents / spend.spentCentsToday) * 100
                  : 0;
                const color = palette[i % palette.length] ?? 'var(--ot-accent)';
                const isExpanded = expandedTool === row.tool;
                return (
                  <li
                    key={row.tool}
                    className={`spend-legend__row${isExpanded ? ' spend-legend__row--expanded' : ''}`}
                    onClick={() =>
                      setExpandedTool(isExpanded ? null : row.tool)
                    }
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    title={
                      isExpanded
                        ? 'Hide recent calls'
                        : `Show recent calls for ${row.tool}`
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setExpandedTool(isExpanded ? null : row.tool);
                      }
                    }}
                  >
                    <span
                      className="spend-legend__swatch"
                      style={{ background: color }}
                      aria-hidden
                    />
                    <span className="spend-legend__tool">{row.tool}</span>
                    {row.hourly && row.hourly.length > 1 && (
                      <Sparkline data={row.hourly} color={color} />
                    )}
                    <span className="spend-legend__cost">
                      ${(row.cents / 100).toFixed(2)}
                    </span>
                    <span className="spend-legend__share">{share.toFixed(0)}%</span>
                    <span className="spend-legend__chevron" aria-hidden>
                      {isExpanded ? '▾' : '▸'}
                    </span>
                  </li>
                );
              })}
            </ul>
            {/* By-provider rollup — aggregates the per-tool data by the
                leading slug before the first `/` (e.g.
                `workers-ai/llama-3.1-70b-instruct` →
                `workers-ai`). Tools without a slash bucket to their
                full name so infrastructure entries
                (`browser-rendering`, `sandbox/exec`) still show up
                under sensible labels. The view sits beneath the
                per-tool legend so the more-detailed table reads
                first; this is the "where am I burning money at the
                vendor level" rollup. Hidden when there's only one
                provider since there'd be nothing to compare. */}
            {(() => {
              // Roll up perTool entries by their leading slug. Tools
              // with no slash (or a bare empty leading slug from a
              // malformed entry) fall back to the full tool string.
              const providerTotals = new Map<string, number>();
              for (const row of spend.perTool) {
                const slash = row.tool.indexOf('/');
                const provider =
                  slash > 0 ? row.tool.slice(0, slash) : row.tool;
                providerTotals.set(
                  provider,
                  (providerTotals.get(provider) ?? 0) + row.cents,
                );
              }
              const providers = [...providerTotals.entries()]
                .map(([provider, cents]) => ({ provider, cents }))
                .sort((a, b) => b.cents - a.cents);
              if (providers.length <= 1) return null;
              const palette = [
                'var(--ot-accent)',
                'var(--ot-accent-deep)',
                '#b87b0a',
                '#4f7a4d',
                '#4b6eaf',
                '#7b4fb5',
                '#8a1c14',
                '#1f5c3a',
              ];
              const total = providers.reduce((s, p) => s + p.cents, 0);
              return (
                <div className="spend-providers">
                  <div className="spend-providers__head">
                    <h5 className="spend-providers__title">By provider</h5>
                    <span className="ot-micro spend-providers__sub">
                      {providers.length} provider
                      {providers.length === 1 ? '' : 's'} · ${(total / 100).toFixed(2)}
                    </span>
                  </div>
                  {/* Stacked bar mirroring the per-tool bar above but
                      with rolled-up segments — easier to compare at
                      the vendor level. */}
                  <div
                    className="spend-bar spend-bar--providers"
                    role="img"
                    aria-label="Provider-spend distribution"
                  >
                    {providers.map((p, i) => {
                      const pct = total > 0 ? (p.cents / total) * 100 : 0;
                      return (
                        <span
                          key={p.provider}
                          className="spend-bar__seg"
                          style={{
                            width: `${pct}%`,
                            background: palette[i % palette.length],
                          }}
                          title={`${p.provider} · $${(p.cents / 100).toFixed(2)} · ${pct.toFixed(0)}%`}
                        />
                      );
                    })}
                  </div>
                  <ul className="spend-providers__legend">
                    {providers.map((p, i) => {
                      const pct = total > 0 ? (p.cents / total) * 100 : 0;
                      const color = palette[i % palette.length] ?? 'var(--ot-accent)';
                      return (
                        <li key={p.provider} className="spend-providers__row">
                          <span
                            className="spend-legend__swatch"
                            style={{ background: color }}
                            aria-hidden
                          />
                          <span className="spend-providers__name">
                            {p.provider}
                          </span>
                          <span className="spend-providers__cents">
                            ${(p.cents / 100).toFixed(2)}
                          </span>
                          <span className="spend-providers__pct">
                            {pct.toFixed(0)}%
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })()}
            {/* Per-tool drilldown — renders below the legend when a row
                is expanded. Shows summary stats (count, avg, min, max)
                plus the 20 most-recent calls of that tool from the
                audit log. Headlight for "why did this tool cost so
                much today?" without leaving the tab. */}
            {expandedTool && (() => {
              const totalCents = toolCalls.reduce(
                (sum, c) => sum + (Number(c.payload.costCents) || 0),
                0,
              );
              const costs = toolCalls
                .map((c) => Number(c.payload.costCents) || 0)
                .filter((n) => n > 0);
              const avg = costs.length > 0 ? totalCents / costs.length : 0;
              const max = costs.length > 0 ? Math.max(...costs) : 0;
              const min = costs.length > 0 ? Math.min(...costs) : 0;
              const durations = toolCalls
                .map((c) => Number(c.payload.durationMs) || 0)
                .filter((n) => n > 0);
              const avgMs =
                durations.length > 0
                  ? durations.reduce((a, b) => a + b, 0) / durations.length
                  : 0;
              const errs = toolCalls.filter(
                (c) => c.payload.ok === false || c.payload.error,
              ).length;
              return (
                <div className="spend-drilldown" role="region" aria-label={`Recent calls for ${expandedTool}`}>
                  <div className="spend-drilldown__head">
                    <h5 className="spend-drilldown__title">
                      <code>{expandedTool}</code>
                      <span className="ot-micro">
                        last 24h · {toolCallsLoading ? 'loading…' : `${toolCalls.length} call${toolCalls.length === 1 ? '' : 's'}`}
                      </span>
                    </h5>
                    <button
                      type="button"
                      className="spend-drilldown__close"
                      onClick={() => setExpandedTool(null)}
                      aria-label="Close drilldown"
                    >
                      ×
                    </button>
                  </div>
                  {toolCallsLoading ? (
                    <p className="ot-micro">Pulling recent invocations…</p>
                  ) : toolCalls.length === 0 ? (
                    <p className="ot-micro">
                      No audit rows for this tool yet — the per-tool spend
                      tally is non-zero (likely from <code>spend</code> kind
                      rows), but individual <code>tool_call</code> entries
                      haven't been written.
                    </p>
                  ) : (
                    <>
                      <div className="spend-drilldown__stats">
                        <div className="spend-drilldown__stat">
                          <span className="ot-label">Avg cost</span>
                          <span className="spend-drilldown__stat-val">
                            {avg > 0 ? `${avg.toFixed(2)}¢` : '—'}
                          </span>
                        </div>
                        <div className="spend-drilldown__stat">
                          <span className="ot-label">Min / Max</span>
                          <span className="spend-drilldown__stat-val">
                            {costs.length > 0 ? `${min}¢ / ${max}¢` : '—'}
                          </span>
                        </div>
                        <div className="spend-drilldown__stat">
                          <span className="ot-label">Avg duration</span>
                          <span className="spend-drilldown__stat-val">
                            {avgMs > 0
                              ? avgMs >= 1000
                                ? `${(avgMs / 1000).toFixed(2)}s`
                                : `${avgMs.toFixed(0)}ms`
                              : '—'}
                          </span>
                        </div>
                        <div className="spend-drilldown__stat">
                          <span className="ot-label">Errors</span>
                          <span
                            className={`spend-drilldown__stat-val${errs > 0 ? ' spend-drilldown__stat-val--bad' : ''}`}
                          >
                            {errs} / {toolCalls.length}
                          </span>
                        </div>
                      </div>
                      <table className="spend-drilldown__table">
                        <thead>
                          <tr>
                            <th>When</th>
                            <th>Cost</th>
                            <th>Duration</th>
                            <th>Status</th>
                            <th>Agent</th>
                          </tr>
                        </thead>
                        <tbody>
                          {toolCalls.map((c) => {
                            const ageMs = Date.now() - c.createdAt;
                            const ageStr =
                              ageMs < 60_000
                                ? `${Math.round(ageMs / 1000)}s ago`
                                : ageMs < 3_600_000
                                  ? `${Math.round(ageMs / 60_000)}m ago`
                                  : `${(ageMs / 3_600_000).toFixed(1)}h ago`;
                            const cents = Number(c.payload.costCents) || 0;
                            const ms = Number(c.payload.durationMs) || 0;
                            const failed =
                              c.payload.ok === false || !!c.payload.error;
                            return (
                              <tr
                                key={c.id}
                                className={failed ? 'spend-drilldown__row--err' : ''}
                                title={
                                  c.payload.error
                                    ? `Error: ${c.payload.error}`
                                    : new Date(c.createdAt).toLocaleString()
                                }
                              >
                                <td>{ageStr}</td>
                                <td>{cents > 0 ? `${cents}¢` : '—'}</td>
                                <td>
                                  {ms > 0
                                    ? ms >= 1000
                                      ? `${(ms / 1000).toFixed(2)}s`
                                      : `${ms}ms`
                                    : '—'}
                                </td>
                                <td>
                                  {failed ? (
                                    <span className="spend-drilldown__err-dot" aria-label="failed">
                                      ✗
                                    </span>
                                  ) : (
                                    <span className="spend-drilldown__ok-dot" aria-label="ok">
                                      ✓
                                    </span>
                                  )}
                                </td>
                                <td className="ot-micro">
                                  {typeof c.payload.agent === 'string'
                                    ? c.payload.agent
                                    : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              );
            })()}
          </>
        ) : (
          <p className="ot-micro">
            No spend yet today. Tool calls show up here as soon as the agent runs them.
          </p>
        )}
      </div>
      {/* Cross-workspace spend breakdown — only renders when the user
          has 2+ workspaces. Total spend per workspace today, sorted
          descending, with a horizontal bar normalized to the heaviest
          workspace so the user can eyeball relative usage at a
          glance. Each row has a click target that switches to that
          workspace (same path as the Workspaces tab's Switch). */}
      {crossWorkspaceSpend && crossWorkspaceSpend.length > 1 && (() => {
        const sorted = crossWorkspaceSpend
          .slice()
          .sort((a, b) => b.spentCentsToday - a.spentCentsToday);
        const peak = Math.max(
          1,
          ...sorted.map((r) => r.spentCentsToday),
        );
        const total = sorted.reduce((s, r) => s + r.spentCentsToday, 0);
        return (
          <div className="spend-cross">
            <div className="spend-header">
              <h4>Across workspaces · today</h4>
              <span className="ot-micro">
                ${(total / 100).toFixed(2)} total ·{' '}
                {sorted.length} workspace{sorted.length === 1 ? '' : 's'}
              </span>
            </div>
            <ul className="spend-cross__list">
              {sorted.map((row) => {
                const pct = peak > 0 ? (row.spentCentsToday / peak) * 100 : 0;
                const isCurrent = row.agentName === agentName;
                return (
                  <li
                    key={row.id}
                    className={`spend-cross__row${isCurrent ? ' spend-cross__row--current' : ''}`}
                    title={
                      isCurrent
                        ? `${row.name} (you're here)`
                        : `Switch to ${row.name}`
                    }
                  >
                    <button
                      type="button"
                      className="spend-cross__row-btn"
                      onClick={() => {
                        if (isCurrent) return;
                        // Activate the target workspace + reload so
                        // the App picks up the new agentName via the
                        // same path the sidebar uses.
                        void fetch(
                          `/api/workspaces/${encodeURIComponent(row.id)}/activate`,
                          { method: 'POST' },
                        )
                          .catch(() => undefined)
                          .finally(() => {
                            window.location.hash = '#/settings?tab=spending';
                            window.location.reload();
                          });
                      }}
                      disabled={isCurrent || row.loading}
                    >
                      <span className="spend-cross__name">
                        {row.name}
                        {isCurrent && (
                          <span className="ot-pill ot-pill--accent">here</span>
                        )}
                      </span>
                      <span className="spend-cross__bar">
                        <span
                          className="spend-cross__bar-fill"
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                      <span className="spend-cross__cost">
                        {row.loading
                          ? '…'
                          : `$${(row.spentCentsToday / 100).toFixed(2)}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })()}
    </SettingsPane>
  );
}

// Inline 80×18 area-chart sparkline for a per-tool hourly bucket array.
// Draws a Catmull-Rom-smoothed curve normalized to the max of its own
// series so every row uses the full height regardless of its absolute
// cost. The fill below the curve gets the tool's color at 18% alpha
// (via a CSS variable consumed by .spend-legend__spark-fill).
//
// Smoothing math: each segment between P[i] and P[i+1] becomes a cubic
// bezier whose control points are derived from the slope at P[i] and
// P[i+1], computed from the neighboring points P[i-1] and P[i+2].
// Tension factor 1/6 mirrors the classic Catmull-Rom-to-Bezier
// conversion so the curve passes exactly through every data point
// (the bucket values stay truthful — only the segments between them
// get smoothed). Tail/head points reuse themselves as virtual
// neighbors so the very first / very last segments aren't clamped
// straight while the middle is curved.
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const W = 80;
  const H = 18;
  const max = Math.max(1, ...data); // avoid div-by-0
  const step = W / (data.length - 1);
  const pts = data.map((v, i): readonly [number, number] => {
    const x = i * step;
    const y = H - (v / max) * (H - 2) - 1; // 1px breathing room top + bottom
    return [x, y] as const;
  });
  // Catmull-Rom → cubic bezier: for each interior segment use the
  // slope at the two endpoints (derived from their nearest neighbors)
  // to pick control points 1/6 of the way along that slope. Boundary
  // segments fall back to repeating the endpoint as its own neighbor
  // so the curve doesn't lurch toward zero at the edges.
  let linePath = `M${pts[0]![0].toFixed(2)},${pts[0]![1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    linePath +=
      ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  // Close the path back to baseline for the fill.
  const fillPath = `${linePath} L${W.toFixed(1)},${H.toFixed(1)} L0,${H.toFixed(1)} Z`;
  const total = data.reduce((a, b) => a + b, 0);
  return (
    <svg
      className="spend-legend__spark"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Hourly spend trend — ${total} cents over 24h`}
      style={{ color }}
    >
      <path d={fillPath} className="spend-legend__spark-fill" fill={color} fillOpacity={0.18} />
      <path d={linePath} className="spend-legend__spark-line" fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

interface BehaviorState {
  systemPrompt?: string;
  model?: string;
  subagentModel?: string;
  extendedThinking?: boolean;
  thinkingBudgetTokens?: number;
  responseStyle?: 'concise' | 'balanced' | 'detailed';
  codeMode?: 'always' | 'smart' | 'off';
  shareSkillsUpstream?: boolean;
  // Sampling knobs — temperature controls randomness (0 = greedy,
  // 1 = balanced, 2 = wild), topP gates the cumulative probability
  // mass each token can come from. Both are passed through to the
  // model SDK when set; left undefined to defer to provider defaults.
  temperature?: number;
  topP?: number;
}

const PROMPT_TEMPLATES: Array<{ id: string; label: string; body: string }> = [
  {
    id: 'personal-assistant',
    label: 'Personal assistant',
    body:
      "You are a calm, thoughtful personal AI agent. Keep replies concise unless asked to elaborate. When you don't know something, say so plainly. Default to action — propose a next step rather than asking for permission to think.",
  },
  {
    id: 'researcher',
    label: 'Researcher',
    body:
      'You are a meticulous research assistant. Always cite the source for any factual claim. Prefer primary sources. If you can\'t verify a claim, flag it explicitly. When asked for an opinion, separate the evidence summary from the recommendation.',
  },
  {
    id: 'coder',
    label: 'Coder',
    body:
      "You are an experienced software engineer. Write production-grade code: handle edge cases, log meaningfully, prefer small composable functions. Explain WHY a change is needed before showing the diff. Don't apologize for or hedge your suggestions.",
  },
  {
    id: 'writer',
    label: 'Writer',
    body:
      'You are an editor with a strong distaste for filler. Cut every word that doesn\'t earn its place. Favor strong verbs over adverbs. When given a draft, return the edit, not a commentary on the edit.',
  },
];

// Word-level diff renderer for the system-prompt vs default. Uses an
// LCS-driven walk that splits on whitespace boundaries — keeps the
// implementation O(n*m) which is fine for ≤300-word prompts. Output
// is a flat list of tokens with `kind: 'same' | 'add' | 'del'` so the
// render pass can color them in place without breaking the original
// reading flow.
function diffWords(
  before: string,
  after: string,
): Array<{ kind: 'same' | 'add' | 'del'; text: string }> {
  // Tokenize while keeping whitespace as part of each token's suffix
  // so concatenation reproduces the original strings (modulo our
  // canonical join). Use a regex that captures word + trailing
  // whitespace as one unit; trailing punctuation rides with its word.
  const tokenize = (s: string): string[] => {
    const out: string[] = [];
    const re = /\S+\s*|\s+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) out.push(m[0]!);
    return out;
  };
  const A = tokenize(before);
  const B = tokenize(after);
  // Classic LCS DP. Rows = A index, columns = B index. Compare by
  // trimmed token so trailing-whitespace variants don't break the
  // alignment.
  const norm = (t: string): string => t.trim();
  const m = A.length;
  const n = B.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (norm(A[i]!) === norm(B[j]!)) {
        dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }
  // Walk the DP table to emit tokens.
  const out: Array<{ kind: 'same' | 'add' | 'del'; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (norm(A[i]!) === norm(B[j]!)) {
      out.push({ kind: 'same', text: B[j]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ kind: 'del', text: A[i]! });
      i += 1;
    } else {
      out.push({ kind: 'add', text: B[j]! });
      j += 1;
    }
  }
  while (i < m) {
    out.push({ kind: 'del', text: A[i]! });
    i += 1;
  }
  while (j < n) {
    out.push({ kind: 'add', text: B[j]! });
    j += 1;
  }
  return out;
}

function PromptDiff({ base, current }: { base: string; current: string }) {
  const tokens = diffWords(base, current);
  const added = tokens.filter((t) => t.kind === 'add').length;
  const removed = tokens.filter((t) => t.kind === 'del').length;
  return (
    <div className="settings__prompt-diff-body">
      <div className="settings__prompt-diff-stats ot-micro">
        <span className="settings__prompt-diff-add">+{added} added</span>
        <span className="settings__prompt-diff-del">−{removed} removed</span>
      </div>
      <p className="settings__prompt-diff-text">
        {tokens.map((t, i) => (
          <span
            key={i}
            className={`settings__prompt-diff-tok settings__prompt-diff-tok--${t.kind}`}
          >
            {t.text}
          </span>
        ))}
      </p>
    </div>
  );
}

function Behavior({ agentName }: { agentName: string }) {
  const [state, setState] = useState<BehaviorState>({
    systemPrompt: '',
    model: 'auto',
    subagentModel: 'auto',
    extendedThinking: false,
    thinkingBudgetTokens: 4_000,
    responseStyle: 'balanced',
    codeMode: 'smart',
  });
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  // Template hover-preview state. Debounced so a quick pointer sweep
  // across the chip row doesn't fire a flash of popovers.
  const [previewTemplate, setPreviewTemplate] = useState<string | null>(null);
  const previewTimerRef = useRef<number | null>(null);

  // User-imported / authored templates layered on top of the static set.
  // Persisted to localStorage so they survive reloads. The import button
  // accepts the same JSON shape this component exports.
  const [customTemplates, setCustomTemplates] = useState<
    Array<{ id: string; label: string; body: string }>
  >(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem('openthink:behavior-templates');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (t): t is { id: string; label: string; body: string } =>
          t && typeof t.id === 'string' && typeof t.label === 'string' && typeof t.body === 'string',
      );
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (customTemplates.length > 0) {
      window.localStorage.setItem(
        'openthink:behavior-templates',
        JSON.stringify(customTemplates),
      );
    } else {
      window.localStorage.removeItem('openthink:behavior-templates');
    }
  }, [customTemplates]);

  const importFileRef = useRef<HTMLInputElement | null>(null);
  const configImportRef = useRef<HTMLInputElement | null>(null);
  // Import a full BehaviorState snapshot (the shape `↓ Export config`
  // writes). We validate each known field's type before applying so a
  // bad import can't poison the persisted settings. Anything extra in
  // the file is silently dropped — version-1 shape only.
  const importBehaviorConfig = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming =
        parsed && typeof parsed === 'object' && parsed.state && typeof parsed.state === 'object'
          ? (parsed.state as Record<string, unknown>)
          : (parsed as Record<string, unknown>);
      if (!incoming || typeof incoming !== 'object') {
        showToast('Couldn\'t parse Behavior JSON', 'err');
        return;
      }
      const next: BehaviorState = {};
      const str = (k: keyof BehaviorState) => {
        const v = incoming[k as string];
        if (typeof v === 'string') (next as Record<string, unknown>)[k as string] = v;
      };
      const num = (k: keyof BehaviorState) => {
        const v = incoming[k as string];
        if (typeof v === 'number' && Number.isFinite(v)) {
          (next as Record<string, unknown>)[k as string] = v;
        }
      };
      const bool = (k: keyof BehaviorState) => {
        const v = incoming[k as string];
        if (typeof v === 'boolean') (next as Record<string, unknown>)[k as string] = v;
      };
      str('systemPrompt');
      str('model');
      str('subagentModel');
      bool('extendedThinking');
      num('thinkingBudgetTokens');
      if (
        incoming.responseStyle === 'concise' ||
        incoming.responseStyle === 'balanced' ||
        incoming.responseStyle === 'detailed'
      ) {
        next.responseStyle = incoming.responseStyle;
      }
      if (
        incoming.codeMode === 'always' ||
        incoming.codeMode === 'smart' ||
        incoming.codeMode === 'off'
      ) {
        next.codeMode = incoming.codeMode;
      }
      bool('shareSkillsUpstream');
      num('temperature');
      num('topP');
      if (Object.keys(next).length === 0) {
        showToast('No valid Behavior fields found in file', 'err');
        return;
      }
      // `persist` already does setState + the debounced save, so we
      // call it once with the merged patch and skip the redundant
      // local setState.
      persist(next);
      showToast(
        `Imported ${Object.keys(next).length} Behavior field${Object.keys(next).length === 1 ? '' : 's'}`,
        'ok',
      );
    } catch {
      showToast('Couldn\'t parse Behavior JSON file', 'err');
    }
  };
  const exportTemplates = () => {
    const merged = [...PROMPT_TEMPLATES, ...customTemplates];
    const blob = new Blob([JSON.stringify(merged, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `behavior-templates-${agentName || 'agent'}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
    showToast(`Exported ${merged.length} templates`, 'ok');
  };
  const importTemplates = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('not_an_array');
      const incoming = parsed.filter(
        (t): t is { id: string; label: string; body: string } =>
          t && typeof t.id === 'string' && typeof t.label === 'string' && typeof t.body === 'string',
      );
      if (incoming.length === 0) {
        showToast('No valid templates found in file', 'err');
        return;
      }
      // Skip ids that collide with the static catalog so a user can't
      // shadow `coder` / `writer` / etc. by accident. Custom-only set
      // gets merged in by id (later wins).
      const staticIds = new Set(PROMPT_TEMPLATES.map((t) => t.id));
      const usable = incoming.filter((t) => !staticIds.has(t.id));
      setCustomTemplates((prev) => {
        const byId = new Map(prev.map((t) => [t.id, t]));
        for (const t of usable) byId.set(t.id, t);
        return [...byId.values()];
      });
      showToast(
        `Imported ${usable.length} template${usable.length === 1 ? '' : 's'}${incoming.length > usable.length ? ` · ${incoming.length - usable.length} skipped (id conflict)` : ''}`,
        'ok',
      );
    } catch {
      showToast('Couldn’t parse JSON — expected an array of {id,label,body}', 'err');
    }
  };

  const allTemplates = [...PROMPT_TEMPLATES, ...customTemplates];
  useEffect(() => {
    return () => {
      if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
    };
  }, []);
  // System prompt "try this" mini-chat. Single off-thread roundtrip
  // against `/api/settings/preview` — doesn't persist, doesn't go
  // through the orchestrator DO, just shows the user what tone/format
  // their current prompt produces before they commit.
  const [previewMsg, setPreviewMsg] = useState<string>(
    'Say hello in your voice.',
  );
  const [previewReply, setPreviewReply] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Which history row is currently showing a diff against the latest
  // reply. Single-row at a time so the comparison stays focused; null
  // means no diff is rendered.
  const [diffHistoryIdx, setDiffHistoryIdx] = useState<number | null>(null);
  // Preview history — the last 6 prompt/reply pairs so a user
  // iterating on tone can compare versions side-by-side without
  // burning more roundtrips. Lives in localStorage so a reload
  // doesn't wipe a session's experimentation trail.
  interface PreviewHistoryEntry {
    msg: string;
    reply: string;
    promptHash: string; // first 8 chars of the system prompt for grouping
    at: number;
  }
  const [previewHistory, setPreviewHistory] = useState<PreviewHistoryEntry[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem('openthink:behavior-preview-history');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (e): e is PreviewHistoryEntry =>
            e &&
            typeof e.msg === 'string' &&
            typeof e.reply === 'string' &&
            typeof e.promptHash === 'string' &&
            typeof e.at === 'number',
        )
        .slice(0, 6);
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (previewHistory.length === 0) {
      window.localStorage.removeItem('openthink:behavior-preview-history');
    } else {
      window.localStorage.setItem(
        'openthink:behavior-preview-history',
        JSON.stringify(previewHistory),
      );
    }
  }, [previewHistory]);
  // Cheap prompt fingerprint — first 8 chars of a 32-bit rolling
  // hash. Two preview entries with the same hash were run against
  // the same system prompt, so we can group them visually.
  const hashPrompt = (p: string): string => {
    let h = 0;
    for (let i = 0; i < p.length; i++) {
      h = (h * 31 + p.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16).slice(0, 8);
  };
  const currentPromptHash = hashPrompt((state.systemPrompt ?? '').trim());
  const runPreview = async () => {
    const prompt = (state.systemPrompt ?? '').trim();
    if (!prompt || !previewMsg.trim() || previewLoading) return;
    setPreviewLoading(true);
    setPreviewReply(null);
    try {
      const res = await fetch('/api/settings/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt: prompt, message: previewMsg.trim() }),
      });
      const data = (await res.json()) as { ok: boolean; reply?: string };
      const reply = data.reply ?? '(empty response)';
      setPreviewReply(reply);
      // Record into history (most-recent first, cap 6, dedup by
      // identical msg+promptHash). Only writes when the worker
      // returned a real reply.
      if (data.ok) {
        setPreviewHistory((prev) => {
          const next = prev.filter(
            (e) => !(e.msg === previewMsg.trim() && e.promptHash === currentPromptHash),
          );
          next.unshift({
            msg: previewMsg.trim(),
            reply,
            promptHash: currentPromptHash,
            at: Date.now(),
          });
          return next.slice(0, 6);
        });
      }
    } catch {
      setPreviewReply('(preview failed — check your connection or `wrangler dev`)');
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    void fetch(`/api/settings/${encodeURIComponent(agentName || 'default')}`)
      .then((r) => r.json())
      .then((data: BehaviorState | null) => {
        if (data) setState((prev) => ({ ...prev, ...data }));
      })
      .catch(() => undefined);
  }, [agentName]);

  // Debounced save — set local state immediately + flag the Behavior
  // tab as dirty (the Settings parent renders a • in the nav), then
  // 600ms after the last edit fire one PUT with the merged blob. This
  // replaces the per-keystroke flood of saves + the "Behavior saved"
  // toast spam that came with it. On flush, clear the dirty flag and
  // show a single confirmation toast.
  const saveTimerRef = useRef<number | null>(null);
  const pendingStateRef = useRef<BehaviorState>(state);
  pendingStateRef.current = state;
  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const snapshot = pendingStateRef.current;
    void fetch(`/api/settings/${encodeURIComponent(agentName || 'default')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    })
      .then((r) => {
        setSavedAt(Date.now());
        window.dispatchEvent(
          new CustomEvent('openthink:settings-dirty', {
            detail: { tab: 'behavior', dirty: false },
          }),
        );
        if (r.ok) showToast('Behavior saved', 'ok');
        else showToast('Save failed', 'err');
      })
      .catch(() => showToast('Save failed', 'err'));
  }, [agentName]);
  const persist = (patch: Partial<BehaviorState>) => {
    setState((prev) => ({ ...prev, ...patch }));
    window.dispatchEvent(
      new CustomEvent('openthink:settings-dirty', {
        detail: { tab: 'behavior', dirty: true },
      }),
    );
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(flushSave, 600);
  };
  // Final flush if the user switches tabs or unmounts before the
  // debounce settles — we don't want to lose a half-typed system prompt.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        // Synchronous PUT; the response doesn't matter at unmount time.
        // We send it without waiting so React's cleanup doesn't block.
        const snapshot = pendingStateRef.current;
        void fetch(
          `/api/settings/${encodeURIComponent(agentName || 'default')}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(snapshot),
          },
        ).catch(() => undefined);
        window.dispatchEvent(
          new CustomEvent('openthink:settings-dirty', {
            detail: { tab: 'behavior', dirty: false },
          }),
        );
      }
    };
  }, [agentName]);

  return (
    <SettingsPane
      title="Behavior"
      lede="How the agent reasons, replies, and which model holds the steering wheel."
    >
      <div className="settings__group">
        <h4>System prompt</h4>
        <p className="ot-micro">
          What this agent is for. Templates seed a starting point; edit freely.
        </p>
        <div className="settings__template-row">
          {allTemplates.map((t) => {
            const isPreviewing = previewTemplate === t.id;
            return (
              <div key={t.id} className="settings__template-wrap">
                <button
                  type="button"
                  className={`settings__template${
                    activeTemplate === t.id ? ' settings__template--active' : ''
                  }`}
                  onClick={() => {
                    setActiveTemplate(t.id);
                    setPreviewTemplate(null);
                    persist({ systemPrompt: t.body });
                  }}
                  onMouseEnter={() => {
                    if (previewTimerRef.current)
                      window.clearTimeout(previewTimerRef.current);
                    previewTimerRef.current = window.setTimeout(
                      () => setPreviewTemplate(t.id),
                      280,
                    );
                  }}
                  onMouseLeave={() => {
                    if (previewTimerRef.current)
                      window.clearTimeout(previewTimerRef.current);
                    setPreviewTemplate((cur) => (cur === t.id ? null : cur));
                  }}
                  onFocus={() => setPreviewTemplate(t.id)}
                  onBlur={() =>
                    setPreviewTemplate((cur) => (cur === t.id ? null : cur))
                  }
                  onKeyDown={(e) => {
                    // Arrow-left/right walk the chip row, Home/End jump
                    // to the ends. Lets a keyboard user sweep through
                    // 10+ behavior templates without having to Tab
                    // through every chip-wrap div in between.
                    if (
                      e.key !== 'ArrowLeft' &&
                      e.key !== 'ArrowRight' &&
                      e.key !== 'Home' &&
                      e.key !== 'End'
                    ) {
                      return;
                    }
                    const row = (e.currentTarget as HTMLElement).closest(
                      '.settings__template-row',
                    );
                    if (!row) return;
                    const chips = Array.from(
                      row.querySelectorAll<HTMLButtonElement>(
                        '.settings__template',
                      ),
                    );
                    const idx = chips.indexOf(
                      e.currentTarget as HTMLButtonElement,
                    );
                    if (idx < 0) return;
                    e.preventDefault();
                    let nxt = idx;
                    if (e.key === 'ArrowLeft') nxt = Math.max(0, idx - 1);
                    else if (e.key === 'ArrowRight')
                      nxt = Math.min(chips.length - 1, idx + 1);
                    else if (e.key === 'Home') nxt = 0;
                    else if (e.key === 'End') nxt = chips.length - 1;
                    if (nxt !== idx) chips[nxt]?.focus();
                  }}
                >
                  {t.label}
                </button>
                {isPreviewing && (
                  <div
                    className="settings__template-preview"
                    role="tooltip"
                    aria-label={`${t.label} preview`}
                  >
                    <span className="settings__template-preview-head">
                      {t.label} · click to apply
                    </span>
                    <p className="settings__template-preview-body">{t.body}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="settings__template-io">
          <button
            type="button"
            className="settings__template-io-btn"
            onClick={exportTemplates}
            title="Download all templates as JSON"
          >
            ↓ Export {allTemplates.length} as JSON
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importTemplates(f);
              // Reset the input so re-picking the same file fires
              // change again.
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="settings__template-io-btn"
            onClick={() => importFileRef.current?.click()}
            title="Add templates from a JSON file (array of {id,label,body})"
          >
            ↑ Import JSON
          </button>
          {customTemplates.length > 0 && (
            <button
              type="button"
              className="settings__template-io-btn settings__template-io-btn--clear"
              onClick={() => {
                if (
                  window.confirm(
                    `Drop all ${customTemplates.length} custom template${customTemplates.length === 1 ? '' : 's'}? The built-in catalog stays.`,
                  )
                ) {
                  setCustomTemplates([]);
                  showToast('Custom templates cleared', 'ok');
                }
              }}
              title="Drop every imported template"
            >
              × Clear custom
            </button>
          )}
        </div>
        <textarea
          className="ot-input settings__prompt"
          value={state.systemPrompt ?? ''}
          rows={6}
          onChange={(e) => persist({ systemPrompt: e.target.value })}
          placeholder="Tell the agent what it's for, the voice it should use, and what 'good' looks like."
        />
        {/* Diff vs default — surfaces a Myers-style word-level diff
            between the current prompt and the personal-assistant
            default. Useful when the user wants to see exactly what
            they've drifted from baseline, especially after iterating
            for a while. Collapsed by default; only renders when the
            current prompt actually differs. */}
        {(state.systemPrompt ?? '').trim() &&
          (state.systemPrompt ?? '').trim() !== PROMPT_TEMPLATES[0]!.body && (
            <details className="settings__prompt-diff">
              <summary className="settings__prompt-diff-summary">
                ⇄ Compare to default
                <span className="ot-micro">
                  · word-level diff against the Personal assistant template
                </span>
              </summary>
              <PromptDiff
                base={PROMPT_TEMPLATES[0]!.body}
                current={state.systemPrompt ?? ''}
              />
              <button
                type="button"
                className="settings__prompt-diff-reset"
                onClick={() => persist({ systemPrompt: PROMPT_TEMPLATES[0]!.body })}
                title="Replace your current prompt with the default"
              >
                ↺ Reset to default
              </button>
            </details>
          )}
        {/* Mini-chat preview — single off-thread Workers AI roundtrip
            against the prompt above. Lets the user sanity-check tone
            before committing. */}
        <details className="settings__prompt-preview">
          <summary className="settings__prompt-preview-summary">
            ✦ Try this prompt
            <span className="ot-micro">
              · one-shot roundtrip · doesn't save to threads
            </span>
          </summary>
          <div className="settings__prompt-preview-body">
            <div className="settings__prompt-preview-row">
              <input
                type="text"
                className="ot-input"
                placeholder="Sample message…"
                value={previewMsg}
                onChange={(e) => setPreviewMsg(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !previewLoading) {
                    e.preventDefault();
                    void runPreview();
                  }
                }}
              />
              <button
                type="button"
                className="ot-btn"
                onClick={() => void runPreview()}
                disabled={
                  previewLoading ||
                  !(state.systemPrompt ?? '').trim() ||
                  !previewMsg.trim()
                }
              >
                {previewLoading ? 'Running…' : 'Run preview'}
              </button>
            </div>
            {previewReply !== null && (
              <div
                className="settings__prompt-preview-reply"
                aria-live="polite"
              >
                <span className="ot-micro">reply</span>
                <p>{previewReply}</p>
              </div>
            )}
            {previewReply === null && !previewLoading && (
              <p className="ot-micro">
                Run the prompt against a sample message to see how the
                agent would reply. Uses Workers AI Llama 3.1 8B for the
                quick check — your actual orchestrator model may produce
                a richer answer.
              </p>
            )}
            {/* Preview history — recent prompt/reply pairs so a user
                tuning tone can compare versions without re-running.
                Each row's `Use again` button repopulates the message
                input + re-fires the preview. Rows tagged with a
                different promptHash than the current system prompt
                get a subtle "stale" badge so the user knows the reply
                was for a different prompt. */}
            {previewHistory.length > 0 && (
              <div className="settings__prompt-preview-history">
                <div className="settings__prompt-preview-history-head">
                  <span className="ot-label">Recent previews</span>
                  <button
                    type="button"
                    className="settings__prompt-preview-history-clear"
                    onClick={() => setPreviewHistory([])}
                    title="Clear preview history"
                  >
                    × clear
                  </button>
                </div>
                <ul className="settings__prompt-preview-history-list">
                  {previewHistory.map((h, i) => {
                    const stale = h.promptHash !== currentPromptHash;
                    // Diff is only useful when there's a current
                    // reply on screen to compare against AND it's
                    // actually different from this history row's
                    // reply. Same message + different reply is the
                    // most interesting case (same input, different
                    // prompt produced different output).
                    const canDiff =
                      previewReply !== null && previewReply !== h.reply;
                    const isShowingDiff = diffHistoryIdx === i;
                    return (
                      <li
                        key={`${h.at}-${i}`}
                        className={`settings__prompt-preview-history-row${stale ? ' settings__prompt-preview-history-row--stale' : ''}`}
                      >
                        <div className="settings__prompt-preview-history-msg">
                          <span className="ot-micro">you</span>
                          <p>{h.msg}</p>
                        </div>
                        <div className="settings__prompt-preview-history-reply">
                          <span className="ot-micro">
                            reply
                            {stale && (
                              <span
                                className="settings__prompt-preview-history-stale"
                                title="Run against a different system prompt"
                              >
                                · stale
                              </span>
                            )}
                          </span>
                          {isShowingDiff && previewReply !== null ? (
                            <p className="settings__prompt-preview-history-diff">
                              {diffWords(h.reply, previewReply).map((t, idx) => (
                                <span
                                  key={idx}
                                  className={`settings__prompt-diff-tok settings__prompt-diff-tok--${t.kind}`}
                                >
                                  {t.text}
                                </span>
                              ))}
                            </p>
                          ) : (
                            <p>{h.reply}</p>
                          )}
                        </div>
                        <div className="settings__prompt-preview-history-actions">
                          <button
                            type="button"
                            className="settings__prompt-preview-history-rerun"
                            onClick={() => {
                              setPreviewMsg(h.msg);
                              void runPreview();
                            }}
                            disabled={previewLoading}
                            title="Re-run this message against the current system prompt"
                          >
                            ↻ Run again
                          </button>
                          {canDiff && (
                            <button
                              type="button"
                              className="settings__prompt-preview-history-diff-btn"
                              onClick={() =>
                                setDiffHistoryIdx((cur) => (cur === i ? null : i))
                              }
                              title={
                                isShowingDiff
                                  ? 'Hide diff'
                                  : 'Show word-level diff against the latest reply'
                              }
                            >
                              {isShowingDiff ? '× hide diff' : '⇄ diff'}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </details>
      </div>

      <div className="settings__group">
        <h4>Models</h4>
        <div className="settings__row">
          <label className="settings__row-label">Orchestrator</label>
          <select
            className="ot-input"
            value={state.model ?? 'auto'}
            onChange={(e) => persist({ model: e.target.value })}
          >
            <option value="auto">Latest (auto) · recommended</option>
            <option value="@cf/meta/llama-3.1-8b-instruct">Workers AI · Llama 3.1 8B</option>
            <option value="@cf/meta/llama-3.1-70b-instruct">Workers AI · Llama 3.1 70B</option>
            <option value="anthropic/claude-3-5-sonnet">Anthropic · Claude 3.5 Sonnet</option>
            <option value="openai/gpt-4o-mini">OpenAI · GPT-4o mini</option>
          </select>
        </div>
        <div className="settings__row">
          <label className="settings__row-label">Sub-agents</label>
          <select
            className="ot-input"
            value={state.subagentModel ?? 'auto'}
            onChange={(e) => persist({ subagentModel: e.target.value })}
          >
            <option value="auto">Match orchestrator</option>
            <option value="@cf/meta/llama-3.1-8b-instruct">Workers AI · Llama 3.1 8B</option>
            <option value="@cf/meta/llama-3.1-70b-instruct">Workers AI · Llama 3.1 70B</option>
          </select>
        </div>
        <div className="settings__row">
          <label className="settings__row-label">Code mode</label>
          <select
            className="ot-input"
            value={state.codeMode ?? 'smart'}
            onChange={(e) =>
              persist({ codeMode: e.target.value as BehaviorState['codeMode'] })
            }
          >
            <option value="always">Always — every turn through code</option>
            <option value="smart">Smart — agent decides per turn</option>
            <option value="off">Off — never wrap tool calls in code</option>
          </select>
        </div>
      </div>

      <div className="settings__group">
        <h4>Extended thinking</h4>
        <div className="settings__row">
          <span className="settings__row-label">Reason at length</span>
          <Toggle
            on={!!state.extendedThinking}
            onClick={() => persist({ extendedThinking: !state.extendedThinking })}
          />
        </div>
        {state.extendedThinking && (
          <div className="settings__thinking">
            <input
              type="range"
              min={1_000}
              max={32_000}
              step={500}
              value={state.thinkingBudgetTokens ?? 4_000}
              onChange={(e) =>
                persist({ thinkingBudgetTokens: Number(e.target.value) })
              }
              className="settings__slider"
              aria-label="Thinking token budget"
            />
            <div className="settings__thinking-row">
              <span>{(state.thinkingBudgetTokens ?? 4_000).toLocaleString()} tokens / turn</span>
              <span className="ot-micro">cost goes up with depth — capped by your spending limit</span>
            </div>
          </div>
        )}
      </div>

      <div className="settings__group">
        <h4>Response style</h4>
        <div className="settings__mode-picker">
          {(['concise', 'balanced', 'detailed'] as const).map((style) => (
            <button
              key={style}
              type="button"
              className={`settings__style${
                (state.responseStyle ?? 'balanced') === style ? ' settings__style--active' : ''
              }`}
              onClick={() => persist({ responseStyle: style })}
            >
              {style.charAt(0).toUpperCase() + style.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="settings__group">
        <h4>Sampling</h4>
        <p className="ot-micro" style={{ margin: '0 0 12px' }}>
          Override the model's default randomness. Most users should
          leave these alone — the response-style picker above is the
          friendlier control. Power users tuning a specific behavior
          (deterministic JSON output, creative brainstorms) can dial
          them here.
        </p>
        <div className="settings__sampling">
          <div className="settings__sampling-row">
            <label className="ot-label" htmlFor="ot-temperature">
              Temperature
            </label>
            <input
              id="ot-temperature"
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={state.temperature ?? 1}
              onChange={(e) =>
                persist({ temperature: Number(e.target.value) })
              }
              className="settings__slider"
              aria-label="Sampling temperature"
            />
            <span className="settings__sampling-val">
              {(state.temperature ?? 1).toFixed(2)}
            </span>
            <button
              type="button"
              className="settings__sampling-reset"
              onClick={() => persist({ temperature: undefined })}
              disabled={state.temperature == null}
              title="Defer to the provider's default (typically 1.0)"
            >
              ↺
            </button>
          </div>
          <div className="settings__sampling-row">
            <label className="ot-label" htmlFor="ot-topp">
              Top-p
            </label>
            <input
              id="ot-topp"
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={state.topP ?? 1}
              onChange={(e) =>
                persist({ topP: Number(e.target.value) })
              }
              className="settings__slider"
              aria-label="Top-p sampling"
            />
            <span className="settings__sampling-val">
              {(state.topP ?? 1).toFixed(2)}
            </span>
            <button
              type="button"
              className="settings__sampling-reset"
              onClick={() => persist({ topP: undefined })}
              disabled={state.topP == null}
              title="Defer to the provider's default (typically 1.0)"
            >
              ↺
            </button>
          </div>
        </div>
        <p className="ot-micro settings__sampling-hint">
          ◇ <strong>Low temperature</strong> · deterministic, good for
          structured output. · <strong>High temperature</strong> ·
          varied, good for brainstorms. · <strong>Top-p</strong> · the
          smaller the value, the tighter the candidate pool per token.
        </p>
      </div>

      <div className="settings__group">
        <h4>Share skills upstream</h4>
        <div className="settings__row">
          <span className="settings__row-label">Auto PR to openthink3</span>
          <Toggle
            on={!!state.shareSkillsUpstream}
            onClick={() => persist({ shareSkillsUpstream: !state.shareSkillsUpstream })}
          />
        </div>
        <p className="ot-micro">
          When on, every skill you save via Train mode also opens a draft PR
          against the public upstream repo with the SKILL.md body. Uses your
          configured GitHub token. Off keeps everything local.
        </p>
      </div>

      <div className="settings__group">
        <h4>Portability</h4>
        <p className="ot-micro" style={{ margin: '0 0 10px' }}>
          Snapshot every behavior setting (prompt, model, sampling,
          response style, code mode) into a JSON file. Useful when
          copying a tuned persona between agents or backing up before
          experimenting.
        </p>
        <div className="settings__template-io">
          <button
            type="button"
            className="settings__template-io-btn"
            onClick={() => {
              const doc = {
                exportedAt: new Date().toISOString(),
                version: 1,
                agentName,
                state,
              };
              const blob = new Blob([JSON.stringify(doc, null, 2)], {
                type: 'application/json',
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              const stamp = new Date()
                .toISOString()
                .slice(0, 16)
                .replace(/[:T]/g, '-');
              a.href = url;
              a.download = `behavior-${agentName || 'agent'}-${stamp}.json`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              window.setTimeout(() => URL.revokeObjectURL(url), 500);
              showToast('Behavior settings exported', 'ok');
            }}
            title="Snapshot the entire Behavior state as JSON"
          >
            ↓ Export config
          </button>
          <input
            ref={configImportRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importBehaviorConfig(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="settings__template-io-btn"
            onClick={() => configImportRef.current?.click()}
            title="Restore Behavior state from a previously-exported JSON file"
          >
            ↑ Import config
          </button>
        </div>
      </div>

      {savedAt && (
        <p className="ot-micro settings__saved">Saved · {new Date(savedAt).toLocaleTimeString()}</p>
      )}
    </SettingsPane>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`skill-toggle${on ? ' skill-toggle--on' : ''}`}
      onClick={onClick}
      aria-pressed={on}
    >
      <span className="skill-toggle__dot" />
    </button>
  );
}

interface KnowledgeItem {
  id: string;
  kind: 'file' | 'url' | 'text';
  title: string;
  source: string;
  bytes?: number;
  addedAt: number;
  pinned?: boolean;
  // User-assigned category tags — see /api/knowledge/<agent>/<id>/tags.
  // Optional + omitted on items the user hasn't tagged.
  tags?: string[];
}

// Mirror the worker's tag sanitizer client-side so the chips the user
// sees during input match exactly what the server will persist.
function sanitizeKnowledgeTag(raw: string): string | null {
  const t = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return t || null;
}

// Per-item icon for the Knowledge list — text + url are fixed glyphs;
// file kind picks an extension-driven glyph so a PDF reads as "doc"
// vs a PNG reading as "image" without the user having to read the
// source path. Falls back to a generic page glyph when the extension
// isn't recognized.
function knowledgeIconFor(item: KnowledgeItem): string {
  if (item.kind === 'url') return '⟶';
  if (item.kind === 'text') return '¶';
  // File kind. Walk the source for an extension; the source is the
  // R2 key (always set for files), so we slice after the last dot.
  const lastDot = item.source.lastIndexOf('.');
  const ext = lastDot >= 0 ? item.source.slice(lastDot + 1).toLowerCase() : '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(ext)) return '🖼';
  if (ext === 'pdf') return '📕';
  if (['md', 'markdown', 'mdx', 'rst'].includes(ext)) return '📑';
  if (['csv', 'tsv', 'xlsx', 'xls'].includes(ext)) return '📊';
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'py', 'go', 'rs', 'java', 'cs', 'rb', 'php', 'sh', 'sql'].includes(ext)) {
    return '⟨/⟩';
  }
  if (['zip', 'tar', 'gz', '7z'].includes(ext)) return '🗜';
  if (['html', 'htm', 'xml', 'json'].includes(ext)) return '◰';
  return '📄';
}

function Knowledge({ agentName }: { agentName: string }) {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [urlDraft, setUrlDraft] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [textDraft, setTextDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // Brief "URL detected from paste — switched to URL kind" notice. Set
  // when a paste into the title or text fields looks like a URL; auto-
  // clears after a beat. Kept inline so we don't burn a global toast.
  const [urlDetected, setUrlDetected] = useState(false);
  const urlInputRef = useRef<HTMLInputElement | null>(null);

  const isLikelyUrl = (s: string): boolean => {
    const t = s.trim();
    if (!t || /\s/.test(t)) return false;
    // Allow `http(s)://`, `www.`, or bare-domain (e.g. `openthink.run/docs`).
    return /^https?:\/\/\S+$/i.test(t) || /^www\.\S+\.\S+/i.test(t) ||
      /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t);
  };

  const handleUrlPaste = (e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (!isLikelyUrl(pasted)) return;
    // Normalize to https:// if the user pasted a bare domain so the
    // URL kind's worker fetch can resolve it.
    const normalized = /^https?:\/\//i.test(pasted) ? pasted.trim() : `https://${pasted.trim()}`;
    e.preventDefault();
    setUrlDraft(normalized);
    setUrlDetected(true);
    window.setTimeout(() => setUrlDetected(false), 2400);
    window.requestAnimationFrame(() => urlInputRef.current?.focus());
  };
  const [previewing, setPreviewing] = useState<KnowledgeItem | null>(null);
  // Drag-reorder state. `draggingId` is the item being moved; `overId` is
  // the row the cursor is over (used for the drop-target highlight).
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // Category-tag state. `activeTags` is the user's filter — items whose
  // `tags` array contains EVERY tag in the set stay visible. Empty set
  // = show all. `editingTagsFor` is the id of the item whose chip row
  // is currently in edit mode (textarea swap-in). `tagDraft` is the
  // working comma/space-separated string before commit.
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [editingTagsFor, setEditingTagsFor] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState<string>('');
  // Bulk-select mode — when on, each item gains a checkbox + clicking
  // the meta button adds/removes from `selectedKnowledge` instead of
  // opening the preview. Exits on Esc and on the "Done" button.
  const [knowledgeSelectMode, setKnowledgeSelectMode] = useState(false);
  const [selectedKnowledge, setSelectedKnowledge] = useState<Set<string>>(
    new Set(),
  );
  // Shared bulk-tag input — empty by default; populated when the user
  // hits the bulk Tag affordance. Reuses sanitizeKnowledgeTag so the
  // tags round-trip cleanly.
  const [bulkTagDraft, setBulkTagDraft] = useState<string>('');
  const [bulkTagBusy, setBulkTagBusy] = useState(false);
  const toggleKnowledgeSelect = (id: string) =>
    setSelectedKnowledge((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const bulkDeleteKnowledge = async () => {
    if (selectedKnowledge.size === 0) return;
    const ids = [...selectedKnowledge];
    const snapshot = items;
    setItems((prev) => prev.filter((i) => !selectedKnowledge.has(i.id)));
    setSelectedKnowledge(new Set());
    try {
      // Cohorts of 4 so we don't slam the worker on a 30-item delete.
      const cohort = 4;
      for (let i = 0; i < ids.length; i += cohort) {
        const batch = ids.slice(i, i + cohort);
        await Promise.all(
          batch.map((id) =>
            fetch(
              `/api/knowledge/${encodeURIComponent(agentName || 'default')}/${id}`,
              { method: 'DELETE' },
            ),
          ),
        );
      }
      showToast(`Removed ${ids.length} item${ids.length === 1 ? '' : 's'}`, 'ok');
      void refresh();
    } catch {
      setItems(snapshot);
      showToast('Bulk delete failed', 'err');
    }
  };
  const bulkPinKnowledge = async (target: boolean) => {
    if (selectedKnowledge.size === 0) return;
    const ids = [...selectedKnowledge].filter((id) => {
      const it = items.find((i) => i.id === id);
      return it && !!it.pinned !== target;
    });
    if (ids.length === 0) return;
    const snapshot = items;
    setItems((prev) =>
      prev.map((i) =>
        selectedKnowledge.has(i.id) ? { ...i, pinned: target } : i,
      ),
    );
    try {
      const cohort = 4;
      for (let i = 0; i < ids.length; i += cohort) {
        const batch = ids.slice(i, i + cohort);
        await Promise.all(
          batch.map((id) =>
            fetch(
              `/api/knowledge/${encodeURIComponent(agentName || 'default')}/${id}/pin`,
              { method: 'POST' },
            ),
          ),
        );
      }
      showToast(
        target
          ? `Pinned ${ids.length} item${ids.length === 1 ? '' : 's'}`
          : `Unpinned ${ids.length} item${ids.length === 1 ? '' : 's'}`,
        'ok',
      );
    } catch {
      setItems(snapshot);
      showToast('Bulk pin failed', 'err');
    }
  };
  const bulkApplyTags = async () => {
    if (selectedKnowledge.size === 0 || !bulkTagDraft.trim()) return;
    // Same dedup + sanitization as the per-item tag editor; we union
    // the new tags into each selected item's existing tag set so the
    // bulk action is additive (preserves whatever taxonomy was
    // already there).
    const parts = bulkTagDraft
      .split(/[\s,]+/)
      .map((t) => sanitizeKnowledgeTag(t))
      .filter((t): t is string => !!t);
    const dedup: string[] = [];
    const seen = new Set<string>();
    for (const t of parts) {
      if (!seen.has(t)) {
        seen.add(t);
        dedup.push(t);
        if (dedup.length >= 12) break;
      }
    }
    if (dedup.length === 0) return;
    setBulkTagBusy(true);
    const snapshot = items;
    setItems((prev) =>
      prev.map((i) => {
        if (!selectedKnowledge.has(i.id)) return i;
        const existing = Array.isArray(i.tags) ? i.tags : [];
        const merged = [...existing];
        for (const t of dedup) {
          if (!merged.includes(t) && merged.length < 12) merged.push(t);
        }
        return merged.length > 0 ? { ...i, tags: merged } : i;
      }),
    );
    try {
      const ids = [...selectedKnowledge];
      const cohort = 4;
      for (let i = 0; i < ids.length; i += cohort) {
        const batch = ids.slice(i, i + cohort);
        await Promise.all(
          batch.map((id) => {
            const item = items.find((it) => it.id === id);
            const existing = Array.isArray(item?.tags) ? item!.tags! : [];
            const merged = [...existing];
            for (const t of dedup) {
              if (!merged.includes(t) && merged.length < 12) merged.push(t);
            }
            return fetch(
              `/api/knowledge/${encodeURIComponent(agentName || 'default')}/${id}/tags`,
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags: merged }),
              },
            );
          }),
        );
      }
      showToast(
        `Added ${dedup.length} tag${dedup.length === 1 ? '' : 's'} to ${ids.length} item${ids.length === 1 ? '' : 's'}`,
        'ok',
      );
      setBulkTagDraft('');
    } catch {
      setItems(snapshot);
      showToast('Bulk tag failed', 'err');
    } finally {
      setBulkTagBusy(false);
    }
  };
  // Esc exits bulk-select mode + clears the selection so a stale pile
  // doesn't survive a tab switch.
  useEffect(() => {
    if (!knowledgeSelectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const editable = (e.target as HTMLElement | null)?.isContentEditable;
      if (tag === 'input' || tag === 'textarea' || editable) return;
      e.preventDefault();
      setKnowledgeSelectMode(false);
      setSelectedKnowledge(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [knowledgeSelectMode]);

  // Persist + revert tags on an item. Optimistic — we patch the local
  // items list first so the chips render immediately, then PUT to the
  // worker. On failure we restore the prior snapshot + toast so the user
  // isn't stuck with a phantom tag.
  const saveTags = async (id: string, raw: string) => {
    const parts = raw
      .split(/[\s,]+/)
      .map((t) => sanitizeKnowledgeTag(t))
      .filter((t): t is string => !!t);
    const dedup: string[] = [];
    const seen = new Set<string>();
    for (const t of parts) {
      if (!seen.has(t)) {
        seen.add(t);
        dedup.push(t);
        if (dedup.length >= 12) break;
      }
    }
    const snapshot = items;
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? dedup.length > 0
            ? { ...it, tags: dedup }
            : ((): KnowledgeItem => {
                const { tags: _t, ...rest } = it;
                return rest as KnowledgeItem;
              })()
          : it,
      ),
    );
    setEditingTagsFor(null);
    setTagDraft('');
    try {
      const res = await fetch(
        `/api/knowledge/${encodeURIComponent(agentName || 'default')}/${id}/tags`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: dedup }),
        },
      );
      if (!res.ok) throw new Error('save_failed');
    } catch {
      setItems(snapshot);
      showToast('Tag save failed', 'err');
    }
  };

  // Compute the global tag pool from the live items list. Each unique tag
  // gets a count so the filter row can show how many items would
  // survive the filter — useful when the user is staring at a tag they
  // haven't used in a while.
  const tagPool: Array<{ tag: string; count: number }> = (() => {
    const counts = new Map<string, number>();
    for (const it of items) {
      if (!Array.isArray(it.tags)) continue;
      for (const t of it.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  })();

  // Apply the activeTags filter to the rendered list. AND semantics —
  // every selected tag has to be present. Empty set passes everything.
  const visibleItems =
    activeTags.size === 0
      ? items
      : items.filter((it) => {
          if (!Array.isArray(it.tags) || it.tags.length === 0) return false;
          for (const want of activeTags) {
            if (!it.tags.includes(want)) return false;
          }
          return true;
        });

  const persistOrder = (next: KnowledgeItem[]) => {
    void fetch(`/api/knowledge/${encodeURIComponent(agentName || 'default')}/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: next.map((i) => i.id) }),
    }).catch(() => undefined);
  };

  const refresh = () =>
    fetch(`/api/knowledge/${encodeURIComponent(agentName || 'default')}`)
      .then((r) => r.json())
      .then((data: { items?: KnowledgeItem[] }) => setItems(data.items ?? []))
      .catch(() => undefined);

  useEffect(() => {
    void refresh();
  }, [agentName]);

  // Live cross-tab sync: every 10s, re-pull the canonical list from the
  // server. Skipped while a write is in flight (busy) or the preview modal
  // is open (the user is focused on one item). Cheap — the API just reads
  // a KV entry. Keeps a second tab's Knowledge pane in sync without the
  // user having to manually refresh.
  useEffect(() => {
    if (busy || previewing) return;
    const id = window.setInterval(() => {
      void refresh();
    }, 10_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentName, busy, previewing]);

  // Split the URL draft into a normalized list, dropping blanks and
  // de-duplicating. A single URL stays a 1-element array; a paste of
  // newline-separated or space-separated URLs becomes the batch. Used
  // by both submit (which calls /url POST per item) and the preview
  // chip below the input.
  const parseUrlBatch = (raw: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const tok of raw.split(/[\s,;]+/)) {
      const t = tok.trim();
      if (!t) continue;
      // Normalize bare domains to https:// like the paste-detect does.
      const url = /^https?:\/\//i.test(t) ? t : `https://${t}`;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
    return out;
  };

  const addUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const urls = parseUrlBatch(urlDraft);
    if (urls.length === 0) return;
    setBusy(true);
    try {
      // For a single URL, keep using the user-typed title. For a batch,
      // the title field doesn't make sense across multiple URLs so we
      // omit it and let each item land with the server-extracted title
      // from the live page fetch.
      const title = urls.length === 1 ? titleDraft.trim() || undefined : undefined;
      // Fire in parallel cohorts of 4 so we don't blast the worker
      // (the /url POST does a live page fetch + summarize for each).
      let added = 0;
      let failed = 0;
      const cohort = 4;
      for (let i = 0; i < urls.length; i += cohort) {
        const batch = urls.slice(i, i + cohort);
        const results = await Promise.allSettled(
          batch.map((u) =>
            fetch(
              `/api/knowledge/${encodeURIComponent(agentName || 'default')}/url`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: u, title }),
              },
            ),
          ),
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value.ok) added += 1;
          else failed += 1;
        }
      }
      setUrlDraft('');
      setTitleDraft('');
      await refresh();
      if (urls.length > 1) {
        showToast(
          failed > 0
            ? `Added ${added} URLs · ${failed} failed`
            : `Added ${added} URLs`,
          failed > 0 ? 'info' : 'ok',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const addText = async () => {
    if (!textDraft.trim() || !titleDraft.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/knowledge/${encodeURIComponent(agentName || 'default')}/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: titleDraft.trim(), body: textDraft }),
      });
      setTextDraft('');
      setTitleDraft('');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const [uploadError, setUploadError] = useState<string | null>(null);
  // Hold the failed file + title so a retry button can re-fire the same
  // upload without forcing the user to re-pick the file. Cleared on
  // success and on explicit dismiss.
  const [failedUpload, setFailedUpload] = useState<{
    file: File;
    title?: string;
  } | null>(null);
  // Progress state for the active upload — pct 0..100. Drives the inline
  // progress bar in the drop zone. We use XMLHttpRequest instead of fetch
  // because the latter doesn't expose `upload.onprogress` yet.
  const [uploadProgress, setUploadProgress] = useState<{
    name: string;
    pct: number;
  } | null>(null);
  const uploadFile = async (file: File, retryTitle?: string) => {
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('File is over the 5MB limit.');
      setFailedUpload(null); // re-pick a smaller one
      return;
    }
    setUploadError(null);
    setBusy(true);
    setUploadProgress({ name: file.name, pct: 0 });
    // Snapshot the title at attempt time so a retry uses the exact same
    // title the user typed — not whatever's in the input now (they may
    // have typed something else while the error sat on screen).
    const titleAtAttempt = retryTitle ?? (titleDraft.trim() || undefined);
    try {
      const form = new FormData();
      form.set('file', file);
      if (titleAtAttempt) form.set('title', titleAtAttempt);
      const data = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open(
          'POST',
          `/api/knowledge/${encodeURIComponent(agentName || 'default')}/file`,
        );
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const pct = Math.min(99, Math.round((e.loaded / e.total) * 100));
          setUploadProgress({ name: file.name, pct });
        };
        xhr.onload = () => {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            resolve({ ok: false, error: 'parse_failed' });
          }
        };
        xhr.onerror = () => resolve({ ok: false, error: 'network' });
        xhr.send(form);
      });
      if (!data.ok) {
        setUploadError(data.error ?? 'upload_failed');
        setUploadProgress(null);
        setFailedUpload({ file, title: titleAtAttempt });
      } else {
        // Pin the bar at 100% for a beat so the user sees the green tick
        // before it disappears.
        setUploadProgress({ name: file.name, pct: 100 });
        window.setTimeout(() => setUploadProgress(null), 600);
        setTitleDraft('');
        setFailedUpload(null);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const retryUpload = () => {
    if (!failedUpload) return;
    void uploadFile(failedUpload.file, failedUpload.title);
  };

  const dismissUploadError = () => {
    setUploadError(null);
    setFailedUpload(null);
  };

  const remove = async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await fetch(
      `/api/knowledge/${encodeURIComponent(agentName || 'default')}/${id}`,
      { method: 'DELETE' },
    );
    void refresh();
  };

  const pin = async (id: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, pinned: !i.pinned } : i)));
    await fetch(
      `/api/knowledge/${encodeURIComponent(agentName || 'default')}/${id}/pin`,
      { method: 'POST' },
    );
  };

  // Bulk URL refresh — hits the server bulk route which fans out the
  // fetches in cohorts of 6 in parallel, then re-pulls our own list to
  // pick up the new titles. Surfaces a summary toast with the
  // refreshed/failed counts.
  const refreshAllUrls = async () => {
    const urlCount = items.filter((i) => i.kind === 'url').length;
    if (urlCount === 0) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/knowledge/${encodeURIComponent(agentName || 'default')}/refresh-urls`,
        { method: 'POST' },
      );
      const data = (await res.json()) as {
        ok: boolean;
        refreshed?: number;
        failed?: number;
        outcomes?: Array<{ id: string; ok: boolean; reason?: string }>;
      };
      if (data.ok) {
        await refresh();
        // Update per-URL failure tracker from the worker's per-id
        // outcomes so the inline `⚠ failed` chip reflects this
        // batch's reality — successes clear, failures bump.
        if (Array.isArray(data.outcomes)) {
          for (const o of data.outcomes) {
            if (o.ok) clearUrlFailure(o.id);
            else markUrlFailure(o.id);
          }
        }
        const msg =
          (data.failed ?? 0) > 0
            ? `Refreshed ${data.refreshed ?? 0} · ${data.failed} failed`
            : `Refreshed ${data.refreshed ?? 0} URL${(data.refreshed ?? 0) === 1 ? '' : 's'}`;
        showToast(msg, (data.failed ?? 0) > 0 ? 'info' : 'ok');
      } else {
        showToast('Refresh failed', 'err');
      }
    } catch {
      showToast('Refresh failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  // Per-URL refresh failure tracking. Each failed refresh bumps the
  // count + records the timestamp; successful refresh clears the
  // entry. The Knowledge row uses these to surface a warning chip
  // (`failed 2× · 3h ago`) so the user can tell a stale title from a
  // page that's gone dark without having to click Refresh.
  const [urlFailures, setUrlFailures] = useState<
    Record<string, { count: number; at: number }>
  >(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem('openthink:knowledge-url-failures');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out: Record<string, { count: number; at: number }> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (
          v &&
          typeof v === 'object' &&
          typeof (v as { count?: number }).count === 'number' &&
          typeof (v as { at?: number }).at === 'number'
        ) {
          out[k] = { count: (v as { count: number }).count, at: (v as { at: number }).at };
        }
      }
      return out;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (Object.keys(urlFailures).length === 0) {
      window.localStorage.removeItem('openthink:knowledge-url-failures');
    } else {
      window.localStorage.setItem(
        'openthink:knowledge-url-failures',
        JSON.stringify(urlFailures),
      );
    }
  }, [urlFailures]);
  const markUrlFailure = (id: string) =>
    setUrlFailures((prev) => ({
      ...prev,
      [id]: { count: (prev[id]?.count ?? 0) + 1, at: Date.now() },
    }));
  const clearUrlFailure = (id: string) =>
    setUrlFailures((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });

  // URL refresh — re-pulls the live page's <title> via the worker route
  // and folds the new title into the local item. On a fetch failure the
  // server keeps the old title; we surface a `Refresh failed` toast so
  // the user knows the page is unreachable.
  const refreshUrl = async (id: string) => {
    try {
      const res = await fetch(
        `/api/knowledge/${encodeURIComponent(agentName || 'default')}/${id}/refresh`,
        { method: 'POST' },
      );
      const data = (await res.json()) as { ok: boolean; title?: string };
      if (data.ok && data.title) {
        setItems((prev) =>
          prev.map((i) => (i.id === id ? { ...i, title: data.title!, addedAt: Date.now() } : i)),
        );
        clearUrlFailure(id);
        showToast(`Refreshed: ${data.title.slice(0, 40)}`, 'ok');
      } else {
        markUrlFailure(id);
        showToast('Refresh failed — page unreachable', 'err');
      }
    } catch {
      markUrlFailure(id);
      showToast('Refresh failed', 'err');
    }
  };

  const clearAll = async () => {
    if (items.length === 0) return;
    if (
      !window.confirm(
        `Delete all ${items.length} knowledge item${items.length === 1 ? '' : 's'}? Blob-backed files in R2 will also be removed. This can't be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    // Optimistic clear; rollback on error.
    const snapshot = items;
    setItems([]);
    try {
      const res = await fetch(
        `/api/knowledge/${encodeURIComponent(agentName || 'default')}`,
        { method: 'DELETE' },
      );
      const data = (await res.json()) as { ok: boolean; deleted?: number };
      if (data.ok) {
        showToast(
          `Cleared ${data.deleted ?? snapshot.length} knowledge item${(data.deleted ?? snapshot.length) === 1 ? '' : 's'}`,
          'ok',
        );
      } else {
        setItems(snapshot);
        showToast('Clear failed', 'err');
      }
    } catch {
      setItems(snapshot);
      showToast('Clear failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsPane
      title="Knowledge"
      lede="Files and URLs the agent should always have in context. Up to 50 items; pinned items load first."
    >
      {items.length > 0 && (
        <div className="knowledge__bulk">
          <span className="ot-micro">
            {knowledgeSelectMode && selectedKnowledge.size > 0
              ? `${selectedKnowledge.size} of ${items.length} selected`
              : `${items.length} item${items.length === 1 ? '' : 's'}`}
            {!knowledgeSelectMode &&
              items.filter((i) => i.pinned).length > 0 &&
              ` · ${items.filter((i) => i.pinned).length} pinned`}
            {!knowledgeSelectMode &&
              items.filter((i) => i.kind === 'url').length > 0 &&
              ` · ${items.filter((i) => i.kind === 'url').length} URL${items.filter((i) => i.kind === 'url').length === 1 ? '' : 's'}`}
          </span>
          <div className="knowledge__bulk-actions">
            {knowledgeSelectMode ? (
              <>
                <button
                  type="button"
                  className="ot-btn ot-btn--ghost"
                  onClick={() =>
                    setSelectedKnowledge(new Set(items.map((i) => i.id)))
                  }
                  disabled={busy || selectedKnowledge.size === items.length}
                  title="Select every item"
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="ot-btn ot-btn--ghost"
                  onClick={() => void bulkPinKnowledge(true)}
                  disabled={busy || selectedKnowledge.size === 0}
                  title="Pin every selected item"
                >
                  ★ Pin
                </button>
                <button
                  type="button"
                  className="ot-btn ot-btn--ghost"
                  onClick={() => void bulkPinKnowledge(false)}
                  disabled={busy || selectedKnowledge.size === 0}
                  title="Unpin every selected item"
                >
                  ☆ Unpin
                </button>
                <button
                  type="button"
                  className="ot-btn"
                  onClick={() => void bulkDeleteKnowledge()}
                  disabled={busy || selectedKnowledge.size === 0}
                  title="Remove every selected item"
                >
                  Delete{selectedKnowledge.size > 0 ? ` ${selectedKnowledge.size}` : ''}
                </button>
                <button
                  type="button"
                  className="ot-btn ot-btn--ghost knowledge__bulk-clear"
                  onClick={() => {
                    setKnowledgeSelectMode(false);
                    setSelectedKnowledge(new Set());
                    setBulkTagDraft('');
                  }}
                  disabled={busy}
                  title="Exit select mode (Esc)"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                {items.some((i) => i.kind === 'url') && (
                  <button
                    type="button"
                    className="ot-btn ot-btn--ghost"
                    onClick={() => void refreshAllUrls()}
                    disabled={busy}
                    title="Re-fetch every pinned URL's title in parallel"
                  >
                    ↻ Refresh URLs
                  </button>
                )}
                <button
                  type="button"
                  className="ot-btn ot-btn--ghost"
                  onClick={() => setKnowledgeSelectMode(true)}
                  disabled={busy}
                  title="Pick multiple items for bulk actions"
                >
                  Select
                </button>
                <button
                  type="button"
                  className="ot-btn ot-btn--ghost knowledge__bulk-clear"
                  onClick={() => void clearAll()}
                  disabled={busy}
                >
                  Clear all
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {/* Bulk-tag input — visible only in select mode + when the user
          has actually picked something. Sits flush under the bulk
          action bar so the input + action stack reads as one. The
          tags get UNIONED into each selected item's existing list
          (vs. replace) — additive bulk-edits are the common case;
          if the user wants to clear they can use the per-item
          edit affordance. */}
      {knowledgeSelectMode && selectedKnowledge.size > 0 && (
        <div className="knowledge__bulk-tag">
          <input
            type="text"
            className="ot-input knowledge__bulk-tag-input"
            placeholder="Add tags to every selected item (space- or comma-separated)…"
            value={bulkTagDraft}
            onChange={(e) => setBulkTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && bulkTagDraft.trim() && !bulkTagBusy) {
                e.preventDefault();
                void bulkApplyTags();
              }
            }}
            disabled={bulkTagBusy}
          />
          <button
            type="button"
            className="ot-btn ot-btn--ghost"
            onClick={() => void bulkApplyTags()}
            disabled={bulkTagBusy || !bulkTagDraft.trim()}
          >
            {bulkTagBusy ? 'Tagging…' : 'Add tags'}
          </button>
        </div>
      )}
      <form onSubmit={addUrl} className="knowledge__form">
        <input
          className="ot-input"
          placeholder="title (optional)"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onPaste={handleUrlPaste}
        />
        {(() => {
          const batch = parseUrlBatch(urlDraft);
          const multi = batch.length > 1;
          return (
            <>
              <div className="knowledge__form-row">
                <input
                  ref={urlInputRef}
                  className={`ot-input${urlDetected ? ' ot-input--detected' : ''}`}
                  placeholder="https://… or paste one URL (or several, space/comma/newline-separated)"
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  type={multi ? 'text' : 'url'}
                />
                <button
                  type="submit"
                  className="ot-btn"
                  disabled={busy || batch.length === 0}
                >
                  {busy
                    ? 'Adding…'
                    : multi
                      ? `Add ${batch.length} URLs`
                      : 'Add URL'}
                </button>
              </div>
              {multi && (
                <p className="ot-micro knowledge__url-batch">
                  ✦ {batch.length} URLs detected — title field will be ignored
                  for batch adds (each item gets its server-extracted title).
                </p>
              )}
            </>
          );
        })()}
        {urlDetected && (
          <p className="ot-micro knowledge__url-detected">
            ✦ URL detected from paste — switched to URL kind. Hit
            <strong> Add URL</strong> to save.
          </p>
        )}
        <details className="knowledge__details">
          <summary>Paste text instead</summary>
          <textarea
            className="ot-input knowledge__text"
            placeholder="Paste a block of text the agent should always remember…"
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            onPaste={handleUrlPaste}
            rows={6}
          />
          <button
            type="button"
            className="ot-btn ot-btn--ghost"
            disabled={busy || !textDraft.trim() || !titleDraft.trim()}
            onClick={() => void addText()}
          >
            Save text snippet
          </button>
          <p className="ot-micro">A title is required for text snippets.</p>
        </details>
        <details className="knowledge__details">
          <summary>Upload a file</summary>
          <div
            className="knowledge__drop"
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.classList.add('knowledge__drop--over');
            }}
            onDragLeave={(e) => {
              e.currentTarget.classList.remove('knowledge__drop--over');
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove('knowledge__drop--over');
              const file = e.dataTransfer.files?.[0];
              if (file) void uploadFile(file);
            }}
          >
            <p>Drag a file here, or pick one:</p>
            <input
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadFile(file);
                e.target.value = '';
              }}
            />
            <p className="ot-micro">Up to 5MB. PDF, images, code, docs — anything text-y or visual.</p>
            {uploadProgress && (
              <div className="knowledge__upload">
                <div className="knowledge__upload-meta">
                  <span className="knowledge__upload-name">{uploadProgress.name}</span>
                  <span className="knowledge__upload-pct">{uploadProgress.pct}%</span>
                </div>
                <div className="knowledge__upload-bar">
                  <div
                    className="knowledge__upload-fill"
                    style={{ width: `${uploadProgress.pct}%` }}
                  />
                </div>
              </div>
            )}
            {uploadError && (
              <div className="knowledge__upload-err" role="alert">
                <span className="knowledge__upload-err-glyph" aria-hidden>⊘</span>
                <div className="knowledge__upload-err-body">
                  <strong>Upload failed</strong>
                  <span className="ot-micro">
                    {uploadError}
                    {failedUpload && ` · ${failedUpload.file.name}`}
                  </span>
                </div>
                {failedUpload && (
                  <button
                    type="button"
                    className="ot-btn ot-btn--ghost knowledge__upload-err-retry"
                    onClick={retryUpload}
                    disabled={busy}
                  >
                    ↻ Retry
                  </button>
                )}
                <button
                  type="button"
                  className="knowledge__upload-err-dismiss"
                  onClick={dismissUploadError}
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        </details>
      </form>

      {tagPool.length > 0 && (
        <div className="knowledge__tag-filters" role="group" aria-label="Filter knowledge by tag">
          <span className="ot-micro knowledge__tag-filters-label">tags</span>
          {tagPool.map(({ tag, count }) => {
            const isActive = activeTags.has(tag);
            return (
              <button
                key={tag}
                type="button"
                className={`knowledge__tag-chip${isActive ? ' knowledge__tag-chip--active' : ''}`}
                onClick={() => {
                  setActiveTags((prev) => {
                    const next = new Set(prev);
                    if (next.has(tag)) next.delete(tag);
                    else next.add(tag);
                    return next;
                  });
                }}
                title={
                  isActive
                    ? `Stop filtering by ${tag}`
                    : `Show items tagged ${tag} (${count})`
                }
              >
                {tag}
                <span className="knowledge__tag-chip-n">{count}</span>
              </button>
            );
          })}
          {activeTags.size > 0 && (
            <button
              type="button"
              className="knowledge__tag-chip knowledge__tag-chip--clear"
              onClick={() => setActiveTags(new Set())}
            >
              × clear
            </button>
          )}
        </div>
      )}
      <ul className="knowledge__list">
        {items.length === 0 && (
          <li className="ot-micro knowledge__empty">
            No knowledge yet. Add a URL the agent should always look at, or paste a snippet.
          </li>
        )}
        {items.length > 0 && visibleItems.length === 0 && (
          <li className="ot-micro knowledge__empty">
            No items match the active tag{activeTags.size === 1 ? '' : 's'}.
            Try clearing the filter above.
          </li>
        )}
        {visibleItems.map((item) => (
          <li
            key={item.id}
            className={`knowledge__item${item.pinned ? ' knowledge__item--pinned' : ''}${draggingId === item.id ? ' knowledge__item--dragging' : ''}${overId === item.id && draggingId && draggingId !== item.id ? ' knowledge__item--over' : ''}${knowledgeSelectMode && selectedKnowledge.has(item.id) ? ' knowledge__item--selected' : ''}${knowledgeSelectMode ? ' knowledge__item--selectable' : ''}`}
            // Disable drag while in select mode — drag-to-reorder
            // would compete with click-to-select and confuse the
            // gesture. Re-enabled the moment select mode exits.
            draggable={!knowledgeSelectMode}
            onDragStart={(e) => {
              if (knowledgeSelectMode) return;
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', item.id);
              setDraggingId(item.id);
            }}
            onDragOver={(e) => {
              if (!draggingId || draggingId === item.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setOverId(item.id);
            }}
            onDragLeave={() => {
              setOverId((cur) => (cur === item.id ? null : cur));
            }}
            onDrop={(e) => {
              e.preventDefault();
              const srcId = draggingId;
              setDraggingId(null);
              setOverId(null);
              if (!srcId || srcId === item.id) return;
              setItems((prev) => {
                const fromIdx = prev.findIndex((p) => p.id === srcId);
                const toIdx = prev.findIndex((p) => p.id === item.id);
                if (fromIdx < 0 || toIdx < 0) return prev;
                const next = prev.slice();
                const [moved] = next.splice(fromIdx, 1);
                next.splice(toIdx, 0, moved!);
                persistOrder(next);
                return next;
              });
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setOverId(null);
            }}
          >
            {knowledgeSelectMode ? (
              <span
                className={`knowledge__select-check${selectedKnowledge.has(item.id) ? ' knowledge__select-check--on' : ''}`}
                role="checkbox"
                aria-checked={selectedKnowledge.has(item.id)}
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleKnowledgeSelect(item.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleKnowledgeSelect(item.id);
                  }
                }}
                title={selectedKnowledge.has(item.id) ? 'Deselect' : 'Select'}
              >
                {selectedKnowledge.has(item.id) ? '✓' : ''}
              </span>
            ) : (
              <span className="knowledge__drag-handle" aria-hidden title="Drag to reorder">
                ⠿
              </span>
            )}
            <button
              type="button"
              className="knowledge__meta knowledge__meta--button"
              onClick={() => {
                if (knowledgeSelectMode) {
                  toggleKnowledgeSelect(item.id);
                } else {
                  setPreviewing(item);
                }
              }}
              title={knowledgeSelectMode ? 'Toggle selection' : 'Preview'}
            >
              <span
                className={`knowledge__kind-icon knowledge__kind-icon--${item.kind}`}
                aria-label={item.kind}
                title={item.kind}
              >
                {knowledgeIconFor(item)}
              </span>
              <strong className="knowledge__title">{item.title}</strong>
              {item.kind === 'url' && (
                <span className="knowledge__source">{item.source}</span>
              )}
              {(item.kind === 'file' || item.kind === 'text') && (
                <span className="knowledge__source">
                  {item.bytes ? `${(item.bytes / 1024).toFixed(1)} KB · ` : ''}
                  R2 · {item.source.split('/').slice(-1)[0]}
                </span>
              )}
              <span className="ot-micro">
                added {new Date(item.addedAt).toLocaleDateString()}
              </span>
              {/* URL refresh failure indicator — only renders when the
                  user has hit Refresh on this item AND the worker
                  failed at least once. Click on the row's Refresh
                  button to retry; success clears this chip. */}
              {item.kind === 'url' && urlFailures[item.id] && (
                <span
                  className="knowledge__url-fail"
                  title={`Last refresh failed ${new Date(urlFailures[item.id]!.at).toLocaleString()}. The page may be down or moved.`}
                >
                  ⚠ failed{' '}
                  {urlFailures[item.id]!.count > 1
                    ? `${urlFailures[item.id]!.count}×`
                    : 'once'}
                </span>
              )}
            </button>
            {/* Per-item tag strip — shows existing chips inline + an
                edit affordance. Clicking a chip activates that tag in
                the global filter so the user can drill into a group
                with one click. Clicking the "edit" button swaps the
                strip for a textarea pre-filled with the current tags. */}
            <div className="knowledge__tags">
              {editingTagsFor === item.id ? (
                <div className="knowledge__tags-edit">
                  <input
                    type="text"
                    className="ot-input knowledge__tags-input"
                    value={tagDraft}
                    autoFocus
                    placeholder="space- or comma-separated tags…"
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void saveTags(item.id, tagDraft);
                      } else if (e.key === 'Escape') {
                        setEditingTagsFor(null);
                        setTagDraft('');
                      }
                    }}
                    onBlur={() => {
                      // Save on blur so a user who clicks away still
                      // commits their work. Escape cancels.
                      void saveTags(item.id, tagDraft);
                    }}
                  />
                  <span className="ot-micro knowledge__tags-hint">
                    Enter to save · Esc to cancel · lowercase a-z, 0-9, -
                  </span>
                </div>
              ) : (
                <>
                  {Array.isArray(item.tags) &&
                    item.tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`knowledge__tag-chip knowledge__tag-chip--item${activeTags.has(t) ? ' knowledge__tag-chip--active' : ''}`}
                        onClick={() => {
                          setActiveTags((prev) => {
                            const next = new Set(prev);
                            if (next.has(t)) next.delete(t);
                            else next.add(t);
                            return next;
                          });
                        }}
                        title={`Filter by ${t}`}
                      >
                        {t}
                      </button>
                    ))}
                  <button
                    type="button"
                    className="knowledge__tag-edit-btn"
                    onClick={() => {
                      setEditingTagsFor(item.id);
                      setTagDraft(
                        Array.isArray(item.tags) ? item.tags.join(' ') : '',
                      );
                    }}
                    title={
                      Array.isArray(item.tags) && item.tags.length > 0
                        ? 'Edit tags'
                        : 'Add tags'
                    }
                  >
                    {Array.isArray(item.tags) && item.tags.length > 0
                      ? '✎'
                      : '+ tag'}
                  </button>
                </>
              )}
            </div>
            <div className="knowledge__actions">
              <button
                type="button"
                className="ot-btn ot-btn--ghost"
                onClick={() => void pin(item.id)}
              >
                {item.pinned ? 'Unpin' : 'Pin'}
              </button>
              {item.kind === 'url' && (
                <>
                  <a
                    className="ot-btn ot-btn--ghost"
                    href={item.source}
                    target="_blank"
                    rel="noreferrer noopener"
                    title="Open the URL in a new tab"
                    onClick={(e) => e.stopPropagation()}
                  >
                    ↗ Open
                  </a>
                  <button
                    type="button"
                    className="ot-btn ot-btn--ghost"
                    onClick={() => void refreshUrl(item.id)}
                    title="Re-fetch title from the live page"
                  >
                    ↻ Refresh
                  </button>
                </>
              )}
              {(item.kind === 'file' || item.kind === 'text') && (
                <a
                  className="ot-btn ot-btn--ghost"
                  href={`/api/artifacts/${encodeURIComponent(item.source)}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="Open the underlying R2 object in a new tab"
                  onClick={(e) => e.stopPropagation()}
                >
                  ↗ Open
                </a>
              )}
              <button
                type="button"
                className="ot-btn ot-btn--ghost"
                onClick={() => void remove(item.id)}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
      {previewing && (
        <ArtifactPreview
          source={previewing.source}
          title={previewing.title}
          meta={
            previewing.kind === 'url'
              ? previewing.source
              : `${previewing.kind}${previewing.bytes ? ` · ${(previewing.bytes / 1024).toFixed(1)} KB` : ''}`
          }
          onClose={() => setPreviewing(null)}
        />
      )}
    </SettingsPane>
  );
}

interface InvocationRow {
  turnId: string;
  threadId: string;
  threadTitle: string;
  model: string;
  durationMs: number;
  costCents: number;
  toolCallCount: number;
  status: 'ok' | 'partial' | 'failed';
  createdAt: number;
  /** Deduped tool names invoked during this turn — populated by worker. */
  tools?: string[];
}

interface InvocationDetail {
  turnId: string;
  threadId: string;
  model: string;
  createdAt: number;
  costCents: number;
  durationMs: number;
  toolCallCount: number;
  status: string;
  scores: {
    schema: number | null;
    relevancy: number | null;
    faithfulness: number | null;
    overall: number | null;
  };
  payload: unknown;
}

function Invocations({ agentName }: { agentName: string }) {
  const [rows, setRows] = useState<InvocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<{ count24h: number; costCents24h: number }>({
    count24h: 0,
    costCents24h: 0,
  });
  const [source, setSource] = useState<string>('');
  const [expandedTurn, setExpandedTurn] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, InvocationDetail>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  // Row density — `comfortable` is the original layout, `compact` tightens
  // padding + drops font-size so heavy users with hundreds of rows can
  // scan more at once. Persisted across reloads.
  const [density, setDensity] = useState<'comfortable' | 'compact'>(() => {
    if (typeof window === 'undefined') return 'comfortable';
    return (window.localStorage.getItem('openthink:invocations-density') as
      | 'comfortable'
      | 'compact'
      | null) ?? 'comfortable';
  });
  useEffect(() => {
    window.localStorage.setItem('openthink:invocations-density', density);
  }, [density]);
  // Free-text filter — matches against thread title, model, status,
  // AND the deduped tools list per row. Lets the user drill into "all
  // `researcher.research` turns" or "every failed call in this
  // thread" without leaving the tab.
  const [invocationSearch, setInvocationSearch] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem('openthink:invocations-search') ?? '';
  });
  useEffect(() => {
    if (invocationSearch) {
      window.localStorage.setItem('openthink:invocations-search', invocationSearch);
    } else {
      window.localStorage.removeItem('openthink:invocations-search');
    }
  }, [invocationSearch]);
  const filteredRows = (() => {
    const q = invocationSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      if (r.threadTitle.toLowerCase().includes(q)) return true;
      if (r.model.toLowerCase().includes(q)) return true;
      if (r.status.toLowerCase().includes(q)) return true;
      if (
        Array.isArray(r.tools) &&
        r.tools.some((t) => t.toLowerCase().includes(q))
      )
        return true;
      return false;
    });
  })();

  const toggleDetail = (turnId: string) => {
    if (expandedTurn === turnId) {
      setExpandedTurn(null);
      return;
    }
    setExpandedTurn(turnId);
    if (details[turnId]) return; // cached
    setDetailLoading(turnId);
    void fetch(
      `/api/invocations/${encodeURIComponent(agentName || 'default')}/turn/${encodeURIComponent(turnId)}`,
    )
      .then((r) => r.json())
      .then((data: InvocationDetail) => {
        setDetails((prev) => ({ ...prev, [turnId]: data }));
      })
      .catch(() => undefined)
      .finally(() => setDetailLoading((cur) => (cur === turnId ? null : cur)));
  };

  useEffect(() => {
    setLoading(true);
    void fetch(`/api/invocations/${encodeURIComponent(agentName || 'default')}`)
      .then((r) => r.json())
      .then((data: { invocations: InvocationRow[]; source: string }) => {
        setRows(data.invocations);
        setSource(data.source);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
    void fetch(
      `/api/invocations/${encodeURIComponent(agentName || 'default')}/summary`,
    )
      .then((r) => r.json())
      .then((data: { count24h: number; costCents24h: number }) => setSummary(data))
      .catch(() => undefined);
  }, [agentName]);

  const downloadCsv = () => {
    if (rows.length === 0) return;
    const header = ['When', 'Thread', 'Model', 'Duration (s)', 'Tools', 'Status', 'Cost ($)'];
    const escape = (val: unknown): string => {
      const s = String(val ?? '');
      // RFC4180: wrap if contains comma, quote, or newline; escape quotes.
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [
          new Date(r.createdAt).toISOString(),
          r.threadTitle,
          r.model,
          (r.durationMs / 1000).toFixed(1),
          r.toolCallCount,
          r.status,
          (r.costCents / 100).toFixed(2),
        ]
          .map(escape)
          .join(','),
      ),
    ];
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    a.download = `invocations-${agentName || 'agent'}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Release the blob URL on the next tick; download has already begun.
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
    showToast(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'}`, 'ok');
  };

  return (
    <SettingsPane
      title="Invocations"
      lede="Every turn this agent has run. Cost, duration, tool calls, status."
    >
      <div className="invocations__summary">
        <div className="invocations__stat">
          <span className="invocations__stat-num">{summary.count24h}</span>
          <span className="invocations__stat-label">runs in 24h</span>
        </div>
        <div className="invocations__stat">
          <span className="invocations__stat-num">
            ${(summary.costCents24h / 100).toFixed(2)}
          </span>
          <span className="invocations__stat-label">spent in 24h</span>
        </div>
        <div className="invocations__stat">
          <span className="invocations__stat-num">{rows.length}</span>
          <span className="invocations__stat-label">on this page</span>
        </div>
        <div className="invocations__search">
          <input
            type="search"
            className="ot-input invocations__search-input"
            placeholder="Filter by tool, thread, model, status…"
            value={invocationSearch}
            onChange={(e) => setInvocationSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && invocationSearch) {
                e.preventDefault();
                e.stopPropagation();
                setInvocationSearch('');
              }
            }}
            aria-label="Filter invocations"
          />
          {invocationSearch && (
            <span className="ot-micro invocations__search-count">
              {filteredRows.length}/{rows.length}
            </span>
          )}
        </div>
        <div className="invocations__density" role="group" aria-label="Row density">
          <button
            type="button"
            className={`invocations__density-btn${density === 'comfortable' ? ' invocations__density-btn--active' : ''}`}
            onClick={() => setDensity('comfortable')}
            title="Comfortable rows"
            aria-pressed={density === 'comfortable'}
          >
            ☰
          </button>
          <button
            type="button"
            className={`invocations__density-btn${density === 'compact' ? ' invocations__density-btn--active' : ''}`}
            onClick={() => setDensity('compact')}
            title="Compact rows"
            aria-pressed={density === 'compact'}
          >
            ≡
          </button>
        </div>
        <button
          type="button"
          className="ot-btn ot-btn--ghost invocations__export"
          onClick={downloadCsv}
          disabled={loading || rows.length === 0}
          title={rows.length === 0 ? 'Nothing to export yet' : 'Download CSV'}
        >
          Export CSV ↓
        </button>
      </div>
      {source === 'stub' && (
        <p className="ot-micro">
          Showing sample data — your D1 trajectories table is empty so far. Real
          rows land here as soon as you chat.
        </p>
      )}
      <table className={`invocations__table invocations__table--${density}`}>
        <thead>
          <tr>
            <th>When</th>
            <th>Thread</th>
            <th>Model</th>
            <th>Duration</th>
            <th>Tools</th>
            <th>Status</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <tr key={`skel-${i}`}>
                  <td><span className="ot-skel ot-skel--row" style={{ width: '60%' }} /></td>
                  <td><span className="ot-skel ot-skel--row" style={{ width: '80%' }} /></td>
                  <td><span className="ot-skel ot-skel--row" style={{ width: '70%' }} /></td>
                  <td><span className="ot-skel ot-skel--row" style={{ width: '40%' }} /></td>
                  <td><span className="ot-skel ot-skel--row" style={{ width: '30%' }} /></td>
                  <td><span className="ot-skel ot-skel--row" style={{ width: '50%' }} /></td>
                  <td><span className="ot-skel ot-skel--row" style={{ width: '40%' }} /></td>
                </tr>
              ))
            : filteredRows.flatMap((r) => {
                const isOpen = expandedTurn === r.turnId;
                const detail = details[r.turnId];
                const rowEls: React.ReactNode[] = [
                  <tr
                    key={r.turnId}
                    className={`invocations__row${isOpen ? ' invocations__row--open' : ''}`}
                    onClick={() => toggleDetail(r.turnId)}
                  >
                    <td>{relTime(r.createdAt)}</td>
                    <td>{r.threadTitle}</td>
                    <td className="invocations__model">{r.model}</td>
                    <td>{(r.durationMs / 1000).toFixed(1)}s</td>
                    <td>{r.toolCallCount}</td>
                    <td>
                      <span className={`invocations__status invocations__status--${r.status}`}>
                        {r.status}
                      </span>
                    </td>
                    <td>${(r.costCents / 100).toFixed(2)}</td>
                  </tr>,
                ];
                if (isOpen) {
                  rowEls.push(
                    <tr key={`${r.turnId}-detail`} className="invocations__detail-row">
                      <td colSpan={7} className="invocations__detail">
                        <InvocationDetailView
                          loading={detailLoading === r.turnId}
                          detail={detail}
                        />
                      </td>
                    </tr>,
                  );
                }
                return rowEls;
              })}
        </tbody>
      </table>
    </SettingsPane>
  );
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

// Inline trajectory detail rendered under a clicked Invocations row. Pulls
// from /api/invocations/<agent>/turn/<turnId> on first open and caches the
// result so re-toggling is instant. Surfaces the input prompt, the
// generated reply, the tool calls, and any Judge rubric scores attached.
function InvocationDetailView({
  loading,
  detail,
}: {
  loading: boolean;
  detail: InvocationDetail | undefined;
}) {
  if (loading) {
    return (
      <div className="invocations__detail-inner">
        <span className="ot-skel ot-skel--row" style={{ width: '70%' }} />
        <span className="ot-skel ot-skel--row" style={{ width: '85%' }} />
        <span className="ot-skel ot-skel--row" style={{ width: '60%' }} />
      </div>
    );
  }
  if (!detail) {
    return <p className="ot-micro">Couldn't load this turn.</p>;
  }
  const payload = (detail.payload ?? {}) as {
    input?: { content?: string };
    output?: { content?: string };
    toolCalls?: Array<{ tool?: string; status?: string; durationMs?: number }>;
  };
  const scoreEntries: Array<[string, number | null]> = [
    ['overall', detail.scores.overall],
    ['faithfulness', detail.scores.faithfulness],
    ['relevancy', detail.scores.relevancy],
    ['schema', detail.scores.schema],
  ];
  const hasScores = scoreEntries.some(([, v]) => v != null);
  return (
    <div className="invocations__detail-inner">
      <div className="invocations__detail-grid">
        <div className="invocations__detail-block">
          <span className="ot-label">Prompt</span>
          <p className="invocations__detail-text">
            {payload.input?.content?.slice(0, 600) ?? '(no prompt recorded)'}
            {payload.input?.content && payload.input.content.length > 600 ? '…' : ''}
          </p>
        </div>
        <div className="invocations__detail-block">
          <span className="ot-label">Response</span>
          <p className="invocations__detail-text">
            {payload.output?.content?.slice(0, 600) ?? '(no response recorded)'}
            {payload.output?.content && payload.output.content.length > 600 ? '…' : ''}
          </p>
        </div>
      </div>
      {Array.isArray(payload.toolCalls) && payload.toolCalls.length > 0 && (
        <div className="invocations__detail-block">
          <span className="ot-label">Tool calls</span>
          <ul className="invocations__detail-tools">
            {payload.toolCalls.map((t, i) => (
              <li key={i}>
                <code>{t.tool ?? '(tool)'}</code>
                <span className="ot-micro">
                  {t.status ?? 'ok'}
                  {t.durationMs ? ` · ${(t.durationMs / 1000).toFixed(1)}s` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasScores && (
        <div className="invocations__detail-block">
          <span className="ot-label">Judge scores</span>
          <div className="invocations__detail-scores">
            {scoreEntries.map(([k, v]) =>
              v == null ? null : (
                <span key={k} className="invocations__detail-score">
                  <span className="invocations__detail-score-label">{k}</span>
                  <span className="invocations__detail-score-bar">
                    <span
                      className="invocations__detail-score-fill"
                      style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }}
                    />
                  </span>
                  <span className="invocations__detail-score-num">{v.toFixed(2)}</span>
                </span>
              ),
            )}
          </div>
        </div>
      )}
      <div className="invocations__detail-foot ot-micro">
        turn <code>{detail.turnId}</code> · thread <code>{detail.threadId}</code>
      </div>
    </div>
  );
}

function Cloudflare() {
  // Pull paid-plan + custom-domain state from KV so this tab reflects what was
  // chosen during onboarding (and stays current if the user upgrades later).
  const [info, setInfo] = useState<{
    plan?: string;
    customDomain?: string;
    workersPaid?: boolean;
  }>({});
  // Token revalidation flow — the saved Cloudflare API token lives in
  // wrangler secrets (not accessible client-side), so revalidation
  // requires the user paste it again. We surface a collapsible
  // input + check button; the worker's existing
  // /api/cf-token/validate endpoint does the actual upstream verify.
  const [tokenPanelOpen, setTokenPanelOpen] = useState(false);
  const [tokenDraft, setTokenDraft] = useState('');
  const [tokenResult, setTokenResult] = useState<
    | { kind: 'ok'; status: string }
    | { kind: 'err'; error: string }
    | { kind: 'checking' }
    | null
  >(null);
  // Persist the last successful validation timestamp + reported
  // status so subsequent visits to this tab surface a "last
  // validated 5min ago — active" reminder without re-running the
  // check. Stored in localStorage as a JSON blob keyed on the
  // canonical settings string. Refreshes whenever a check lands
  // OK; never cleared on err (the user can still see when it was
  // last good, which is the question they care about).
  type LastValidated = { at: number; status: string };
  const [lastValidated, setLastValidated] = useState<LastValidated | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem('openthink:cf-token-validated');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.at === 'number' &&
        typeof parsed.status === 'string'
      ) {
        return { at: parsed.at, status: parsed.status };
      }
      return null;
    } catch {
      return null;
    }
  });
  const runTokenValidate = async () => {
    if (!tokenDraft.trim()) return;
    setTokenResult({ kind: 'checking' });
    try {
      const res = await fetch('/api/cf-token/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenDraft.trim() }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        status?: string;
        error?: string;
      };
      if (data.ok) {
        const status = data.status ?? 'active';
        setTokenResult({ kind: 'ok', status });
        const next: LastValidated = { at: Date.now(), status };
        setLastValidated(next);
        try {
          window.localStorage.setItem(
            'openthink:cf-token-validated',
            JSON.stringify(next),
          );
        } catch {
          /* quota — non-fatal; the in-memory state still reflects it */
        }
      } else {
        setTokenResult({
          kind: 'err',
          error: data.error ?? 'verify_failed',
        });
      }
    } catch (err) {
      setTokenResult({
        kind: 'err',
        error: err instanceof Error ? err.message : 'network error',
      });
    }
  };
  // Live binding readout — which DOs / KV / R2 / etc. are actually wired
  // in this worker. Pulled from /api/cf-bindings which checks `in env`
  // for each canonical binding name.
  interface Binding {
    kind: string;
    name: string;
    label: string;
    bound: boolean;
  }
  const [bindings, setBindings] = useState<Binding[]>([]);
  useEffect(() => {
    void fetch('/api/settings/your%20agent')
      .then((r) => r.json())
      .then((data: { plan?: string; customDomain?: string; workersPaid?: boolean } | null) => {
        if (data) setInfo(data);
      })
      .catch(() => undefined);
    void fetch('/api/cf-bindings')
      .then((r) => r.json())
      .then((data: { bindings?: Binding[] }) => {
        if (data.bindings) setBindings(data.bindings);
      })
      .catch(() => undefined);
  }, []);
  return (
    <SettingsPane title="Cloudflare" lede="Token, account, plan, hostname, providers.">
      <Field label="Account" value="acct_••••2c79" />
      <Field label="API token" value="••••••••••••••••••••s9x4" />
      {lastValidated && (() => {
        // Surface a small "last validated" chip below the API token
        // field. Relative time so a freshly-validated session reads
        // as "just now" rather than a precise timestamp; absolute
        // timestamp lives in the title attribute for users who want
        // the precise moment.
        const ageMs = Date.now() - lastValidated.at;
        const ageLabel =
          ageMs < 60_000
            ? 'just now'
            : ageMs < 60 * 60_000
              ? `${Math.round(ageMs / 60_000)}m ago`
              : ageMs < 24 * 60 * 60_000
                ? `${Math.round(ageMs / 3_600_000)}h ago`
                : ageMs < 30 * 24 * 60 * 60_000
                  ? `${Math.round(ageMs / 86_400_000)}d ago`
                  : new Date(lastValidated.at).toLocaleDateString();
        // Stale if we haven't checked in 7+ days — soft warning
        // hint to encourage a re-check, since Cloudflare can
        // revoke tokens silently.
        const stale = ageMs > 7 * 24 * 60 * 60_000;
        return (
          <p
            className={`cf-last-validated ot-micro${stale ? ' cf-last-validated--stale' : ''}`}
            title={`Last validated: ${new Date(lastValidated.at).toLocaleString()} · status: ${lastValidated.status}`}
          >
            <span className="cf-last-validated__glyph" aria-hidden>
              {stale ? '◐' : '✓'}
            </span>
            Last validated {ageLabel} · status:{' '}
            <code>{lastValidated.status}</code>
            {stale && ' · consider re-checking'}
          </p>
        );
      })()}
      <Field
        label="Plan"
        value={info.workersPaid ? 'Workers Paid · $5/mo' : 'Free tier'}
      />
      <Field
        label="Hostname"
        value={info.customDomain ?? 'copper-onion.workers.dev'}
      />
      {info.customDomain && (
        <Field label="Custom domain" value={`${info.customDomain} · auto-renew`} />
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="ot-btn ot-btn--ghost">Rotate token</button>
        <button
          type="button"
          className="ot-btn ot-btn--ghost"
          onClick={() => {
            setTokenPanelOpen((v) => !v);
            if (tokenPanelOpen) {
              // Closing — reset the panel state so a re-open shows a
              // clean form rather than the last result.
              setTokenDraft('');
              setTokenResult(null);
            }
          }}
          title="Paste your token to verify it's still valid + has the canonical scopes"
        >
          {tokenPanelOpen ? 'Close' : 'Validate token…'}
        </button>
        {!info.workersPaid && (
          <a href="#/onboarding/upgrades" className="ot-btn">
            Upgrade plan →
          </a>
        )}
      </div>
      {tokenPanelOpen && (
        <div className="cf-validate" role="region" aria-label="Validate Cloudflare token">
          <p className="ot-micro cf-validate__lede">
            Paste the token from{' '}
            <code>~/.wrangler/config</code> or your password manager. We
            never store it — it gets sent to Cloudflare's
            <code>/user/tokens/verify</code> endpoint and discarded.
          </p>
          <div className="cf-validate__row">
            <input
              type="password"
              className="ot-input cf-validate__input"
              placeholder="Cloudflare API token"
              value={tokenDraft}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setTokenDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  tokenDraft.trim() &&
                  tokenResult?.kind !== 'checking'
                ) {
                  e.preventDefault();
                  void runTokenValidate();
                }
              }}
              aria-label="Cloudflare API token"
            />
            <button
              type="button"
              className="ot-btn"
              onClick={() => void runTokenValidate()}
              disabled={
                tokenResult?.kind === 'checking' || !tokenDraft.trim()
              }
            >
              {tokenResult?.kind === 'checking' ? 'Checking…' : 'Check'}
            </button>
          </div>
          {tokenResult?.kind === 'ok' && (
            <p className="cf-validate__verdict cf-validate__verdict--ok">
              ✓ Valid · status: <code>{tokenResult.status}</code>
            </p>
          )}
          {tokenResult?.kind === 'err' && (
            <p className="cf-validate__verdict cf-validate__verdict--err">
              ✗ <code>{tokenResult.error}</code> — token may be revoked,
              expired, or missing scopes. Try{' '}
              <a href="#/onboarding/token">rotating the token</a>.
            </p>
          )}
        </div>
      )}
      <AiBindingPing
        aiBound={bindings.some((b) => b.name === 'AI' && b.bound)}
      />
      {bindings.length > 0 && (
        <div className="cf-bindings">
          <h4 className="cf-bindings__title">Live bindings</h4>
          <p className="ot-micro">
            What the worker actually has access to right now. Bound = present in
            the worker's <code>env</code>; optional bindings need the lines in
            <code>wrangler.toml</code> uncommented + provisioned.
          </p>
          <ul className="cf-bindings__list">
            {bindings.map((b) => (
              <li
                key={b.name}
                className={`cf-binding cf-binding--${b.bound ? 'on' : 'off'}`}
              >
                <span className={`cf-binding__kind cf-binding__kind--${b.kind}`}>
                  {b.kind}
                </span>
                <span className="cf-binding__label">{b.label}</span>
                <code className="cf-binding__name">{b.name}</code>
                <span className="cf-binding__status">
                  {b.bound ? 'bound' : 'optional'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SettingsPane>
  );
}

// Live ping for the Workers AI binding. Hits the new POST
// /api/cf-bindings/ping-ai endpoint which runs a one-shot llama-3.1-8b
// call with a 3.5s timeout. Surfaces latency + a tiny sample of the
// reply so the user has proof the binding is actually reachable + how
// quickly it answers right now.
function AiBindingPing({ aiBound }: { aiBound: boolean }) {
  const [result, setResult] = useState<
    | { ok: true; latencyMs: number; sample: string }
    | { ok: false; latencyMs: number; error: string }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const ping = async () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/cf-bindings/ping-ai', { method: 'POST' });
      const data = (await res.json()) as
        | { ok: true; latencyMs: number; sample: string }
        | { ok: false; latencyMs: number; error: string };
      setResult(data);
    } catch {
      setResult({ ok: false, latencyMs: 0, error: 'network' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ai-ping">
      <div className="ai-ping__head">
        <h4>Workers AI · live ping</h4>
        <button
          type="button"
          className="ot-btn ot-btn--ghost"
          onClick={() => void ping()}
          disabled={busy || !aiBound}
          title={
            aiBound
              ? 'Fire a one-shot llama-3.1-8b call and time the round-trip'
              : 'AI binding not present in this worker'
          }
        >
          {busy ? 'Pinging…' : '↻ Ping'}
        </button>
      </div>
      <p className="ot-micro">
        Reaches the actual <code>@cf/meta/llama-3.1-8b-instruct</code> model
        with a 3.5s timeout. Confirms the binding is healthy and surfaces a
        rough round-trip latency.
      </p>
      {result && (
        <div
          className={`ai-ping__result ai-ping__result--${result.ok ? 'ok' : 'err'}`}
          role="status"
        >
          <span className="ai-ping__result-glyph" aria-hidden>
            {result.ok ? '✓' : '⊘'}
          </span>
          <div className="ai-ping__result-body">
            {result.ok ? (
              <>
                <strong>{result.latencyMs} ms</strong>
                <span className="ot-micro">reply: "{result.sample}"</span>
              </>
            ) : (
              <>
                <strong>
                  {result.error === 'timeout'
                    ? 'Model timed out (>3.5s)'
                    : result.error === 'auth_expired'
                      ? 'Local wrangler OAuth token expired'
                      : result.error === 'binding_unbound'
                        ? 'AI binding missing from env'
                        : 'Workers AI unreachable'}
                </strong>
                {result.latencyMs > 0 && (
                  <span className="ot-micro">{result.latencyMs} ms before failure</span>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Access({ email, agentName }: { email: string; agentName: string }) {
  interface AccessState {
    agentName: string;
    hostname: string;
    appId?: string;
    policyId?: string;
    allowedEmails: string[];
    provisionedAt?: number;
    source: 'cf' | 'stub' | 'pending';
    lastError?: string;
  }
  const [state, setState] = useState<AccessState | null>(null);
  const [draftEmail, setDraftEmail] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pendingSync, setPendingSync] = useState(false);

  useEffect(() => {
    void fetch(`/api/access/${encodeURIComponent(agentName || 'default')}/status`)
      .then((r) => r.json())
      .then((data: AccessState) => setState(data))
      .catch(() => undefined);
  }, [agentName]);

  const provisioned = state?.source === 'cf';
  const emails = state?.allowedEmails && state.allowedEmails.length > 0 ? state.allowedEmails : [email];

  // RFC 5322 is overkill — the worker re-validates with z.string().email()
  // server-side. This client check just prevents an obvious malformed
  // submission and gives the user a clearer error than the network call.
  const isPlausibleEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

  const addEmail = async () => {
    const candidate = draftEmail.trim().toLowerCase();
    if (!candidate) return;
    if (!isPlausibleEmail(candidate)) {
      setDraftError('That doesn’t look like an email — check the @ and the dot.');
      return;
    }
    if (emails.some((e) => e.toLowerCase() === candidate)) {
      setDraftError('Already on the list.');
      return;
    }
    setAdding(true);
    setDraftError(null);
    try {
      const res = await fetch(
        `/api/access/${encodeURIComponent(agentName || 'default')}/emails`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: candidate }),
        },
      );
      const data = (await res.json()) as {
        ok: boolean;
        state?: AccessState;
        pendingSync?: boolean;
      };
      if (data.ok && data.state) {
        setState(data.state);
        setDraftEmail('');
        setPendingSync(!!data.pendingSync);
        showToast('Email added', 'ok');
      } else {
        setDraftError('Server rejected the email. Try again.');
      }
    } catch {
      setDraftError('Network error — try again.');
    } finally {
      setAdding(false);
    }
  };

  const removeEmail = async (addr: string) => {
    if (addr === email) {
      // Don't let the user delete the owner row — they'd lock themselves
      // out on the next provision.
      setDraftError('Can’t remove the owner email.');
      return;
    }
    if (!window.confirm(`Remove ${addr} from the allow-list?`)) return;
    try {
      const res = await fetch(
        `/api/access/${encodeURIComponent(agentName || 'default')}/emails/${encodeURIComponent(addr)}`,
        { method: 'DELETE' },
      );
      const data = (await res.json()) as { ok: boolean; state?: AccessState; pendingSync?: boolean };
      if (data.ok && data.state) {
        setState(data.state);
        setPendingSync(!!data.pendingSync);
        showToast('Email removed', 'ok');
      }
    } catch {
      showToast('Remove failed', 'err');
    }
  };

  return (
    <SettingsPane title="Access" lede="Who can talk to this agent.">
      <Field
        label="Method"
        value={provisioned ? 'Cloudflare Access · OTP' : 'Cloudflare Access · pending'}
      />
      {state?.hostname && <Field label="Hostname" value={state.hostname} />}
      {state?.appId && <Field label="Access app" value={`acct/access/apps/${state.appId.slice(0, 8)}…`} />}
      {state?.policyId && <Field label="Policy" value={`policy ${state.policyId.slice(0, 8)}…`} />}
      <h4>Allowed emails</h4>
      <ul className="settings__access-list">
        {emails.map((addr, i) => (
          <li key={addr}>
            <span>{addr}</span>
            <span className={`ot-pill${i === 0 ? '' : ' ot-pill--muted'}`}>
              {i === 0 ? 'owner' : 'invited'}
            </span>
            {i > 0 && (
              <button
                type="button"
                className="settings__access-remove"
                onClick={() => void removeEmail(addr)}
                aria-label={`Remove ${addr}`}
                title="Remove"
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="settings__access-add">
        <input
          className={`ot-input${draftError ? ' ot-input--err' : ''}`}
          placeholder="add email…"
          value={draftEmail}
          onChange={(e) => {
            setDraftEmail(e.target.value);
            if (draftError) setDraftError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !adding) {
              e.preventDefault();
              void addEmail();
            }
          }}
          aria-invalid={!!draftError}
          aria-describedby={draftError ? 'access-add-err' : undefined}
        />
        <button
          type="button"
          className="ot-btn"
          onClick={() => void addEmail()}
          disabled={adding || !draftEmail.trim()}
        >
          {adding ? 'Adding…' : 'Add'}
        </button>
      </div>
      {draftError && (
        <p id="access-add-err" className="ot-micro settings__access-err">
          {draftError}
        </p>
      )}
      {pendingSync && (
        <p className="ot-micro settings__access-pending">
          ↻ Change saved locally — redeploy (or hit `/api/access/provision`
          with your CF token) to push the new allow-list to Cloudflare
          Access.
        </p>
      )}
      {state?.lastError && (
        <p className="ot-micro" style={{ color: 'var(--ot-bad, #c84439)' }}>
          Last provisioning attempt: {state.lastError}
        </p>
      )}
    </SettingsPane>
  );
}

function SkillsTab() {
  return (
    <SettingsPane title="Skills" lede="Manage packs and per-skill behavior.">
      <p>
        See the dedicated <a href="#/skills">Skills page</a> for toggles, when-to-use
        descriptions, and pack management.
      </p>
    </SettingsPane>
  );
}

function Sync() {
  return (
    <SettingsPane title="Sync" lede="Pull upstream changes, contribute back.">
      <SyncPanel />
    </SettingsPane>
  );
}

interface AuditEntry {
  id: string;
  kind: string;
  payload: unknown;
  createdAt: number;
  /** `__system__` for cross-agent danger rows; the agent's id otherwise. */
  agentId?: string;
}

// Export the currently-rendered audit entries as JSON Lines (one JSON
// object per line, suitable for `jq` / Splunk / S3 Athena ingestion).
// Counterpart to the existing CSV export — same `entries`-as-snapshot
// rule so filters carry through. Distinct route from CSV because
// downstream tools either want delimited or structured, not both.
function downloadAuditJsonl(agentName: string, entries: AuditEntry[]): void {
  if (entries.length === 0) return;
  const lines = entries.map((e) =>
    JSON.stringify({
      id: e.id,
      kind: e.kind,
      timestampMs: e.createdAt,
      timestampIso: new Date(e.createdAt).toISOString(),
      agentId: e.agentId ?? '',
      payload: e.payload ?? {},
    }),
  );
  const blob = new Blob([lines.join('\n')], {
    type: 'application/x-ndjson;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `audit-${agentName || 'agent'}-${stamp}.jsonl`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
  showToast(`Exported ${entries.length} row${entries.length === 1 ? '' : 's'} as JSONL`, 'ok');
}

function Audit({ agentName }: { agentName: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // Audit kind filter is multi-select: empty Set = "all kinds". Each
  // chip click toggles its kind into the set. `params.kind` on the
  // wire is comma-separated for >1 kinds, single value for one.
  const [filterKinds, setFilterKinds] = useState<Set<string>>(new Set());
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [searchQ, setSearchQ] = useState<string>('');
  // Whether to surface `__system__`-tagged audit rows (danger /
  // bulk-restore / agent-delete events that aren't scoped to this
  // agent_id). Default ON because the danger trail matters; persisted
  // so a user who scopes strictly to their agent doesn't get re-shown
  // system rows every reload.
  const [includeSystem, setIncludeSystem] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('openthink:audit-includeSystem') !== '0';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      'openthink:audit-includeSystem',
      includeSystem ? '1' : '0',
    );
  }, [includeSystem]);
  // Broadcast the active-filter count to the Settings parent so the
  // tab nav can render a small badge when filters are in effect. The
  // parent keeps the count alive across tab unmount/remount so a
  // user who switches away then back sees the same badge.
  useEffect(() => {
    let count = filterKinds.size;
    if (fromDate) count += 1;
    if (toDate) count += 1;
    if (searchQ.trim()) count += 1;
    window.dispatchEvent(
      new CustomEvent('openthink:settings-filter-count', {
        detail: { tab: 'audit', count },
      }),
    );
  }, [filterKinds, fromDate, toDate, searchQ]);
  // Listen for the badge-click clear request from the Settings nav.
  // Lets the user reset every filter on this tab without having to
  // navigate into the tab first.
  useEffect(() => {
    const onClear = (e: Event) => {
      const detail = (e as CustomEvent<{ tab: SettingsTab }>).detail;
      if (detail?.tab !== 'audit') return;
      setFilterKinds(new Set());
      setFromDate('');
      setToDate('');
      setSearchQ('');
    };
    window.addEventListener('openthink:settings-clear-filters', onClear);
    return () =>
      window.removeEventListener('openthink:settings-clear-filters', onClear);
  }, []);
  const [source, setSource] = useState<'d1' | 'stub'>('stub');
  const [hasMore, setHasMore] = useState(false);
  const [oldest, setOldest] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Track which rows the user has expanded. Default-collapsed because a
  // payload can be hundreds of lines and we want the list to scan well.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Deep-link support: `?tab=audit&id=<id>` auto-expands the row on
    // first mount. We seed the Set here so the row is open even before
    // the network round-trip; the scroll/highlight happens in an effect
    // below once the entries land.
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    const id = params.get('id');
    return new Set(id ? [id] : []);
  });
  // Pinned rows float to the top of the rendered list regardless of
  // sort order. Persisted across reloads so a user investigating a
  // specific tool_call doesn't lose their pins when they refresh.
  // localStorage is the right home — server-side per-row pinning is
  // out of scope for v1.
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem('openthink:audit-pinned');
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (pinnedIds.size === 0) {
      window.localStorage.removeItem('openthink:audit-pinned');
    } else {
      window.localStorage.setItem(
        'openthink:audit-pinned',
        JSON.stringify([...pinnedIds]),
      );
    }
  }, [pinnedIds]);
  const togglePin = (id: string) => {
    let wasPinned = false;
    setPinnedIds((prev) => {
      wasPinned = prev.has(id);
      const next = new Set(prev);
      if (wasPinned) next.delete(id);
      else next.add(id);
      return next;
    });
    // Quiet toast so the user gets confirmation that the pin toggled
    // (the visual change on the row is subtle, especially when the
    // user is scrolling fast through a long list). Total pinned count
    // helps reinforce the "Export pinned" affordance up top.
    const newCount = wasPinned ? pinnedIds.size - 1 : pinnedIds.size + 1;
    showToast(
      wasPinned
        ? `Unpinned · ${newCount} pinned`
        : `Pinned · ${newCount} pinned${newCount === 1 ? ' (try Export pinned ↓)' : ''}`,
      'ok',
    );
  };

  // Per-row annotation notes. Stored in localStorage as a flat
  // {[entryId]: text} map so a user investigating a tool_call /
  // approval / spend row can leave themselves (or a future me) a
  // note about what happened or what to do next time. Empty/missing
  // means no note; deleting clears the entry from the map.
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem('openthink:audit-notes');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (Object.keys(notes).length === 0) {
      window.localStorage.removeItem('openthink:audit-notes');
    } else {
      window.localStorage.setItem('openthink:audit-notes', JSON.stringify(notes));
    }
  }, [notes]);
  const setNote = (id: string, text: string) =>
    setNotes((prev) => {
      const next = { ...prev };
      if (text.trim()) next[id] = text;
      else delete next[id];
      return next;
    });
  // Editing state — which row's note input is active. null = none
  // open. Separate from the value itself so we can render the
  // textarea without affecting the persisted note until commit.
  const [editingNote, setEditingNote] = useState<{ id: string; draft: string } | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Keyboard-driven row focus — drives j/k navigation and p-to-pin
  // on the currently-highlighted row. Tracks the row id rather than
  // index so a filter/sort change can drop the highlight cleanly
  // instead of pointing at a moved-around row. Starts null;
  // pressing j on a fresh list seeds it to the first row.
  const [focusedAuditId, setFocusedAuditId] = useState<string | null>(null);

  // Payload rendering mode for expanded entries — `tree` is the
  // interactive collapsible JsonTree (default), `raw` swaps in a
  // pre-formatted `JSON.stringify(value, null, 2)` block for
  // copy/paste workflows. Global rather than per-row so a user who
  // prefers one view doesn't have to flip the toggle on every row.
  // Persists to localStorage.
  const [payloadView, setPayloadView] = useState<'tree' | 'raw'>(() => {
    if (typeof window === 'undefined') return 'tree';
    const raw = window.localStorage.getItem('openthink:audit-payload-view');
    return raw === 'raw' ? 'raw' : 'tree';
  });

  // Compare-pair state — entry ids marked for side-by-side payload
  // comparison. Capped at 2; adding a third drops the oldest. When
  // exactly two are marked the user can pop the diff modal.
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // Cap at 2 — shift the oldest out so the user can keep moving
      // the comparison without an explicit clear step.
      const next = [...prev, id];
      return next.length > 2 ? next.slice(next.length - 2) : next;
    });
  };
  // Arrow-key navigation inside the compare modal. ←/→ walks the
  // RIGHT side through adjacent rows in the visible list (left
  // stays fixed as the baseline). Shift+←/→ walks the LEFT side
  // instead so the user can scan from either end. Wraps at both
  // ends. Skipped when focus is in a text input so the user can
  // still type into the modal's exportable controls if any get
  // added later.
  useEffect(() => {
    if (!compareModalOpen || compareIds.length !== 2) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (target?.isContentEditable) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const sideIdx = e.shiftKey ? 0 : 1;
      const cur = compareIds[sideIdx]!;
      const curIdx = entries.findIndex((x) => x.id === cur);
      if (curIdx < 0 || entries.length === 0) return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const nextIdx =
        (curIdx + dir + entries.length) % entries.length;
      const nextEntry = entries[nextIdx];
      if (!nextEntry) return;
      // Don't allow the two slots to collide — if the candidate is
      // the same row as the other slot, hop one more in the same
      // direction.
      const other = compareIds[1 - sideIdx];
      const candidate =
        nextEntry.id === other
          ? entries[(nextIdx + dir + entries.length) % entries.length]
          : nextEntry;
      if (!candidate || candidate.id === other) return;
      setCompareIds((prev) => {
        const out = [...prev];
        out[sideIdx] = candidate.id;
        return out;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compareModalOpen, compareIds, entries]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('openthink:audit-payload-view', payloadView);
  }, [payloadView]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Bail when the user is typing — j and k are common letters in
      // a search box, and we don't want shortcuts hijacking text
      // input. Also skip when modifier keys are held (Cmd+J / Ctrl+K
      // could be browser shortcuts we shouldn't shadow).
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Don't fire while a confirm/prompt or another dialog has
      // captured the focus — Audit shortcuts only matter when the
      // user is looking at the list.
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog && dialog.contains(target as Node)) return;
      const key = e.key;
      if (!['j', 'k', 'p', 'J', 'K', 'P', 'Enter', ' '].includes(key)) return;
      // Enter / Space only meaningful when a row is already focused —
      // otherwise we'd toggle nothing. Skip without preventDefault so
      // the user's input lands wherever they actually were typing.
      if ((key === 'Enter' || key === ' ') && !focusedAuditId) return;
      // Snapshot the current ordering (pinned first, then everything
      // else, matching the rendered order). We reach for `entries`
      // + `pinnedIds` directly via closure; both are state, so the
      // listener re-binds when either changes.
      const ordered = [
        ...entries.filter((x) => pinnedIds.has(x.id)).map((x) => x.id),
        ...entries.filter((x) => !pinnedIds.has(x.id)).map((x) => x.id),
      ];
      if (ordered.length === 0) return;
      const lowerKey = key.toLowerCase();
      e.preventDefault();
      if (lowerKey === 'j') {
        // j → next row. Wrap at the bottom so the user can ride the
        // list to its tail and keep going to the top.
        const cur = focusedAuditId ? ordered.indexOf(focusedAuditId) : -1;
        const next = ordered[(cur + 1) % ordered.length];
        if (next) {
          setFocusedAuditId(next);
          window.requestAnimationFrame(() => {
            document
              .getElementById(`audit-${next}`)
              ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          });
        }
      } else if (lowerKey === 'k') {
        const cur = focusedAuditId ? ordered.indexOf(focusedAuditId) : 0;
        const prev =
          ordered[(cur - 1 + ordered.length) % ordered.length];
        if (prev) {
          setFocusedAuditId(prev);
          window.requestAnimationFrame(() => {
            document
              .getElementById(`audit-${prev}`)
              ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          });
        }
      } else if (lowerKey === 'p' && focusedAuditId) {
        // p → toggle pin on the focused row. The togglePin helper
        // owns the toast + count update so we just delegate.
        togglePin(focusedAuditId);
      } else if ((key === 'Enter' || key === ' ') && focusedAuditId) {
        // Enter / Space → expand/collapse the focused row. Matches
        // the click-to-expand behavior on the row's button summary.
        toggleExpanded(focusedAuditId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entries, pinnedIds, focusedAuditId]);
  // Drop the focus highlight when filters narrow the list to
  // something that doesn't contain the focused row — otherwise the
  // user sees a stale highlight on a row that's no longer rendered.
  useEffect(() => {
    if (focusedAuditId && !entries.some((e) => e.id === focusedAuditId)) {
      setFocusedAuditId(null);
    }
  }, [entries, focusedAuditId]);

  // Per-kind counts respecting date / search / system-include but NOT
  // the kind filter itself. Drives the inline `(N)` tally chips on
  // each kind toolbar button so users can see "how many spend rows
  // exist in the last week" before clicking through. Re-fetched
  // whenever the non-kind base filter changes.
  const [kindCounts, setKindCounts] = useState<Record<string, number>>({});
  const countsUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (fromDate) {
      const ts = new Date(fromDate).getTime();
      if (Number.isFinite(ts)) params.set('from', String(ts));
    }
    if (toDate) {
      const d = new Date(toDate);
      d.setHours(23, 59, 59, 999);
      if (Number.isFinite(d.getTime())) params.set('to', String(d.getTime()));
    }
    if (searchQ.trim()) params.set('q', searchQ.trim());
    if (!includeSystem) params.set('includeSystem', '0');
    return `/api/audit/${encodeURIComponent(agentName || 'default')}/counts${
      params.toString() ? `?${params.toString()}` : ''
    }`;
  }, [agentName, fromDate, toDate, searchQ, includeSystem]);
  useEffect(() => {
    let cancelled = false;
    void fetch(countsUrl)
      .then((r) => r.json())
      .then((data: { counts?: Record<string, number> }) => {
        if (cancelled) return;
        setKindCounts(data.counts ?? {});
      })
      .catch(() => {
        if (!cancelled) setKindCounts({});
      });
    return () => {
      cancelled = true;
    };
  }, [countsUrl]);

  // Day histogram for the last 14 days — surfaces a small chart
  // above the kind toolbar so users can spot quiet/loud days at a
  // glance. Click a bar to scope the date filter to that single
  // day. Honors the same base filters (search / system-include)
  // but never honors the date range itself (the chart IS the date
  // navigator).
  const [dayHistogram, setDayHistogram] = useState<
    Array<{
      date: string;
      count: number;
      topKind?: string;
      topKindCount?: number;
    }>
  >([]);
  const histogramUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set('days', '14');
    if (searchQ.trim()) params.set('q', searchQ.trim());
    if (!includeSystem) params.set('includeSystem', '0');
    return `/api/audit/${encodeURIComponent(agentName || 'default')}/histogram?${params.toString()}`;
  }, [agentName, searchQ, includeSystem]);
  useEffect(() => {
    let cancelled = false;
    void fetch(histogramUrl)
      .then((r) => r.json())
      .then(
        (data: {
          buckets?: Array<{
            date: string;
            count: number;
            topKind?: string;
            topKindCount?: number;
          }>;
        }) => {
          if (cancelled) return;
          setDayHistogram(data.buckets ?? []);
        },
      )
      .catch(() => {
        if (!cancelled) setDayHistogram([]);
      });
    return () => {
      cancelled = true;
    };
  }, [histogramUrl]);

  // Build the base URL once per filter set. The cursor (`before`) gets
  // appended in the loadMore path so the first page stays cacheable.
  const baseUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (filterKinds.size > 0) {
      params.set('kind', [...filterKinds].join(','));
    }
    if (fromDate) {
      const ts = new Date(fromDate).getTime();
      if (Number.isFinite(ts)) params.set('from', String(ts));
    }
    if (toDate) {
      const d = new Date(toDate);
      d.setHours(23, 59, 59, 999);
      if (Number.isFinite(d.getTime())) params.set('to', String(d.getTime()));
    }
    if (searchQ.trim()) params.set('q', searchQ.trim());
    // Worker defaults to includeSystem ON; we only set the param
    // explicitly when the user has opted OUT so we keep the URL
    // (+ KV cache) short for the common case.
    if (!includeSystem) params.set('includeSystem', '0');
    params.set('limit', '50');
    return `/api/audit/${encodeURIComponent(agentName || 'default')}?${params.toString()}`;
  }, [agentName, filterKinds, fromDate, toDate, searchQ, includeSystem]);

  // Audit-tab open ⇒ mark danger rows as seen. The Settings shell
  // polls a separate /audit?kind=danger endpoint to source the
  // attention badge across tabs (the Audit component only mounts
  // when its tab is active, so we can't rely on it to detect new
  // danger rows in the background). When this component mounts +
  // the entries land, we advance the cursor past the newest danger
  // row so the global badge clears on the next poll.
  const newestDangerAt = entries.reduce(
    (max, e) => (e.kind === 'danger' && e.createdAt > max ? e.createdAt : max),
    0,
  );
  useEffect(() => {
    if (newestDangerAt <= 0) return;
    const t = window.setTimeout(() => {
      try {
        const cur = Number(
          window.localStorage.getItem('openthink:audit-danger-seen') ?? '0',
        );
        if (newestDangerAt > cur) {
          window.localStorage.setItem(
            'openthink:audit-danger-seen',
            String(newestDangerAt),
          );
          // Fire one cursor-bumped event so the shell's poll can
          // re-evaluate immediately — saves the user staring at a
          // stale `!` badge for ~30s after they read the page.
          window.dispatchEvent(
            new CustomEvent('openthink:audit-danger-seen-bumped'),
          );
        }
      } catch {
        /* quota — non-fatal */
      }
    }, 1500);
    return () => window.clearTimeout(t);
  }, [newestDangerAt]);

  // First page on filter change.
  useEffect(() => {
    setLoading(true);
    const t = window.setTimeout(() => {
      void fetch(baseUrl)
        .then((r) => r.json())
        .then((data: {
          entries: AuditEntry[];
          source: 'd1' | 'stub';
          hasMore?: boolean;
          oldest?: number | null;
        }) => {
          setEntries(data.entries);
          setSource(data.source);
          setHasMore(!!data.hasMore);
          setOldest(data.oldest ?? null);
        })
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 220);
    return () => window.clearTimeout(t);
  }, [baseUrl]);

  // Intersection observer for infinite scroll. Stays armed across pages —
  // earlier versions tore down + rebuilt the observer on every loadingMore
  // flip, which meant a sentinel still in the viewport after the new
  // page rendered wouldn't trigger another load until the user scrolled
  // again. Now the observer is one long-lived instance per query/cursor
  // pair, and we gate against re-firing via a ref so the loadingMore
  // state doesn't break re-arming.
  const loadingMoreRef = useRef(false);
  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);
  useEffect(() => {
    if (!hasMore || !oldest) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (loadingMoreRef.current) return; // already fetching
        loadingMoreRef.current = true;
        setLoadingMore(true);
        void fetch(`${baseUrl}&before=${oldest}`)
          .then((r) => r.json())
          .then((data: {
            entries: AuditEntry[];
            hasMore?: boolean;
            oldest?: number | null;
          }) => {
            setEntries((prev) => [...prev, ...(data.entries ?? [])]);
            setHasMore(!!data.hasMore);
            if (data.oldest != null) setOldest(data.oldest);
          })
          .finally(() => {
            loadingMoreRef.current = false;
            setLoadingMore(false);
          });
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [baseUrl, oldest, hasMore]);

  // Scroll a deep-linked entry into view once the entries list lands.
  // The expanded Set already has the id from `useState` init; this just
  // gets the user looking at the right row.
  useEffect(() => {
    if (loading || entries.length === 0) return;
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    const id = params.get('id');
    if (!id) return;
    // Defer to next frame so the DOM has settled.
    const t = window.setTimeout(() => {
      const el = document.getElementById(`audit-${id}`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('audit__entry--flash');
        window.setTimeout(() => el.classList.remove('audit__entry--flash'), 1600);
      }
    }, 80);
    return () => window.clearTimeout(t);
  }, [loading, entries.length]);

  return (
    <SettingsPane title="Audit log" lede="Every consequential action this agent has taken.">
      {compareIds.length > 0 && (() => {
        // Floating compare bar — shows the marked-for-compare set
        // count + a Compare button when both slots are filled.
        // Clearing here clears the pair entirely; toggling a chip
        // removes just that id.
        const pair = compareIds
          .map((id) => entries.find((e) => e.id === id))
          .filter((e): e is AuditEntry => !!e);
        return (
          <div className="audit__compare-bar" role="region" aria-label="Compare pair">
            <span className="ot-micro">
              {compareIds.length === 2
                ? '↔ Compare pair ready'
                : `↔ Pick ${2 - compareIds.length} more to compare`}
            </span>
            <div className="audit__compare-chips">
              {compareIds.map((id) => {
                const entry = entries.find((e) => e.id === id);
                const label = entry ? entry.kind : id.slice(0, 8);
                return (
                  <span key={id} className="audit__compare-chip-wrap">
                    {/* Label is a scroll-to-row affordance. Useful
                        when the user has set up the pair, scrolled
                        away, and wants to jump back to either side
                        in context. Auto-expand + flash-highlight
                        once the row is in view. */}
                    <button
                      type="button"
                      className="audit__compare-chip audit__compare-chip--label"
                      onClick={() => {
                        const el = document.getElementById(`audit-${id}`);
                        if (!el) return;
                        // Auto-expand the row if it isn't already
                        // (matches the deep-link behavior so the
                        // jump feels useful, not just "scrolled
                        // into view but collapsed").
                        setExpanded((prev) => {
                          if (prev.has(id)) return prev;
                          const next = new Set(prev);
                          next.add(id);
                          return next;
                        });
                        window.requestAnimationFrame(() => {
                          el.scrollIntoView({
                            block: 'center',
                            behavior: 'smooth',
                          });
                          el.classList.add('audit__entry--flash');
                          window.setTimeout(
                            () => el.classList.remove('audit__entry--flash'),
                            1600,
                          );
                        });
                      }}
                      title={`Scroll to and highlight this ${entry ? entry.kind : 'entry'} row`}
                    >
                      {label}
                    </button>
                    {/* Separate × button for removal — keeps the
                        two gestures (jump vs. drop) on distinct
                        click targets so the user doesn't lose
                        their pair while trying to navigate. */}
                    <button
                      type="button"
                      className="audit__compare-chip audit__compare-chip--remove"
                      onClick={() => toggleCompare(id)}
                      title={`Remove ${entry ? entry.kind : 'this entry'} from the pair`}
                      aria-label={`Remove ${label} from compare pair`}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
            {pair.length === 2 && (
              <button
                type="button"
                className="ot-btn audit__compare-open"
                onClick={() => setCompareModalOpen(true)}
              >
                Compare ↔
              </button>
            )}
            <button
              type="button"
              className="audit__compare-clear ot-micro"
              onClick={() => setCompareIds([])}
              title="Clear the comparison pair"
            >
              clear
            </button>
          </div>
        );
      })()}
      {compareModalOpen && compareIds.length === 2 && (() => {
        // Two-column side-by-side payload diff. Renders each entry's
        // pretty-printed JSON in its own pre block; line-level diff
        // tints unchanged lines neutral, changed lines pick up
        // add/del coloring. Same BigInt/Symbol-safe stringify the
        // copy buttons use. Esc closes; clicking the backdrop
        // closes; a × in the header closes.
        const leftEntry = entries.find((e) => e.id === compareIds[0]);
        const rightEntry = entries.find((e) => e.id === compareIds[1]);
        if (!leftEntry || !rightEntry) {
          setCompareModalOpen(false);
          return null;
        }
        const stringify = (v: unknown): string => {
          try {
            return JSON.stringify(
              v,
              (_k, x) => {
                if (typeof x === 'bigint') return `${x.toString()}n`;
                if (typeof x === 'symbol') return x.toString();
                return x;
              },
              2,
            );
          } catch {
            return '(unable to stringify)';
          }
        };
        const leftText = stringify(leftEntry.payload);
        const rightText = stringify(rightEntry.payload);
        const leftLines = leftText.split('\n');
        const rightLines = rightText.split('\n');
        // Line-level diff via a per-side `kind` array. Walk both
        // sides via simple LCS (line text equality); unmatched
        // lines surface as 'del' on the left side and 'add' on
        // the right side. We keep the rendering layout fixed
        // (one row per source line) rather than zipping — the
        // user reads top-to-bottom on each side and lines that
        // changed get the row tinted on whichever side has them.
        return (
          <div
            className="audit__compare-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Compare audit payloads"
            onClick={(e) => {
              if (e.target === e.currentTarget) setCompareModalOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setCompareModalOpen(false);
            }}
          >
            {(() => {
              // Compute the divergence ratio: fraction of total
              // lines (across both sides) that don't appear in the
              // other side's set. High divergence (>50%) signals
              // these two rows don't share much structure — useful
              // when comparing across kinds, or when the payload
              // shape really does vary call-to-call. Surfaces as a
              // hint at the top of the modal so the user knows
              // whether the diff is "two flavors of the same thing"
              // or "wholly different events".
              const leftSet = new Set(leftLines);
              const rightSet = new Set(rightLines);
              const leftDiffer = leftLines.filter((l) => !rightSet.has(l)).length;
              const rightDiffer = rightLines.filter((l) => !leftSet.has(l)).length;
              const totalLines = leftLines.length + rightLines.length;
              const divergencePct =
                totalLines > 0
                  ? Math.round(((leftDiffer + rightDiffer) / totalLines) * 100)
                  : 0;
              const sameKind = leftEntry.kind === rightEntry.kind;
              let hint: { tone: 'ok' | 'warn' | 'high'; text: string } | null = null;
              if (divergencePct === 0 && leftLines.length > 0) {
                hint = { tone: 'ok', text: 'Identical payloads — nothing to diff.' };
              } else if (divergencePct < 25) {
                hint = {
                  tone: 'ok',
                  text: `${divergencePct}% divergent — minor variations between the two rows.`,
                };
              } else if (divergencePct < 50) {
                hint = {
                  tone: 'warn',
                  text: `${divergencePct}% divergent — structurally similar but meaningfully different.`,
                };
              } else {
                hint = {
                  tone: 'high',
                  text: sameKind
                    ? `${divergencePct}% divergent — this kind's payload shape varies call-to-call.`
                    : `${divergencePct}% divergent — different kinds (${leftEntry.kind} vs ${rightEntry.kind}) rarely share much structure.`,
                };
              }
              return (
            <div className="audit__compare-modal-inner">
              <header className="audit__compare-modal-head">
                <h3>Compare payloads</h3>
                <span className="ot-micro">
                  Line-level diff · matching lines neutral, changed lines tinted
                  <span className="audit__compare-modal-keys" title="Arrow keys walk the right side; Shift+arrow walks the left side">
                    {' '}· <kbd>←</kbd><kbd>→</kbd> shift right · <kbd>⇧</kbd>+arrow shifts left
                  </span>
                </span>
                {/* Pair-export button — bundles both rows into a
                    single JSON envelope keyed `left` + `right` so
                    the user can paste a self-contained comparison
                    into a bug report. Same BigInt/Symbol-safe
                    stringify as the per-row copy buttons. */}
                <button
                  type="button"
                  className="audit__compare-modal-export"
                  onClick={async () => {
                    const stringifyPair = (v: unknown): string => {
                      try {
                        return JSON.stringify(
                          v,
                          (_k, x) => {
                            if (typeof x === 'bigint') return `${x.toString()}n`;
                            if (typeof x === 'symbol') return x.toString();
                            return x;
                          },
                          2,
                        );
                      } catch {
                        return '(unable to stringify)';
                      }
                    };
                    const envelope = {
                      kind: 'audit-compare@1',
                      exportedAt: Date.now(),
                      exportedAtIso: new Date().toISOString(),
                      divergencePct,
                      left: {
                        id: leftEntry.id,
                        kind: leftEntry.kind,
                        createdAt: leftEntry.createdAt,
                        createdAtIso: new Date(leftEntry.createdAt).toISOString(),
                        agentId: leftEntry.agentId,
                        payload: leftEntry.payload,
                      },
                      right: {
                        id: rightEntry.id,
                        kind: rightEntry.kind,
                        createdAt: rightEntry.createdAt,
                        createdAtIso: new Date(rightEntry.createdAt).toISOString(),
                        agentId: rightEntry.agentId,
                        payload: rightEntry.payload,
                      },
                    };
                    try {
                      await navigator.clipboard.writeText(stringifyPair(envelope));
                      showToast('Compare pair copied as envelope', 'ok');
                    } catch {
                      showToast('Copy failed', 'err');
                    }
                  }}
                  title="Copy both payloads as a single JSON envelope for bug reports"
                >
                  ⧉ Copy pair
                </button>
                <button
                  type="button"
                  className="audit__compare-modal-close"
                  onClick={() => setCompareModalOpen(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              </header>
              {hint && (
                <div
                  className={`audit__compare-hint audit__compare-hint--${hint.tone}`}
                  role="status"
                >
                  <span className="audit__compare-hint-glyph" aria-hidden>
                    {hint.tone === 'ok'
                      ? '✓'
                      : hint.tone === 'warn'
                        ? '◐'
                        : '⚠'}
                  </span>
                  {hint.text}
                </div>
              )}
              <div className="audit__compare-cols">
                {[
                  { label: 'left', entry: leftEntry, lines: leftLines, otherLines: rightLines },
                  { label: 'right', entry: rightEntry, lines: rightLines, otherLines: leftLines },
                ].map(({ label, entry, lines, otherLines }) => {
                  const otherSet = new Set(otherLines);
                  return (
                    <div key={label} className="audit__compare-col">
                      <div className="audit__compare-col-head ot-micro">
                        <code>{entry.kind}</code> · {auditRelTime(entry.createdAt)}{' '}
                        · <code>{entry.id.slice(0, 8)}</code>
                      </div>
                      <pre className="audit__compare-col-body">
                        {lines.map((line, i) => {
                          // A line is "changed" if it doesn't appear
                          // in the other side's set. We don't try to
                          // do a true LCS — for payload comparison
                          // the diff is usually small enough that
                          // set-membership reads well.
                          const same = otherSet.has(line);
                          return (
                            <span
                              key={i}
                              className={`audit__compare-line${same ? '' : ` audit__compare-line--${label === 'left' ? 'del' : 'add'}`}`}
                            >
                              {line + '\n'}
                            </span>
                          );
                        })}
                      </pre>
                    </div>
                  );
                })}
              </div>
            </div>
              );
            })()}
          </div>
        );
      })()}
      {dayHistogram.length > 0 && (() => {
        // Inline 14-bar histogram of audit entries per day. Click
        // a bar to scope the date filter to that single day. Bars
        // normalize to the max of the displayed window so quiet
        // days don't disappear visually. Empty windows (all zeros)
        // skip the render — nothing useful to show.
        const max = Math.max(...dayHistogram.map((b) => b.count));
        if (max === 0) return null;
        return (
          <div
            className="audit__histogram"
            role="img"
            aria-label={`Audit volume per day — last ${dayHistogram.length} days`}
          >
            {dayHistogram.map((bucket) => {
              const heightPct = (bucket.count / max) * 100;
              const isActive =
                fromDate === bucket.date && toDate === bucket.date;
              // Format the day label for the tooltip. Today / yesterday
              // get human labels; older days drop the year inside
              // current-year and add it for prior years.
              const labelDate = new Date(`${bucket.date}T00:00:00`);
              const today = new Date();
              const yesterday = new Date(today);
              yesterday.setDate(today.getDate() - 1);
              const sameDay = (a: Date, b: Date) =>
                a.getFullYear() === b.getFullYear() &&
                a.getMonth() === b.getMonth() &&
                a.getDate() === b.getDate();
              const dateLabel = sameDay(today, labelDate)
                ? 'Today'
                : sameDay(yesterday, labelDate)
                  ? 'Yesterday'
                  : labelDate.toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    });
              // Weekday rhythm — 1-letter glyph below the bar
              // (S M T W T F S) so the user can read the week's
              // pattern at a glance. Weekend gets a `--weekend`
              // modifier for a softer tint; today gets a stronger
              // accent so it pops out of the 14-bar strip.
              const dow = labelDate.getDay(); // 0=Sun, 6=Sat
              const dowGlyph = ['S', 'M', 'T', 'W', 'T', 'F', 'S'][dow]!;
              const dowFull = [
                'Sunday',
                'Monday',
                'Tuesday',
                'Wednesday',
                'Thursday',
                'Friday',
                'Saturday',
              ][dow]!;
              const isWeekend = dow === 0 || dow === 6;
              const isToday = sameDay(today, labelDate);
              return (
                <button
                  key={bucket.date}
                  type="button"
                  className={`audit__histogram-bar${isActive ? ' audit__histogram-bar--active' : ''}${bucket.count === 0 ? ' audit__histogram-bar--empty' : ''}${isWeekend ? ' audit__histogram-bar--weekend' : ''}${isToday ? ' audit__histogram-bar--today' : ''}`}
                  onClick={() => {
                    // Clicking the active day a second time clears
                    // the date scope — round-trip toggle.
                    if (isActive) {
                      setFromDate('');
                      setToDate('');
                    } else {
                      setFromDate(bucket.date);
                      setToDate(bucket.date);
                    }
                  }}
                  title={(() => {
                    // Tooltip rolls up: weekday + date + total +
                    // top-kind annotation when one exists. The
                    // top-kind share helps the user spot "yesterday
                    // was 80% spend rows" at a glance.
                    const base = `${dowFull} · ${dateLabel} · ${bucket.count} entr${bucket.count === 1 ? 'y' : 'ies'}`;
                    if (
                      bucket.topKind &&
                      typeof bucket.topKindCount === 'number' &&
                      bucket.count > 0
                    ) {
                      const share = Math.round(
                        (bucket.topKindCount / bucket.count) * 100,
                      );
                      return `${base} · top: ${bucket.topKind.replace('_', ' ')} (${bucket.topKindCount}/${bucket.count} · ${share}%)`;
                    }
                    return base;
                  })()}
                  aria-label={`${dowFull} ${dateLabel}: ${bucket.count} entries${bucket.topKind ? `, top kind ${bucket.topKind.replace('_', ' ')}` : ''}${isActive ? ' (active filter — click to clear)' : ' (click to filter)'}`}
                >
                  <span
                    className="audit__histogram-bar-fill"
                    style={{ height: `${Math.max(4, heightPct)}%` }}
                  />
                  <span className="audit__histogram-bar-count ot-micro">
                    {bucket.count}
                  </span>
                  <span
                    className="audit__histogram-bar-day ot-micro"
                    aria-hidden
                  >
                    {dowGlyph}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })()}
      {filterKinds.size > 1 && (() => {
        // "Filtered by N kinds" summary chip — surfaces only when
        // the user has picked ≥2 kinds, since a single-kind filter
        // is already obvious from the active chip's accent fill.
        // Click clears the kind filter entirely; the chip's title
        // attribute lists which kinds are currently active.
        const activeKinds = [...filterKinds].sort();
        return (
          <div className="audit__kind-summary" role="status">
            <span className="audit__kind-summary-glyph" aria-hidden>
              ⌕
            </span>
            <span>
              Filtered by {activeKinds.length} kinds:{' '}
              <code>{activeKinds.join(', ').replace(/_/g, ' ')}</code>
            </span>
            <button
              type="button"
              className="audit__kind-summary-clear"
              onClick={() => setFilterKinds(new Set())}
              title="Clear the kind filter — show every kind again"
            >
              clear
            </button>
          </div>
        );
      })()}
      <div className="settings__template-row">
        {(['all', 'tool_call', 'approval', 'spend', 'sync', 'pr_back', 'skill_save', 'provision', 'danger'] as const).map((k) => {
          const isAll = k === 'all';
          const active = isAll ? filterKinds.size === 0 : filterKinds.has(k);
          // Per-kind tally drawn from the counts endpoint (date /
          // search / system-include filters applied; kind filter
          // explicitly excluded so the chip always shows what
          // clicking would land). "all" sums every kind into one
          // total. Zero-count chips render a muted "0" so the user
          // still knows the filter is in the empty cohort rather
          // than missing data.
          const allTotal = Object.values(kindCounts).reduce(
            (s, n) => s + n,
            0,
          );
          const count = isAll ? allTotal : (kindCounts[k] ?? 0);
          return (
            <button
              key={k}
              type="button"
              className={`settings__template${active ? ' settings__template--active' : ''}${
                count === 0 && !active ? ' settings__template--empty' : ''
              }`}
              onClick={() => {
                if (isAll) {
                  // "all" chip clears the entire set.
                  setFilterKinds(new Set());
                  return;
                }
                setFilterKinds((prev) => {
                  const next = new Set(prev);
                  if (next.has(k)) next.delete(k);
                  else next.add(k);
                  return next;
                });
              }}
              title={
                isAll
                  ? `Clear kind filter (${allTotal} total)`
                  : `${count} ${k.replace('_', ' ')} row${count === 1 ? '' : 's'} in the current window`
              }
            >
              {k.replace('_', ' ')}
              <span className="audit__kind-count">{count}</span>
            </button>
          );
        })}
      </div>
      <div className="audit__filters">
        <label className="audit__filter">
          <span className="ot-label">From</span>
          <input
            type="date"
            className="ot-input"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="audit__filter">
          <span className="ot-label">To</span>
          <input
            type="date"
            className="ot-input"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        <label className="audit__filter audit__filter--search">
          <span className="ot-label">Search payload</span>
          <input
            type="search"
            className="ot-input"
            placeholder="researcher.research, spend_cap, etc."
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
        </label>
        {/* Cross-agent toggle — by default we OR in __system__-tagged
            rows so wipe / bulk-restore events surface here even though
            they aren't tied to a single agent_id. Power users who only
            care about this agent's activity can flip the toggle off; we
            persist the preference per-browser so they don't have to
            re-set it on every visit. */}
        <div className="audit__filter audit__filter--toggle">
          <span className="ot-label">Scope</span>
          <button
            type="button"
            className={`audit__system-toggle ${
              includeSystem ? 'audit__system-toggle--on' : ''
            }`}
            onClick={() => setIncludeSystem((v) => !v)}
            role="switch"
            aria-checked={includeSystem}
            title={
              includeSystem
                ? 'Showing system events (wipes, bulk restores). Click to scope to this agent only.'
                : 'Scoped to this agent only. Click to include system-wide events (wipes, bulk restores).'
            }
          >
            <span className="audit__system-toggle-track" aria-hidden>
              <span className="audit__system-toggle-knob" />
            </span>
            <span className="audit__system-toggle-label">
              {includeSystem ? 'Include system' : 'This agent only'}
            </span>
          </button>
        </div>
      </div>
      {(filterKinds.size > 0 || fromDate || toDate || searchQ) && (() => {
        // Build a human-readable summary of every active filter so the
        // user can see why the list might look short. Each piece is a
        // chip with its own clear button; the trailing "× Clear all"
        // resets everything (including the kind filter, which the date
        // / search Clear button above didn't touch).
        const chips: Array<{ key: string; label: string; clear: () => void }> = [];
        for (const kind of filterKinds) {
          chips.push({
            key: `kind:${kind}`,
            label: `kind: ${kind.replace('_', ' ')}`,
            clear: () =>
              setFilterKinds((prev) => {
                const next = new Set(prev);
                next.delete(kind);
                return next;
              }),
          });
        }
        if (fromDate) {
          chips.push({
            key: 'from',
            label: `since ${fromDate}`,
            clear: () => setFromDate(''),
          });
        }
        if (toDate) {
          chips.push({
            key: 'to',
            label: `until ${toDate}`,
            clear: () => setToDate(''),
          });
        }
        if (searchQ.trim()) {
          chips.push({
            key: 'search',
            label: `"${searchQ.trim()}"`,
            clear: () => setSearchQ(''),
          });
        }
        return (
          <div className="audit__active-filters" role="status">
            <span className="ot-micro audit__active-filters-label">
              Filters active · {entries.length} match{entries.length === 1 ? '' : 'es'}
            </span>
            <div className="audit__active-filters-chips">
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className="audit__active-filter-chip"
                  onClick={c.clear}
                  title={`Clear ${c.key}`}
                >
                  {c.label}
                  <span aria-hidden>×</span>
                </button>
              ))}
              <button
                type="button"
                className="audit__active-filters-clear"
                onClick={() => {
                  setFilterKinds(new Set());
                  setFromDate('');
                  setToDate('');
                  setSearchQ('');
                }}
              >
                × Clear all
              </button>
            </div>
          </div>
        );
      })()}
      {source === 'stub' && (
        <p className="ot-micro">Showing sample entries — your D1 audit_log is empty.</p>
      )}
      {!loading && entries.length > 0 && (() => {
        // 24-bucket hourly density strip — counts entries per past
        // hour, slot 23 = most recent. Lets the user see at a glance
        // when this agent was busy (or quiet) over the last day. Empty
        // slots render as a faint baseline so the strip stays
        // rectangular and readable; non-empty bars scale to the slot
        // with the most activity.
        const buckets = new Array<number>(24).fill(0);
        const now = Date.now();
        for (const e of entries) {
          const ageHours = Math.floor((now - e.createdAt) / 3_600_000);
          const slot = Math.max(0, Math.min(23, 23 - ageHours));
          buckets[slot] = (buckets[slot] ?? 0) + 1;
        }
        const peak = Math.max(1, ...buckets);
        const hourLabel = (slotIdx: number): string => {
          const d = new Date(now - (23 - slotIdx) * 3_600_000);
          return d.toLocaleTimeString(undefined, {
            hour: 'numeric',
            hour12: true,
          });
        };
        return (
          <div
            className="audit__density"
            role="img"
            aria-label="Hourly entry density over the last 24 hours"
          >
            {buckets.map((count, i) => (
              <span
                key={i}
                className={`audit__density-bar${count > 0 ? '' : ' audit__density-bar--empty'}`}
                style={{ height: `${count > 0 ? Math.max(8, (count / peak) * 100) : 4}%` }}
                title={`${hourLabel(i)} · ${count} entr${count === 1 ? 'y' : 'ies'}`}
              />
            ))}
          </div>
        );
      })()}
      {!loading && entries.length > 0 && (
        <div className="audit__bulk">
          <span className="ot-micro">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
            {expanded.size > 0 && ` · ${expanded.size} expanded`}
            <span
              className="audit__bulk-hint"
              title="Keyboard: j next · k previous · p pin focused · Enter expand"
            >
              {' '}· <kbd>j</kbd><kbd>k</kbd> nav · <kbd>p</kbd> pin
            </span>
          </span>
          <div className="audit__bulk-actions">
            <button
              type="button"
              className="audit__bulk-btn"
              onClick={() => setExpanded(new Set(entries.map((e) => e.id)))}
              disabled={expanded.size === entries.length}
            >
              Expand all
            </button>
            <button
              type="button"
              className="audit__bulk-btn"
              onClick={() => setExpanded(new Set())}
              disabled={expanded.size === 0}
            >
              Collapse all
            </button>
            {/* Payload view toggle — flips every expanded entry's
                payload between the collapsible JsonTree (default,
                inspect-friendly) and a raw pre-formatted JSON
                block (copy/paste-friendly for bug reports). Global
                rather than per-row so the user picks once and
                sticks. Active mode visually distinct from the
                inactive sibling. */}
            <div className="audit__bulk-view" role="radiogroup" aria-label="Payload view">
              <button
                type="button"
                role="radio"
                aria-checked={payloadView === 'tree'}
                className={`audit__bulk-btn${payloadView === 'tree' ? ' audit__bulk-btn--active' : ''}`}
                onClick={() => setPayloadView('tree')}
                title="Interactive collapsible payload tree (default)"
              >
                tree
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={payloadView === 'raw'}
                className={`audit__bulk-btn${payloadView === 'raw' ? ' audit__bulk-btn--active' : ''}`}
                onClick={() => setPayloadView('raw')}
                title="Raw pretty-printed JSON (copy/paste-friendly)"
              >
                raw
              </button>
            </div>
            <button
              type="button"
              className="audit__bulk-btn"
              onClick={() => downloadAuditCsv(agentName, entries)}
              title="Download visible entries as CSV"
            >
              Export CSV ↓
            </button>
            <button
              type="button"
              className="audit__bulk-btn"
              onClick={() => downloadAuditJsonl(agentName, entries)}
              title="Download visible entries as JSON Lines (one row per line)"
            >
              Export JSONL ↓
            </button>
            {/* Bulk-pin every visible entry. Reads as "pin everything
                that survived my current kind/date/search filters" so
                a user triaging a specific category can flip the whole
                cohort in one click. Already-pinned rows in the
                visible set don't re-pin (we just no-op them). */}
            {(() => {
              const unpinnedVisible = entries.filter(
                (e) => !pinnedIds.has(e.id),
              );
              if (unpinnedVisible.length === 0) return null;
              const filterLabel =
                filterKinds.size === 1
                  ? [...filterKinds][0]!.replace('_', ' ')
                  : null;
              return (
                <button
                  type="button"
                  className="audit__bulk-btn"
                  onClick={() => {
                    setPinnedIds((prev) => {
                      const next = new Set(prev);
                      for (const e of unpinnedVisible) next.add(e.id);
                      return next;
                    });
                    showToast(
                      `Pinned ${unpinnedVisible.length} visible row${unpinnedVisible.length === 1 ? '' : 's'}${
                        filterLabel ? ` (${filterLabel})` : ''
                      } · ${pinnedIds.size + unpinnedVisible.length} pinned`,
                      'ok',
                    );
                  }}
                  title={
                    filterLabel
                      ? `Pin every "${filterLabel}" row in the current view`
                      : 'Pin every row in the current view (after filters)'
                  }
                >
                  ★ Pin visible ({unpinnedVisible.length})
                </button>
              );
            })()}
            {/* Quick "unpin everything" — same shape as the bulk-pin
                so the two opposing actions cluster visually. Only
                renders when there's actually a pin to clear. */}
            {pinnedIds.size > 0 && (
              <button
                type="button"
                className="audit__bulk-btn"
                onClick={() => {
                  const count = pinnedIds.size;
                  if (!window.confirm(`Unpin all ${count} pinned row${count === 1 ? '' : 's'}?`)) {
                    return;
                  }
                  setPinnedIds(new Set());
                  showToast(`Unpinned ${count} row${count === 1 ? '' : 's'}`, 'ok');
                }}
                title="Clear every pinned row (asks for confirmation)"
              >
                ☆ Unpin all
              </button>
            )}
            {/* Pinned-only export — handy when the user has triaged a
                subset of rows for a bug report or post-mortem. Only
                renders when there's actually something pinned;
                exports as CSV by default (matches the user's existing
                spreadsheet workflow), preserving the order in which
                they were pinned. */}
            {pinnedIds.size > 0 && (() => {
              const pinnedEntries = entries.filter((e) => pinnedIds.has(e.id));
              return (
                <button
                  type="button"
                  className="audit__bulk-btn audit__bulk-btn--accent"
                  onClick={() => downloadAuditCsv(agentName, pinnedEntries)}
                  disabled={pinnedEntries.length === 0}
                  title={
                    pinnedEntries.length === 0
                      ? 'Pinned rows are off-screen (filter them in or change date range)'
                      : `Export only the ${pinnedEntries.length} pinned row${pinnedEntries.length === 1 ? '' : 's'} as CSV`
                  }
                >
                  ★ Export pinned ({pinnedEntries.length}) ↓
                </button>
              );
            })()}
            {/* Streaming export — hits the worker's /export endpoint
                which walks the audit_log in batches of 500 and streams
                JSONL. The visible list only shows the last 50 rows;
                this lets the user pull the full window (default 30
                days, server-capped at 50k rows). The download starts
                the moment the first batch lands, so feedback is
                immediate even on a slow link. */}
            <button
              type="button"
              className="audit__bulk-btn"
              onClick={() => {
                // Mirror the visible filters into the export URL so the
                // user gets a streamed JSONL of exactly what they're
                // looking at, just deeper in history. We don't pass
                // `before` because the stream walks from now backward.
                const params = new URLSearchParams();
                if (filterKinds.size > 0) {
                  params.set('kind', [...filterKinds].join(','));
                }
                if (searchQ.trim()) params.set('q', searchQ.trim());
                if (!includeSystem) params.set('includeSystem', '0');
                params.set('days', '30');
                const url = `/api/audit/${encodeURIComponent(agentName || 'default')}/export?${params.toString()}`;
                const a = document.createElement('a');
                a.href = url;
                // Let the worker set the filename via Content-Disposition.
                document.body.appendChild(a);
                a.click();
                a.remove();
              }}
              title="Stream the last 30 days as JSON Lines (filtered to match the view)"
            >
              Stream 30d ↓
            </button>
          </div>
        </div>
      )}
      <ul className="audit__list">
        {loading &&
          Array.from({ length: 6 }).map((_, i) => (
            <li key={`skel-${i}`} className="audit__entry audit__entry--skel">
              <div className="audit__entry-head">
                <span className="ot-skel ot-skel--row" style={{ width: '90px' }} />
                <span className="ot-skel ot-skel--row" style={{ width: '60%' }} />
                <span className="ot-skel ot-skel--row" style={{ width: '120px' }} />
              </div>
            </li>
          ))}
        {!loading && (() => {
          // Walk entries and emit a `Today / Yesterday / Mon DD` group
          // header whenever the day bucket changes. Pinned rows float
          // to the top under a "📌 Pinned" pseudo-bucket regardless of
          // their actual day, so a row from last week stays in view
          // while the user investigates it.
          const rendered: React.ReactNode[] = [];
          const PINNED_BUCKET = '__pinned__';
          // Stable two-pass order: pinned first (in newest-first
          // original order), then everything else.
          const orderedEntries = [
            ...entries.filter((e) => pinnedIds.has(e.id)),
            ...entries.filter((e) => !pinnedIds.has(e.id)),
          ];
          let currentBucket: string | null = null;
          let runningCount = 0;
          const groupCounts = new Map<string, number>();
          for (const e of orderedEntries) {
            const bucket = pinnedIds.has(e.id)
              ? PINNED_BUCKET
              : auditDayBucket(e.createdAt);
            groupCounts.set(bucket, (groupCounts.get(bucket) ?? 0) + 1);
          }
          for (const e of orderedEntries) {
            const bucket = pinnedIds.has(e.id)
              ? PINNED_BUCKET
              : auditDayBucket(e.createdAt);
            if (bucket !== currentBucket) {
              currentBucket = bucket;
              runningCount = groupCounts.get(bucket) ?? 0;
              const label = bucket === PINNED_BUCKET ? '📌 Pinned' : bucket;
              rendered.push(
                <li
                  key={`group-${bucket}`}
                  className={`audit__group-head${bucket === PINNED_BUCKET ? ' audit__group-head--pinned' : ''}`}
                  aria-hidden
                >
                  <span className="audit__group-label">{label}</span>
                  <span className="audit__group-count ot-micro">
                    {runningCount} {runningCount === 1 ? 'row' : 'rows'}
                  </span>
                </li>,
              );
            }
            const isOpen = expanded.has(e.id);
            const isPinned = pinnedIds.has(e.id);
            const isSystem = e.agentId === '__system__';
            rendered.push(
            <li
              key={e.id}
              id={`audit-${e.id}`}
              className={`audit__entry audit__entry--${e.kind}${isOpen ? ' audit__entry--open' : ''}${isPinned ? ' audit__entry--pinned' : ''}${isSystem ? ' audit__entry--system' : ''}${focusedAuditId === e.id ? ' audit__entry--kbd-focus' : ''}`}
            >
              <button
                type="button"
                className="audit__entry-head audit__entry-head--button"
                onClick={() => toggleExpanded(e.id)}
                aria-expanded={isOpen}
              >
                <span className={`ot-pill audit__kind audit__kind--${e.kind}`}>{e.kind.replace('_', ' ')}</span>
                {isSystem && (
                  <span
                    className="ot-pill audit__entry-system-pill"
                    title="Cross-agent system event (danger / bulk-restore / agent-delete)"
                  >
                    system
                  </span>
                )}
                <span className="audit__entry-summary">{auditSummary(e)}</span>
                <span
                  className="audit__entry-time ot-micro"
                  title={new Date(e.createdAt).toLocaleString()}
                >
                  {auditRelTime(e.createdAt)}
                </span>
                {notes[e.id] && (
                  <span
                    className="audit__entry-note-mark"
                    aria-label="This row has a note"
                    title={notes[e.id]}
                  >
                    ✎
                  </span>
                )}
                <span
                  className={`audit__entry-pin${isPinned ? ' audit__entry-pin--on' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={isPinned ? 'Unpin row' : 'Pin row to top'}
                  title={isPinned ? 'Unpin' : 'Pin to top'}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    togglePin(e.id);
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      ev.stopPropagation();
                      togglePin(e.id);
                    }
                  }}
                >
                  {isPinned ? '📌' : '📍'}
                </span>
                <span className="audit__entry-chevron" aria-hidden>
                  {isOpen ? '▾' : '▸'}
                </span>
              </button>
              {isOpen && (
                <>
                  {(() => {
                    const editing = editingNote?.id === e.id;
                    const existing = notes[e.id] ?? '';
                    if (editing) {
                      return (
                        <div className="audit__note audit__note--editing">
                          <textarea
                            className="ot-input audit__note-input"
                            autoFocus
                            value={editingNote!.draft}
                            placeholder="Note to future-you about this row…"
                            onChange={(ev) =>
                              setEditingNote({
                                id: e.id,
                                draft: ev.target.value,
                              })
                            }
                            onKeyDown={(ev) => {
                              if (
                                (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey))
                              ) {
                                ev.preventDefault();
                                setNote(e.id, editingNote!.draft);
                                setEditingNote(null);
                              } else if (ev.key === 'Escape') {
                                ev.preventDefault();
                                setEditingNote(null);
                              }
                            }}
                            rows={3}
                          />
                          <div className="audit__note-actions">
                            <button
                              type="button"
                              className="ot-btn"
                              onClick={() => {
                                setNote(e.id, editingNote!.draft);
                                setEditingNote(null);
                              }}
                            >
                              Save (⌘↵)
                            </button>
                            <button
                              type="button"
                              className="ot-btn ot-btn--ghost"
                              onClick={() => setEditingNote(null)}
                            >
                              Cancel (esc)
                            </button>
                          </div>
                        </div>
                      );
                    }
                    if (existing) {
                      return (
                        <div className="audit__note" role="note">
                          <span className="audit__note-glyph" aria-hidden>✎</span>
                          <p className="audit__note-text">{existing}</p>
                          <div className="audit__note-actions">
                            <button
                              type="button"
                              className="audit__note-btn"
                              onClick={() =>
                                setEditingNote({ id: e.id, draft: existing })
                              }
                            >
                              edit
                            </button>
                            <button
                              type="button"
                              className="audit__note-btn audit__note-btn--clear"
                              onClick={() => setNote(e.id, '')}
                            >
                              clear
                            </button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <button
                        type="button"
                        className="audit__note-add"
                        onClick={() =>
                          setEditingNote({ id: e.id, draft: '' })
                        }
                      >
                        ✎ Add note
                      </button>
                    );
                  })()}
                  {payloadView === 'tree' ? (
                    <div className="audit__payload-wrap">
                      {/* Quick copy affordance for tree-mode payloads
                          — clicking dumps the pretty-printed JSON to
                          clipboard, same shape as the raw view's
                          built-in copy button. Sits at the top-right
                          of the tree so it doesn't interrupt the
                          expand/collapse reading order. */}
                      <button
                        type="button"
                        className="audit__payload-copy"
                        onClick={async (ev) => {
                          // Shift+click → full envelope export
                          // (id, kind, timestamp, agentId, payload)
                          // so the user can paste a self-contained
                          // record into a bug report. Plain click
                          // remains the lighter payload-only copy.
                          const envelope = ev.shiftKey;
                          try {
                            const body = envelope
                              ? {
                                  id: e.id,
                                  kind: e.kind,
                                  createdAt: e.createdAt,
                                  createdAtIso: new Date(
                                    e.createdAt,
                                  ).toISOString(),
                                  agentId: e.agentId,
                                  payload: e.payload,
                                }
                              : e.payload;
                            const text = JSON.stringify(
                              body,
                              (_k, v) => {
                                if (typeof v === 'bigint') return `${v.toString()}n`;
                                if (typeof v === 'symbol') return v.toString();
                                return v;
                              },
                              2,
                            );
                            await navigator.clipboard.writeText(text);
                            showToast(
                              envelope
                                ? 'Envelope copied (id + kind + ts + payload)'
                                : 'Payload copied',
                              'ok',
                            );
                          } catch {
                            showToast('Copy failed', 'err');
                          }
                        }}
                        title="Copy the payload as pretty-printed JSON · Shift+click for the full envelope (id + kind + timestamp + payload)"
                        aria-label="Copy payload as JSON (shift-click for envelope)"
                      >
                        ⧉ Copy
                      </button>
                      <JsonTree value={e.payload} className="audit__payload" />
                    </div>
                  ) : (
                    <PayloadRaw value={e.payload} entry={e} />
                  )}
                  <div className="audit__entry-actions">
                    <button
                      type="button"
                      className="audit__entry-link"
                      onClick={async () => {
                        const link =
                          window.location.origin +
                          '/#/settings?tab=audit&id=' +
                          encodeURIComponent(e.id);
                        // Prefer the platform share sheet on devices
                        // that expose it (mobile + macOS Safari) so the
                        // user gets a one-tap path to Mail / Messages /
                        // Slack. Fall back to clipboard everywhere else.
                        const nav = navigator as Navigator & {
                          canShare?: (data: ShareData) => boolean;
                        };
                        const shareData: ShareData = {
                          title: `Audit · ${e.kind}`,
                          text: auditSummary(e),
                          url: link,
                        };
                        if (
                          typeof navigator.share === 'function' &&
                          (!nav.canShare || nav.canShare(shareData))
                        ) {
                          try {
                            await navigator.share(shareData);
                            return;
                          } catch (err) {
                            // AbortError = user dismissed the share
                            // sheet; treat as a no-op (no fallback copy
                            // needed). Anything else falls through to
                            // clipboard.
                            if (
                              err instanceof DOMException &&
                              err.name === 'AbortError'
                            ) {
                              return;
                            }
                          }
                        }
                        try {
                          await navigator.clipboard.writeText(link);
                          showToast('Link copied', 'ok');
                        } catch {
                          showToast('Copy failed', 'err');
                        }
                      }}
                      title="Share or copy a deep link to this entry"
                    >
                      🔗 share
                    </button>
                    {(() => {
                      // Jump-to-related cluster — surfaces a context-
                      // appropriate destination link per row kind so
                      // the audit feed reads like a connected web.
                      // Payload is `unknown` so each accessor narrows
                      // defensively. We render up to 3 links per row
                      // (the row's flex wrap caps the visual weight)
                      // and skip any that don't have the right
                      // payload shape.
                      const p =
                        e.payload && typeof e.payload === 'object'
                          ? (e.payload as Record<string, unknown>)
                          : null;
                      const jumps: React.ReactNode[] = [];
                      // 1) Thread link — present on most tool_call /
                      //    approval rows and the existing pattern.
                      const threadId =
                        typeof p?.threadId === 'string'
                          ? p.threadId
                          : typeof p?.thread_id === 'string'
                            ? p.thread_id
                            : null;
                      if (threadId) {
                        jumps.push(
                          <a
                            key="thread"
                            className="audit__entry-jump"
                            href={`#/shell?thread=${encodeURIComponent(threadId)}`}
                            title="Open this thread in chat"
                          >
                            → open in chat
                          </a>,
                        );
                      }
                      // 2) Tool drilldown — spend / tool_call rows
                      //    carry a `tool` field. Click jumps to
                      //    Spending tab + auto-expands the tool's
                      //    drilldown via the `?tool=` param.
                      const tool =
                        (e.kind === 'spend' || e.kind === 'tool_call') &&
                        typeof p?.tool === 'string'
                          ? p.tool
                          : null;
                      if (tool && tool.length > 0 && tool.length < 200) {
                        jumps.push(
                          <a
                            key="tool"
                            className="audit__entry-jump"
                            href={`#/settings?tab=spending&tool=${encodeURIComponent(tool)}`}
                            title={`Open the spending drilldown for ${tool}`}
                          >
                            → spend by tool
                          </a>,
                        );
                      }
                      // 3) PR link — pr_back rows usually carry a
                      //    full GitHub URL. External target so the
                      //    chat tab doesn't lose its scroll/focus.
                      const prUrl =
                        e.kind === 'pr_back' && typeof p?.prUrl === 'string'
                          ? p.prUrl
                          : e.kind === 'pr_back' && typeof p?.url === 'string'
                            ? p.url
                            : null;
                      if (prUrl) {
                        jumps.push(
                          <a
                            key="pr"
                            className="audit__entry-jump"
                            href={prUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Open this PR on GitHub"
                          >
                            ↗ open PR
                          </a>,
                        );
                      }
                      // 4) Sync tab — sync rows. Doesn't carry a
                      //    specific id we can deep-link to, but
                      //    landing on the sync panel is the right
                      //    next step for "investigate this sync row".
                      if (e.kind === 'sync') {
                        jumps.push(
                          <a
                            key="sync"
                            className="audit__entry-jump"
                            href="#/settings?tab=sync"
                            title="Open the sync panel"
                          >
                            → open sync
                          </a>,
                        );
                      }
                      // 5) Skills tab — skill_save rows carry a
                      //    skill id/name. The Skills screen doesn't
                      //    currently deep-link by id, so the jump
                      //    is just to the tab; future-proof for
                      //    when it does.
                      if (e.kind === 'skill_save') {
                        jumps.push(
                          <a
                            key="skill"
                            className="audit__entry-jump"
                            href="#/skills"
                            title="Open the Skills screen"
                          >
                            → open skills
                          </a>,
                        );
                      }
                      return jumps.length > 0 ? <>{jumps}</> : null;
                    })()}
                    {/* Mark-for-compare toggle — when one entry is
                        marked, marking a second pops the diff
                        button in the floating bar above the list.
                        Capped at 2 (third mark drops the oldest)
                        so the user can keep moving the comparison
                        without an explicit clear. */}
                    <button
                      type="button"
                      className={`audit__entry-compare-toggle${compareIds.includes(e.id) ? ' audit__entry-compare-toggle--on' : ''}`}
                      onClick={() => toggleCompare(e.id)}
                      title={
                        compareIds.includes(e.id)
                          ? 'Remove from comparison pair'
                          : compareIds.length >= 2
                            ? 'Add to comparison pair (drops the oldest)'
                            : 'Mark for side-by-side payload diff with another row'
                      }
                    >
                      {compareIds.includes(e.id) ? '↔ marked' : '↔ compare'}
                    </button>
                    <button
                      type="button"
                      className="audit__entry-id audit__entry-id--button ot-micro"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(e.id);
                          showToast(`Copied id ${e.id.slice(0, 8)}…`, 'ok');
                        } catch {
                          showToast('Copy failed', 'err');
                        }
                      }}
                      title="Copy full id to clipboard"
                    >
                      id <code>{e.id.slice(0, 12)}</code>
                      <span className="audit__entry-id-copy" aria-hidden>⧉</span>
                    </button>
                  </div>
                </>
              )}
            </li>,
          );
          }
          return rendered;
        })()}
        {!loading && entries.length === 0 && (
          <li className="ot-micro">No entries match this filter.</li>
        )}
      </ul>
      {hasMore && (
        <div ref={sentinelRef} className="audit__sentinel">
          {loadingMore ? 'loading more…' : 'scroll to load more'}
        </div>
      )}
    </SettingsPane>
  );
}

// One-line summary for an audit row's collapsed header. Cheap-and-readable —
// pulls the few fields that matter for each kind. Falls back to the first
// scalar key=value if shape doesn't match the expected schema.
// Day-bucket label for the audit log's group headers. Same boundaries as
// the sidebar's thread filter ("Today" / "Yesterday" / locale-specific
// short date), so when a row says "May 15" the user can correlate it
// against the chat sidebar without doing the math themselves.
function auditDayBucket(ts: number): string {
  const now = new Date();
  const then = new Date(ts);
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (isSameDay(now, then)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(yesterday, then)) return 'Yesterday';
  // Within the current year, drop the year for a cleaner header.
  const sameYear = now.getFullYear() === then.getFullYear();
  return then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// Compact relative-time formatter for audit rows. Hover surfaces the
// absolute timestamp via the parent's `title` attribute, so the user
// can still get a precise time when needed.
function auditRelTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return new Date(ts).toLocaleString();
  if (diff < 60_000) return 'just now';
  if (diff < 60 * 60_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60_000) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 7 * 24 * 60 * 60_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

// Collapsible JSON tree-view for audit payloads. Top-level renders the
// container (object/array) with a chevron + summary; clicking expands
// to show each key/value. Children that are themselves containers
// nest recursively so deeply-nested payloads (orchestrator turn rows,
// stripe webhook bodies) can be drilled into without scanning a giant
// JSON blob.
function JsonTree({ value, className }: { value: unknown; className?: string }) {
  return (
    <div className={`json-tree${className ? ` ${className}` : ''}`}>
      <JsonNode value={value} depth={0} startOpen={true} keyName={undefined} />
    </div>
  );
}

// Raw-JSON payload renderer used when the user has flipped the
// Audit toolbar's "tree | raw" switch to raw. Pretty-prints with
// 2-space indent for readability + carries a small copy button so
// the user can grab the entire formatted body for a bug report
// without re-selecting it. Handles non-JSON-serializable values
// (BigInt, undefined, Symbol) by routing through a guarded
// stringify that swaps each to a placeholder string rather than
// throwing.
function PayloadRaw({
  value,
  entry,
}: {
  value: unknown;
  // Optional envelope source — when provided, shift-click copies a
  // wrapped object including id/kind/timestamp/agentId. Without it
  // the copy button falls back to the plain payload behavior so
  // the component stays usable in any context.
  entry?: AuditEntry;
}) {
  const stringify = (v: unknown): string => {
    try {
      return JSON.stringify(
        v,
        (_k, x) => {
          // The standard `JSON.stringify` already handles most
          // things; we just need to soft-replace the few types
          // that throw or silently drop. Undefined comes out as
          // null already; BigInt throws; Symbol drops to null
          // without warning.
          if (typeof x === 'bigint') return `${x.toString()}n`;
          if (typeof x === 'symbol') return x.toString();
          return x;
        },
        2,
      );
    } catch (err) {
      return `(unable to stringify: ${err instanceof Error ? err.message : 'unknown'})`;
    }
  };
  const text = stringify(value);
  const lineCount = text.split('\n').length;
  return (
    <div className="audit__payload-raw">
      <div className="audit__payload-raw-head">
        <span className="ot-micro">
          {lineCount} line{lineCount === 1 ? '' : 's'} · {text.length} chars
        </span>
        <button
          type="button"
          className="audit__payload-raw-copy"
          onClick={async (ev) => {
            // Shift+click copies the full envelope (id, kind,
            // timestamp, agentId, payload) when an entry is in
            // scope. Plain click copies just the payload body.
            const envelope = ev.shiftKey && entry;
            const toCopy = envelope
              ? stringify({
                  id: entry.id,
                  kind: entry.kind,
                  createdAt: entry.createdAt,
                  createdAtIso: new Date(entry.createdAt).toISOString(),
                  agentId: entry.agentId,
                  payload: entry.payload,
                })
              : text;
            try {
              await navigator.clipboard.writeText(toCopy);
              showToast(
                envelope
                  ? 'Envelope copied (id + kind + ts + payload)'
                  : 'Payload copied',
                'ok',
              );
            } catch {
              showToast('Copy failed', 'err');
            }
          }}
          title="Copy the raw pretty-printed JSON · Shift+click for the full envelope (id + kind + timestamp + payload)"
        >
          ⧉ Copy
        </button>
      </div>
      <pre className="audit__payload-raw-body">{text}</pre>
    </div>
  );
}

function JsonNode({
  value,
  depth,
  startOpen,
  keyName,
}: {
  value: unknown;
  depth: number;
  startOpen: boolean;
  keyName: string | undefined;
}) {
  // Default-open at depth ≤ 1, closed deeper, so a typical
  // {tool, costCents, args:{…}} payload shows its top-level keys but
  // hides nested object guts until you drill in.
  const [open, setOpen] = useState(startOpen);
  const keyPrefix = keyName !== undefined ? <span className="json-tree__key">{keyName}: </span> : null;
  if (value === null) {
    return (
      <div className="json-tree__row" style={{ paddingLeft: depth * 14 }}>
        {keyPrefix}
        <span className="json-tree__null">null</span>
      </div>
    );
  }
  if (typeof value === 'boolean') {
    return (
      <div className="json-tree__row" style={{ paddingLeft: depth * 14 }}>
        {keyPrefix}
        <span className="json-tree__bool">{String(value)}</span>
      </div>
    );
  }
  if (typeof value === 'number') {
    return (
      <div className="json-tree__row" style={{ paddingLeft: depth * 14 }}>
        {keyPrefix}
        <span className="json-tree__num">{value}</span>
      </div>
    );
  }
  if (typeof value === 'string') {
    return (
      <div className="json-tree__row" style={{ paddingLeft: depth * 14 }}>
        {keyPrefix}
        <span className="json-tree__str">"{value}"</span>
      </div>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div className="json-tree__row" style={{ paddingLeft: depth * 14 }}>
          {keyPrefix}
          <span className="json-tree__bracket">[]</span>
        </div>
      );
    }
    return (
      <div className="json-tree__group">
        <button
          type="button"
          className="json-tree__toggle"
          style={{ paddingLeft: depth * 14 }}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="json-tree__chevron" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
          {keyPrefix}
          <span className="json-tree__bracket">[</span>
          {!open && (
            <span className="json-tree__preview">
              {value.length} item{value.length === 1 ? '' : 's'}
            </span>
          )}
          {!open && <span className="json-tree__bracket">]</span>}
        </button>
        {open && (
          <>
            {value.map((v, i) => (
              <JsonNode
                key={i}
                value={v}
                depth={depth + 1}
                startOpen={depth < 1}
                keyName={String(i)}
              />
            ))}
            <div className="json-tree__row" style={{ paddingLeft: depth * 14 }}>
              <span className="json-tree__bracket">]</span>
            </div>
          </>
        )}
      </div>
    );
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      return (
        <div className="json-tree__row" style={{ paddingLeft: depth * 14 }}>
          {keyPrefix}
          <span className="json-tree__bracket">{'{}'}</span>
        </div>
      );
    }
    return (
      <div className="json-tree__group">
        <button
          type="button"
          className="json-tree__toggle"
          style={{ paddingLeft: depth * 14 }}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="json-tree__chevron" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
          {keyPrefix}
          <span className="json-tree__bracket">{'{'}</span>
          {!open && (
            <span className="json-tree__preview">
              {keys.length} key{keys.length === 1 ? '' : 's'}: {keys.slice(0, 3).join(', ')}
              {keys.length > 3 ? '…' : ''}
            </span>
          )}
          {!open && <span className="json-tree__bracket">{'}'}</span>}
        </button>
        {open && (
          <>
            {keys.map((k) => (
              <JsonNode
                key={k}
                value={obj[k]}
                depth={depth + 1}
                startOpen={depth < 1}
                keyName={k}
              />
            ))}
            <div className="json-tree__row" style={{ paddingLeft: depth * 14 }}>
              <span className="json-tree__bracket">{'}'}</span>
            </div>
          </>
        )}
      </div>
    );
  }
  // Fallback for anything else (functions, symbols, etc.) — shouldn't
  // happen from a JSON-derived payload, but keeps the rendering total.
  return (
    <div className="json-tree__row" style={{ paddingLeft: depth * 14 }}>
      {keyPrefix}
      <span className="json-tree__str">{String(value)}</span>
    </div>
  );
}

// Build + download a CSV of the currently-loaded audit entries. Same
// RFC4180 quoting rules as the Invocations export — fields with comma,
// quote, or newline get wrapped + doubled-up. Payload is JSON-stringified
// into a single column so a downstream tool can re-parse it.
function downloadAuditCsv(agentName: string, entries: AuditEntry[]) {
  if (entries.length === 0) return;
  const header = ['When', 'Kind', 'Summary', 'Payload', 'Id'];
  const escape = (val: unknown): string => {
    const s = String(val ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [
    header.join(','),
    ...entries.map((e) =>
      [
        new Date(e.createdAt).toISOString(),
        e.kind,
        auditSummary(e),
        JSON.stringify(e.payload),
        e.id,
      ]
        .map(escape)
        .join(','),
    ),
  ];
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.download = `audit-${agentName || 'agent'}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
  showToast(`Exported ${entries.length} row${entries.length === 1 ? '' : 's'}`, 'ok');
}

function auditSummary(e: AuditEntry): string {
  const p = (e.payload && typeof e.payload === 'object') ? (e.payload as Record<string, unknown>) : null;
  if (!p) return '';
  switch (e.kind) {
    case 'tool_call': {
      const tool = String(p.tool ?? p.name ?? 'tool');
      const status = String(p.status ?? p.outcome ?? 'ok');
      const cents = typeof p.cents === 'number' ? p.cents : typeof p.cost_cents === 'number' ? p.cost_cents : null;
      const duration = typeof p.durationMs === 'number' ? `${(p.durationMs / 1000).toFixed(1)}s` : '';
      const cost = cents != null ? `$${(cents / 100).toFixed(3)}` : '';
      return [tool, '→', status, duration && `· ${duration}`, cost && `· ${cost}`]
        .filter(Boolean)
        .join(' ');
    }
    case 'spend': {
      const cents = typeof p.cents === 'number' ? p.cents : 0;
      const tool = String(p.tool ?? 'tool');
      return `+$${(cents / 100).toFixed(3)} from ${tool}`;
    }
    case 'approval': {
      const action = String(p.action ?? p.decision ?? 'approval');
      const target = String(p.target ?? p.tool ?? '');
      return target ? `${action} · ${target}` : action;
    }
    case 'sync': {
      const op = String(p.op ?? p.kind ?? 'sync');
      const detail = String(p.deployVersion ?? p.localSha ?? p.upstreamSha ?? '');
      return detail ? `${op} · ${detail.slice(0, 12)}` : op;
    }
    case 'pr_back': {
      const num = p.prNumber ?? p.number;
      const title = String(p.title ?? '');
      return num ? `#${num} · ${title.slice(0, 60)}` : title.slice(0, 60);
    }
    case 'skill_save': {
      const name = String(p.name ?? p.id ?? 'skill');
      const upstream = p.upstream ? ' (PR opened)' : '';
      return `saved ${name}${upstream}`;
    }
    case 'provision': {
      const step = String(p.step ?? 'provisioning');
      const ok = p.ok === false ? ' · failed' : '';
      return `${step}${ok}`;
    }
    case 'danger': {
      const action = String(p.action ?? 'unknown');
      const counts: string[] = [];
      if (typeof p.reset === 'number') counts.push(`${p.reset} reset`);
      if (typeof p.added === 'number') counts.push(`${p.added} added`);
      if (typeof p.skipped === 'number') counts.push(`${p.skipped} skipped`);
      if (p.agentId) counts.push(`agent=${p.agentId}`);
      return counts.length > 0 ? `${action} · ${counts.join(' · ')}` : action;
    }
  }
  // Fallback: surface the first scalar field — better than nothing.
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      return `${k}=${String(v).slice(0, 60)}`;
    }
  }
  return '';
}

function DangerZone({ agentName }: { agentName: string }) {
  const [confirming, setConfirming] = useState<
    null | {
      kind: 'reset' | 'delete';
      title: string;
      detail: string;
      phrase: string;
      action: () => Promise<void>;
    }
  >(null);
  const [typed, setTyped] = useState('');
  const [running, setRunning] = useState(false);

  const openReset = () => {
    setTyped('');
    setConfirming({
      kind: 'reset',
      title: `Reset every memory ${agentName} has accumulated`,
      detail:
        'Soft-resets every memory to importance=0. The Memory Agent\'s recall filter drops them from search, but the vector index stays intact in case a future iteration wants to restore.',
      phrase: 'reset memories',
      action: async () => {
        try {
          const res = await fetch('/api/learning/memories/reset', {
            method: 'POST',
          });
          const data = (await res.json()) as { ok: boolean; reset?: number };
          if (data.ok) {
            showToast(`Reset ${data.reset ?? 0} memor${(data.reset ?? 0) === 1 ? 'y' : 'ies'}`, 'ok');
          } else {
            showToast('Reset failed', 'err');
          }
        } catch {
          showToast('Reset failed — check connection', 'err');
        }
      },
    });
  };
  const openDelete = () => {
    setTyped('');
    setConfirming({
      kind: 'delete',
      title: `Delete the entire ${agentName} agent`,
      detail:
        'Wipes every D1 row, KV blob, and R2 object scoped to this agent. Does NOT tear down the Worker or your Cloudflare account — those stay yours to manage via wrangler.',
      phrase: agentName || 'delete',
      action: async () => {
        try {
          const res = await fetch(
            `/api/settings/${encodeURIComponent(agentName || 'default')}`,
            { method: 'DELETE' },
          );
          const data = (await res.json()) as {
            ok: boolean;
            removed?: Record<string, number>;
          };
          if (data.ok) {
            const totals = data.removed
              ? Object.entries(data.removed)
                  .filter(([, n]) => n > 0)
                  .map(([k, n]) => `${n} ${k}`)
                  .join(' · ')
              : '';
            showToast(
              totals ? `Agent deleted · ${totals}` : 'Agent deleted',
              'ok',
            );
            // Land the user on Landing since this agent doesn't exist
            // anymore. Onboarding's warm-reload detection will route
            // them sensibly from there.
            window.setTimeout(() => {
              window.location.hash = '#/';
            }, 800);
          } else {
            showToast('Delete failed', 'err');
          }
        } catch {
          showToast('Delete failed — check connection', 'err');
        }
      },
    });
  };
  const cancel = () => {
    setConfirming(null);
    setTyped('');
  };
  const runConfirmed = async () => {
    if (!confirming || running) return;
    if (typed.trim() !== confirming.phrase) return;
    setRunning(true);
    try {
      await confirming.action();
      setConfirming(null);
      setTyped('');
    } finally {
      setRunning(false);
    }
  };

  return (
    <SettingsPane title="Danger zone" lede="Irreversible operations.">
      <div className="settings__danger-row">
        <div>
          <h4>Reset memories</h4>
          <p className="ot-micro">Clears every memory {agentName} has accumulated.</p>
        </div>
        <button
          type="button"
          className="ot-btn ot-btn--ghost"
          onClick={openReset}
        >
          Reset
        </button>
      </div>
      <div className="settings__danger-row">
        <div>
          <h4>Delete this agent</h4>
          <p className="ot-micro">Tears down the Worker, drops the DOs, deletes the data.</p>
        </div>
        <button
          type="button"
          className="ot-btn ot-btn--ghost"
          onClick={openDelete}
        >
          Delete agent
        </button>
      </div>
      {confirming && (
        <div className="danger-modal" role="dialog" aria-label={confirming.title}>
          <button
            type="button"
            className="danger-modal__scrim"
            aria-label="Cancel"
            onClick={cancel}
            disabled={running}
          />
          <div className="danger-modal__panel">
            <h3>{confirming.title}</h3>
            <p>{confirming.detail}</p>
            <label className="danger-modal__field">
              <span className="ot-micro">
                Type <code>{confirming.phrase}</code> to confirm
              </span>
              <input
                autoFocus
                className="ot-input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    cancel();
                  } else if (
                    e.key === 'Enter' &&
                    typed.trim() === confirming.phrase
                  ) {
                    e.preventDefault();
                    void runConfirmed();
                  }
                }}
                spellCheck={false}
                autoComplete="off"
                placeholder={confirming.phrase}
              />
            </label>
            <div className="danger-modal__actions">
              <button
                type="button"
                className="ot-btn ot-btn--ghost"
                onClick={cancel}
                disabled={running}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ot-btn danger-modal__commit"
                onClick={() => void runConfirmed()}
                disabled={typed.trim() !== confirming.phrase || running}
              >
                {running ? 'Running…' : confirming.kind === 'reset' ? 'Reset' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </SettingsPane>
  );
}

function SettingsPane({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-pane">
      <header>
        <h3>{title}</h3>
        <p className="settings-pane__lede">{lede}</p>
      </header>
      <div className="settings-pane__body">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings__field">
      <span className="ot-label">{label}</span>
      <div className="settings__field-value">{value}</div>
    </div>
  );
}

function ModeOption({
  name,
  title,
  subtitle,
  active,
  onPick,
  recommended,
}: {
  name: string;
  title: string;
  subtitle: string;
  active: boolean;
  onPick: () => void;
  recommended?: boolean;
}) {
  return (
    <button
      type="button"
      className={`mode-option${active ? ' mode-option--active' : ''}`}
      onClick={onPick}
      data-name={name}
    >
      <div className="mode-option__head">
        <span className="mode-option__title">{title}</span>
        {recommended && <span className="ot-pill ot-pill--accent">recommended</span>}
      </div>
      <p>{subtitle}</p>
    </button>
  );
}
