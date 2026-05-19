import { useEffect, useMemo, useState } from 'react';
import { showToast } from '../shell/Toast';
import './Learning.css';

// Tokenize for the duplicate-detector — lowercased, punctuation-stripped,
// short noise words dropped so "I prefer concise" and "prefers concise
// replies" cluster as expected. Returns a Set for O(1) intersection.
function tokenize(s: string): Set<string> {
  const stop = new Set([
    'a',
    'an',
    'and',
    'the',
    'to',
    'of',
    'is',
    'are',
    'in',
    'on',
    'at',
    'i',
    'me',
    'my',
    'with',
    'for',
    'as',
  ]);
  const tokens = s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !stop.has(t));
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return inter / union;
}

// Word-level diff between the saved memory body and the user's in-flight
// draft. Mirrors the LCS-driven walk we use for the prompt diff in
// Settings.tsx — kept local so this screen stays self-contained. Returns
// a flat token stream tagged `same` / `add` / `del` so the renderer can
// color them inline without re-parsing.
function diffMemoryWords(
  before: string,
  after: string,
): Array<{ kind: 'same' | 'add' | 'del'; text: string }> {
  // Keep trailing whitespace on each token so concatenation reproduces
  // the original strings (gives clean inline rendering with normal
  // word spacing). Regex captures "word + trailing space" or "pure
  // whitespace run" as one token each.
  const tokenize = (s: string): string[] => {
    const out: string[] = [];
    const re = /\S+\s*|\s+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) out.push(m[0]!);
    return out;
  };
  const A = tokenize(before);
  const B = tokenize(after);
  const norm = (t: string): string => t.trim();
  const m = A.length;
  const n = B.length;
  // Bail on huge inputs — memories cap at a few hundred chars in
  // practice but a paste might blow up. LCS is O(m*n), so 5k tokens
  // squared is the upper bound we're willing to spend on a render.
  if (m * n > 25_000) {
    return [
      { kind: 'del', text: before },
      { kind: 'add', text: after },
    ];
  }
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

interface Summary {
  skills: { total: number; pinned: number };
  memories: { total: number; byCategory: Record<string, number> };
  rubrics: { total: number; defaultId: string };
  pending: { count: number };
}

interface Memory {
  id: string;
  category: string;
  content: string;
  importance: number;
  whenToUse: string | null;
  createdAt: number;
  updatedAt: number;
  // User-curated taxonomy chips, parallel to the implicit
  // when-to-use tokens. Optional + omitted on untagged memories.
  tags?: string[];
}

// Mirror the worker's tag sanitizer client-side so chips render
// canonically before the PUT round-trip.
function sanitizeMemoryTagClient(raw: string): string | null {
  const t = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return t || null;
}

interface Props {
  agentName: string;
}

export function Learning({ agentName }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Recent workflow runs (Goal + RetrainingWorkflow). Lazy-loaded on
  // mount; the section is hidden entirely when none exist so we don't
  // bloat the page for users who haven't kicked off any goals yet.
  const [workflowRuns, setWorkflowRuns] = useState<
    Array<{
      id: string;
      kind: 'goal' | 'retrain';
      status: string;
      createdAt: number;
      summary?: string;
    }>
  >([]);
  const [draft, setDraft] = useState('');
  // Filter the memory list by category. `all` shows every category;
  // picking a category chip narrows the visible list. Stays purely
  // client-side — server already returns up to 50 active rows.
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  // Memory sort order — defaults to "updated" (most-recently-touched
  // first) since the typical "where did that recent note go?" search
  // gets the user where they want fastest. Other options trade off
  // discoverability vs. predictability: alpha-asc is great when the
  // memory ID is unknown but a phrase is remembered; importance-desc
  // surfaces the high-priority items first; created-asc is the
  // "scroll back in time" lens. Persists to localStorage so a reload
  // doesn't clobber the user's preferred lens.
  type MemorySort = 'updated-desc' | 'updated-asc' | 'created-desc' | 'created-asc' | 'importance-desc' | 'alpha-asc';
  const [memorySort, setMemorySort] = useState<MemorySort>(() => {
    if (typeof window === 'undefined') return 'updated-desc';
    const raw = window.localStorage.getItem('openthink:memory-sort');
    const allowed: MemorySort[] = [
      'updated-desc',
      'updated-asc',
      'created-desc',
      'created-asc',
      'importance-desc',
      'alpha-asc',
    ];
    return (allowed as string[]).includes(raw ?? '')
      ? (raw as MemorySort)
      : 'updated-desc';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('openthink:memory-sort', memorySort);
  }, [memorySort]);
  // Stable comparator factory — keeps the sort consistent across
  // re-renders and lets us reuse the same logic from the JSX render.
  const memorySortComparator = (a: Memory, b: Memory): number => {
    switch (memorySort) {
      case 'updated-desc':
        return b.updatedAt - a.updatedAt;
      case 'updated-asc':
        return a.updatedAt - b.updatedAt;
      case 'created-desc':
        return b.createdAt - a.createdAt;
      case 'created-asc':
        return a.createdAt - b.createdAt;
      case 'importance-desc':
        // Importance ties break on recent-update so the secondary
        // ordering still feels useful at equal-priority cohorts.
        return b.importance - a.importance || b.updatedAt - a.updatedAt;
      case 'alpha-asc':
        return a.content.localeCompare(b.content);
    }
  };
  // Free-text search across memory content + when-to-use. Lowercase
  // substring match — fast and good enough for a 50-row dataset.
  // Persisted to localStorage so a reload doesn't wipe the in-flight
  // filter; clears when the user explicitly hits the × button.
  const [memorySearch, setMemorySearch] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem('openthink:memory-search') ?? '';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (memorySearch) {
      window.localStorage.setItem('openthink:memory-search', memorySearch);
    } else {
      window.localStorage.removeItem('openthink:memory-search');
    }
  }, [memorySearch]);
  // Tag filter — derived from the top-frequency tokens across every
  // memory's `whenToUse` string. Stays a Set so chip-clicks AND the
  // underlying filter use the same accumulator without round-tripping
  // through the URL.
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  // Explicit user-curated tag layer (separate from the derived
  // when-to-use chips above). Lets the user CRUD their own grouping
  // taxonomy and round-trip it through bulk export/import. Filter
  // semantics match `activeTags`: AND across the active set.
  const [activeMemTags, setActiveMemTags] = useState<Set<string>>(new Set());
  const [editingMemTagsFor, setEditingMemTagsFor] = useState<string | null>(null);
  const [memTagDraft, setMemTagDraft] = useState<string>('');
  // Active suggestion index inside the autocomplete strip — drives the
  // ↑/↓ keyboard navigation. Reset whenever the draft changes so a new
  // partial word always starts at the top of the suggestion list.
  const [memTagSuggestActive, setMemTagSuggestActive] = useState(0);
  // Global tag pool sorted by usage frequency. Hoisted to component
  // scope so the autocomplete strip in any memory's tag editor can hit
  // it without re-walking the full list per keystroke. Memo on
  // `memories` — the pool only changes when memories load or get
  // mutated.
  const allMemTagPool = useMemo(() => {
    if (!memories) return [] as Array<{ tag: string; count: number }>;
    const counts = new Map<string, number>();
    for (const m of memories) {
      if (!Array.isArray(m.tags)) continue;
      for (const t of m.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [memories]);
  // Resolve a current draft into "tokens the user has typed so far" +
  // "the partial word they're typing now". Splitting on the same regex
  // as `saveMemoryTags` so the autocomplete matches the same parser as
  // the save path — no edge cases where a suggestion adds a tag the
  // saver would have rejected.
  const splitTagDraft = (raw: string): { typed: Set<string>; partial: string } => {
    // Match the trailing partial — everything from the last separator
    // (whitespace or comma) onward, before any trailing separator.
    const parts = raw.split(/[\s,]+/);
    const partialRaw = parts[parts.length - 1] ?? '';
    const typedRaw = parts.slice(0, -1);
    const typed = new Set<string>();
    for (const p of typedRaw) {
      const c = sanitizeMemoryTagClient(p);
      if (c) typed.add(c);
    }
    return { typed, partial: partialRaw.toLowerCase() };
  };
  // Build the suggestion list for the current draft + memory. Excludes
  // tags the user already typed in this draft AND tags the memory
  // already has saved (those are the existing chips — re-suggesting
  // them would be noise). Caps at 6 chips so the row doesn't wrap on
  // narrow viewports.
  const memTagSuggestions = (draft: string, memoryTags: string[] | undefined): string[] => {
    const { typed, partial } = splitTagDraft(draft);
    const existing = new Set(memoryTags ?? []);
    const out: string[] = [];
    for (const { tag } of allMemTagPool) {
      if (typed.has(tag)) continue;
      if (existing.has(tag)) continue;
      if (partial && !tag.startsWith(partial)) continue;
      out.push(tag);
      if (out.length >= 6) break;
    }
    return out;
  };
  // Apply a suggestion to the current draft. Replaces the trailing
  // partial word with the chosen tag, then appends a space so the user
  // can type or pick another tag immediately without manual delimiter.
  const completeTagFromSuggestion = (draft: string, suggestion: string): string => {
    const idx = draft.search(/[\s,][^\s,]*$/);
    if (idx === -1) {
      // No prior separator — the entire draft was the partial. Replace
      // it wholesale.
      return `${suggestion} `;
    }
    // Keep the prefix + chosen tag + trailing space.
    return `${draft.slice(0, idx + 1)}${suggestion} `;
  };
  const saveMemoryTags = async (id: string, raw: string) => {
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const part of raw.split(/[\s,]+/)) {
      const t = sanitizeMemoryTagClient(part);
      if (!t || seen.has(t)) continue;
      seen.add(t);
      cleaned.push(t);
      if (cleaned.length >= 12) break;
    }
    const snapshot = memories;
    setMemories((prev) =>
      prev
        ? prev.map((m) =>
            m.id === id
              ? cleaned.length > 0
                ? { ...m, tags: cleaned }
                : ((): Memory => {
                    const { tags: _t, ...rest } = m;
                    return rest as Memory;
                  })()
              : m,
          )
        : prev,
    );
    setEditingMemTagsFor(null);
    setMemTagDraft('');
    try {
      const res = await fetch(
        `/api/learning/memories/${encodeURIComponent(id)}/tags`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: cleaned }),
        },
      );
      if (!res.ok) throw new Error('save_failed');
    } catch {
      setMemories(snapshot);
      showToast('Memory tag save failed', 'err');
    }
  };
  // Surface clusters of near-duplicates in a collapsible panel. Each
  // cluster is a list of memories that share a category and have ≥0.7
  // Jaccard similarity on tokenized content. We use union-find by way
  // of seed-then-cluster: every memory becomes its own cluster, then
  // we merge pairs that score above the threshold.
  const [dedupOpen, setDedupOpen] = useState(false);
  const duplicateClusters = useMemo(() => {
    if (!memories || memories.length < 2) return [] as Memory[][];
    const tokensByIdx = memories.map((m) => tokenize(m.content));
    // Union-find with parent pointers.
    const parent = memories.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i]! !== i) {
        parent[i] = parent[parent[i]!]!;
        i = parent[i]!;
      }
      return i;
    };
    const union = (i: number, j: number) => {
      const a = find(i);
      const b = find(j);
      if (a !== b) parent[a] = b;
    };
    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        if (memories[i]!.category !== memories[j]!.category) continue;
        const sim = jaccard(tokensByIdx[i]!, tokensByIdx[j]!);
        if (sim >= 0.7) union(i, j);
      }
    }
    const groups = new Map<number, Memory[]>();
    for (let i = 0; i < memories.length; i++) {
      const root = find(i);
      const list = groups.get(root) ?? [];
      list.push(memories[i]!);
      groups.set(root, list);
    }
    return Array.from(groups.values())
      .filter((g) => g.length >= 2)
      .map((g) => g.sort((a, b) => b.updatedAt - a.updatedAt));
  }, [memories]);

  const mergeCluster = async (cluster: Memory[]) => {
    if (cluster.length < 2) return;
    const [keeper, ...drops] = cluster;
    if (!keeper) return;
    if (
      !window.confirm(
        `Keep "${keeper.content.slice(0, 60)}…" and drop ${drops.length} similar memor${drops.length === 1 ? 'y' : 'ies'}?`,
      )
    ) {
      return;
    }
    const snapshot = memories;
    const dropIds = new Set(drops.map((d) => d.id));
    setMemories((prev) => (prev ? prev.filter((m) => !dropIds.has(m.id)) : prev));
    try {
      await Promise.all(
        drops.map((d) =>
          fetch(`/api/learning/memories/${encodeURIComponent(d.id)}`, {
            method: 'DELETE',
          }),
        ),
      );
      showToast(`Merged ${drops.length} duplicate${drops.length === 1 ? '' : 's'}`, 'ok');
    } catch {
      setMemories(snapshot);
      showToast('Merge failed', 'err');
    }
  };

  // Pulled out of the mount-time effect so the per-category quick-
  // add handler can re-fetch after a successful insert without
  // duplicating the GET shape. Wraps the response in setMemories
  // so React batches the state update.
  const refreshMemories = async () => {
    try {
      const res = await fetch('/api/learning/memories');
      const data = (await res.json()) as { memories?: Memory[] };
      setMemories(data.memories ?? []);
    } catch {
      setMemories([]);
    }
  };
  // Same shape for the summary card counts — re-pulled after a
  // quick-add so the per-category "N memories" label flips
  // immediately rather than staying stale until the next page load.
  const refreshSummary = async () => {
    try {
      const res = await fetch('/api/learning/summary');
      const s = (await res.json()) as Summary;
      setSummary(s);
    } catch {
      /* leave stale — better than blanking the summary cards */
    }
  };

  // Per-category quick-add drafts. Keyed by category id so each card's
  // input stays independent — typing into "user_facts" doesn't bleed
  // into "preferences". Empty values are dropped on submit.
  const [quickAddDrafts, setQuickAddDrafts] = useState<Record<string, string>>({});
  const [quickAddBusy, setQuickAddBusy] = useState<string | null>(null);
  const submitQuickAdd = async (categoryId: string) => {
    const content = (quickAddDrafts[categoryId] ?? '').trim();
    if (!content || quickAddBusy) return;
    setQuickAddBusy(categoryId);
    try {
      const res = await fetch('/api/learning/memories/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memories: [{ category: categoryId, content, importance: 1 }],
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        added?: number;
        skipped?: number;
      };
      if (data.ok && (data.added ?? 0) > 0) {
        showToast(`Added to ${categoryId.replace('_', ' ')}`, 'ok');
        // Refresh both stores so the new row appears in the list AND
        // the per-category card count flips immediately.
        await Promise.all([refreshMemories(), refreshSummary()]);
        // Clear the draft for just this category — leave other
        // pending drafts intact in case the user is composing across
        // multiple cards.
        setQuickAddDrafts((prev) => {
          const next = { ...prev };
          delete next[categoryId];
          return next;
        });
      } else if (data.ok && (data.skipped ?? 0) > 0) {
        showToast(`Already remembered (duplicate)`, 'err');
      } else {
        showToast('Add failed', 'err');
      }
    } catch {
      showToast('Add failed', 'err');
    } finally {
      setQuickAddBusy(null);
    }
  };

  useEffect(() => {
    void fetch('/api/learning/summary')
      .then((r) => r.json())
      .then((s: Summary) => setSummary(s))
      .catch(() => undefined);
    void refreshMemories();
    void fetch('/api/goal?limit=10')
      .then((r) => r.json())
      .then(
        (data: {
          runs?: Array<{
            id: string;
            kind: 'goal' | 'retrain';
            status: string;
            createdAt: number;
            summary?: string;
          }>;
        }) => setWorkflowRuns(data.runs ?? []),
      )
      .catch(() => undefined);
  }, []);

  const commitEdit = async () => {
    if (!editingId) return;
    const next = draft.trim();
    if (!next) {
      setEditingId(null);
      return;
    }
    // Optimistic update + rollback on error.
    const snapshot = memories;
    setMemories((prev) =>
      prev
        ? prev.map((m) =>
            m.id === editingId ? { ...m, content: next, updatedAt: Date.now() } : m,
          )
        : prev,
    );
    setEditingId(null);
    try {
      const res = await fetch(`/api/learning/memories/${encodeURIComponent(editingId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: next }),
      });
      const data = (await res.json()) as { ok: boolean };
      if (data.ok) showToast('Memory updated', 'ok');
      else {
        setMemories(snapshot);
        showToast('Save failed', 'err');
      }
    } catch {
      setMemories(snapshot);
      showToast('Save failed', 'err');
    }
  };

  const removeMemory = async (id: string) => {
    if (!window.confirm('Forget this memory?')) return;
    const snapshot = memories;
    setMemories((prev) => (prev ? prev.filter((m) => m.id !== id) : prev));
    try {
      await fetch(`/api/learning/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });
      showToast('Memory removed', 'ok');
    } catch {
      setMemories(snapshot);
      showToast('Remove failed', 'err');
    }
  };

  return (
    <div className="learning">
      <header className="learning__header">
        <h2>Learning</h2>
        <p className="learning__lede">
          What {agentName} has accumulated about you, the work, and the world.
        </p>
      </header>

      <div className="learning__cards">
        <SummaryCard
          title="Skills"
          value={summary?.skills.total ?? 0}
          extra={`${summary?.skills.pinned ?? 0} pinned`}
          description="Named procedures the agent has learned."
        />
        <SummaryCard
          title="Memories"
          value={summary?.memories.total ?? 0}
          extra={summary ? Object.values(summary.memories.byCategory).reduce((a, b) => a + b, 0) + ' across categories' : '—'}
          description="Facts about you, your work, and your preferences."
        />
        <SummaryCard
          title="Rubrics"
          value={summary?.rubrics.total ?? 0}
          extra={`default: ${summary?.rubrics.defaultId ?? '—'}`}
          description="Criteria used to score the agent's own runs."
        />
      </div>

      <section className="learning__section">
        <div className="learning__section-head">
          <h3>Pending suggestions</h3>
          <p className="ot-micro">
            Every trained run that left a pattern worth keeping. Accept what's useful;
            decline the rest.
          </p>
        </div>
        {summary && summary.pending.count > 0 ? (
          <ul className="learning__pending">
            <li>real pending list arrives with iteration 7's self-evolve loop.</li>
          </ul>
        ) : (
          <div className="ot-empty">
            <span className="ot-empty__glyph" aria-hidden>
              ✦
            </span>
            <h3 className="ot-empty__title">{agentName} is up to date</h3>
            <p className="ot-empty__body">
              The retraining workflow runs nightly. New behavioral patterns
              from low-scoring turns will surface here for your review.
            </p>
          </div>
        )}
      </section>

      <section className="learning__section">
        <div className="learning__section-head">
          <h3>Memories</h3>
          <p className="ot-micro">
            Click a memory to edit; ⋯ to remove. Soft-deleted memories
            stay in the vector index in case a future iteration wants to
            undo.
          </p>
        </div>
        {memories === null ? (
          <ul className="learning__memories">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={`skel-${i}`} className="learning__memory learning__memory--skel">
                <span className="ot-skel ot-skel--row" style={{ width: '78%' }} />
              </li>
            ))}
          </ul>
        ) : memories.length === 0 ? (
          <div className="ot-empty learning__memories-empty">
            <span className="ot-empty__glyph" aria-hidden>
              ✿
            </span>
            <h3 className="ot-empty__title">No memories yet</h3>
            <p className="ot-empty__body">
              {agentName} starts blank — every memory comes from a real
              conversation. Chat for a bit, and the orchestrator promotes
              durable facts (your timezone, project names, recurring
              preferences) up here for review.
            </p>
            <div className="learning__memories-empty-cta">
              <button
                type="button"
                className="ot-btn"
                onClick={() => {
                  window.location.hash = '#/shell';
                }}
              >
                → Start chatting
              </button>
              <button
                type="button"
                className="ot-btn ot-btn--ghost"
                onClick={() => {
                  // Scroll back up to the Pending section so the user can
                  // accept any low-hanging suggestions the retrain
                  // workflow has already surfaced.
                  const sections = document.querySelectorAll('.learning__section');
                  // Pending is the first .learning__section; scroll to it.
                  if (sections[0]) {
                    sections[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }}
                title="Pending suggestions list above"
              >
                ↑ Check pending
              </button>
            </div>
          </div>
        ) : (() => {
          // Count by category for the chip counts. Categories that are
          // empty get omitted from the chip row so users don't have to
          // wade through dead filters.
          const counts = new Map<string, number>();
          for (const m of memories) {
            counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
          }
          const present = CATEGORIES.filter((c) => (counts.get(c.id) ?? 0) > 0);
          // Build a frequency-sorted tag pool from every memory's
          // whenToUse string. Skips stopwords + ≤2-char tokens so the
          // chips are usefully signal-y; caps at the top 10.
          const tagStop = new Set([
            'a', 'an', 'and', 'or', 'the', 'to', 'of', 'in', 'on', 'at',
            'is', 'are', 'for', 'with', 'as', 'i', 'me', 'my', 'we',
            'our', 'you', 'your', 'it', 'this', 'that', 'be', 'when',
            'if', 'do', 'does', 'will', 'has', 'have', 'use', 'using',
          ]);
          const tagCounts = new Map<string, number>();
          for (const m of memories) {
            if (!m.whenToUse) continue;
            const toks = m.whenToUse
              .toLowerCase()
              .replace(/[^a-z0-9\s-]/g, ' ')
              .split(/\s+/)
              .filter((t) => t.length > 2 && !tagStop.has(t));
            for (const t of new Set(toks)) {
              tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
            }
          }
          const tagPool = [...tagCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
          // Compute the user-curated tag pool — counts across the
          // (pre-explicit-tag) filtered list so a count reflects the
          // current category + when-to-use lens. Sorted by frequency
          // for the chip row.
          const memTagCounts = new Map<string, number>();
          for (const m of memories) {
            if (!Array.isArray(m.tags)) continue;
            for (const t of m.tags) memTagCounts.set(t, (memTagCounts.get(t) ?? 0) + 1);
          }
          const memTagPool = [...memTagCounts.entries()]
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
          const searchQ = memorySearch.trim().toLowerCase();
          const filtered = memories
            .filter((m) =>
              categoryFilter === 'all' ? true : m.category === categoryFilter,
            )
            .filter((m) => {
              if (activeTags.size === 0) return true;
              const text = (m.whenToUse ?? '').toLowerCase();
              for (const t of activeTags) {
                if (!text.includes(t)) return false;
              }
              return true;
            })
            .filter((m) => {
              if (activeMemTags.size === 0) return true;
              if (!Array.isArray(m.tags) || m.tags.length === 0) return false;
              for (const t of activeMemTags) {
                if (!m.tags.includes(t)) return false;
              }
              return true;
            })
            .filter((m) => {
              // Free-text search across content + when-to-use + tags.
              // Lowercase substring — case-insensitive, handles
              // multi-word queries naturally (the user types the
              // phrase exactly as it appears in the memory).
              if (!searchQ) return true;
              if (m.content.toLowerCase().includes(searchQ)) return true;
              if ((m.whenToUse ?? '').toLowerCase().includes(searchQ)) return true;
              if (
                Array.isArray(m.tags) &&
                m.tags.some((t) => t.toLowerCase().includes(searchQ))
              )
                return true;
              return false;
            })
            // Final sort pass — applies the user-chosen ordering after
            // all filters have narrowed the list. Slice is required
            // because .sort mutates and `memories` is React state.
            .slice()
            .sort(memorySortComparator);
          return (
            <>
              {duplicateClusters.length > 0 && (
                <div className="learning__dedup">
                  <button
                    type="button"
                    className="learning__dedup-banner"
                    onClick={() => setDedupOpen((v) => !v)}
                    aria-expanded={dedupOpen}
                  >
                    <span className="learning__dedup-glyph" aria-hidden>↺</span>
                    <span>
                      <strong>{duplicateClusters.length}</strong> likely
                      duplicate{duplicateClusters.length === 1 ? '' : 's'}
                      {' '}found · review & merge
                    </span>
                    <span className="learning__dedup-chevron" aria-hidden>
                      {dedupOpen ? '▾' : '▸'}
                    </span>
                  </button>
                  {dedupOpen && (
                    <ul className="learning__dedup-list">
                      {duplicateClusters.map((cluster, ci) => (
                        <li key={ci} className="learning__dedup-cluster">
                          <div className="learning__dedup-cluster-head">
                            <span className="ot-micro">
                              {cluster.length} memories ·{' '}
                              {cluster[0]!.category.replace('_', ' ')}
                            </span>
                            <button
                              type="button"
                              className="ot-btn ot-btn--ghost"
                              onClick={() => void mergeCluster(cluster)}
                              title="Keep newest, drop the rest"
                            >
                              Keep newest
                            </button>
                          </div>
                          <ul className="learning__dedup-rows">
                            {cluster.map((m, i) => (
                              <li
                                key={m.id}
                                className={`learning__dedup-row${i === 0 ? ' learning__dedup-row--keeper' : ''}`}
                              >
                                <span className="learning__dedup-row-tag">
                                  {i === 0 ? 'keep' : 'drop'}
                                </span>
                                <span className="learning__dedup-row-text">
                                  {m.content}
                                </span>
                                <span className="ot-micro">
                                  {new Date(m.updatedAt).toLocaleDateString()}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {/* Free-text memory search. Lives above the filter
                  chips because it's the most common refine action
                  once a user has ≥20 memories. Esc clears so the
                  field doesn't strand a stale filter on a remount. */}
              {memories.length > 5 && (
                <div className="learning__memory-search">
                  <span
                    className="learning__memory-search-glyph"
                    aria-hidden
                  >
                    ⌕
                  </span>
                  <input
                    type="search"
                    className="ot-input learning__memory-search-input"
                    placeholder="Search memory content or when-to-use…"
                    value={memorySearch}
                    onChange={(e) => setMemorySearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && memorySearch) {
                        e.preventDefault();
                        e.stopPropagation();
                        setMemorySearch('');
                      }
                    }}
                    aria-label="Search memories"
                  />
                  {memorySearch && (
                    <button
                      type="button"
                      className="learning__memory-search-clear"
                      onClick={() => setMemorySearch('')}
                      title="Clear search (Esc)"
                      aria-label="Clear search"
                    >
                      ×
                    </button>
                  )}
                  {/* Sort dropdown — sits inline with the search input
                      so the user's "find this memory" controls cluster
                      together. Defaults to recently-updated since
                      that's where edits land. */}
                  <label className="learning__memory-sort">
                    <span className="ot-micro learning__memory-sort-label">
                      sort
                    </span>
                    <select
                      className="learning__memory-sort-select"
                      value={memorySort}
                      onChange={(e) => setMemorySort(e.target.value as MemorySort)}
                      aria-label="Sort memories"
                    >
                      <option value="updated-desc">recently updated</option>
                      <option value="updated-asc">least recently updated</option>
                      <option value="created-desc">newest first</option>
                      <option value="created-asc">oldest first</option>
                      <option value="importance-desc">highest importance</option>
                      <option value="alpha-asc">alphabetical</option>
                    </select>
                  </label>
                </div>
              )}
              <div className="learning__memory-filters">
                <button
                  type="button"
                  className={`learning__memory-filter${categoryFilter === 'all' ? ' learning__memory-filter--active' : ''}`}
                  onClick={() => setCategoryFilter('all')}
                >
                  all <span className="learning__memory-filter-n">{memories.length}</span>
                </button>
                {present.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`learning__memory-filter learning__memory-filter--${c.id}${categoryFilter === c.id ? ' learning__memory-filter--active' : ''}`}
                    onClick={() => setCategoryFilter(c.id)}
                  >
                    {c.id.replace('_', ' ')}{' '}
                    <span className="learning__memory-filter-n">{counts.get(c.id) ?? 0}</span>
                  </button>
                ))}
                {/* Bulk-clear by category — only renders when a single
                    category filter is active AND it has rows. Same
                    soft-delete semantics as the per-row Forget (sets
                    importance=0). Writes a `danger` audit row for the
                    paper trail. */}
                {categoryFilter !== 'all' &&
                  (counts.get(categoryFilter) ?? 0) > 0 && (
                    <button
                      type="button"
                      className="learning__memory-filter learning__memory-filter--clear"
                      onClick={async () => {
                        const n = counts.get(categoryFilter) ?? 0;
                        if (
                          !window.confirm(
                            `Forget all ${n} memor${n === 1 ? 'y' : 'ies'} in "${categoryFilter.replace('_', ' ')}"? The orchestrator will stop recalling them (soft delete).`,
                          )
                        ) {
                          return;
                        }
                        const snapshot = memories;
                        // Optimistic local drop.
                        setMemories((prev) =>
                          prev
                            ? prev.filter((m) => m.category !== categoryFilter)
                            : prev,
                        );
                        try {
                          const res = await fetch(
                            '/api/learning/memories/clear-category',
                            {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ category: categoryFilter }),
                            },
                          );
                          const data = (await res.json()) as {
                            ok: boolean;
                            cleared?: number;
                          };
                          if (data.ok) {
                            showToast(
                              `Forgot ${data.cleared ?? n} memor${(data.cleared ?? n) === 1 ? 'y' : 'ies'}`,
                              'ok',
                            );
                          } else {
                            setMemories(snapshot);
                            showToast('Clear failed', 'err');
                          }
                        } catch {
                          setMemories(snapshot);
                          showToast('Clear failed', 'err');
                        }
                      }}
                      title={`Forget all ${counts.get(categoryFilter) ?? 0} memories in "${categoryFilter}"`}
                    >
                      × Forget {counts.get(categoryFilter) ?? 0}
                    </button>
                  )}
              </div>
              {tagPool.length > 0 && (
                <div className="learning__memory-tags">
                  <span className="ot-micro learning__memory-tags-label">
                    when-to-use tags
                  </span>
                  {tagPool.map(([tag, n]) => {
                    const active = activeTags.has(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={`learning__memory-tag${active ? ' learning__memory-tag--active' : ''}`}
                        onClick={() => {
                          setActiveTags((prev) => {
                            const next = new Set(prev);
                            if (next.has(tag)) next.delete(tag);
                            else next.add(tag);
                            return next;
                          });
                        }}
                      >
                        {tag}
                        <span className="learning__memory-filter-n">{n}</span>
                      </button>
                    );
                  })}
                  {activeTags.size > 0 && (
                    <button
                      type="button"
                      className="learning__memory-tag learning__memory-tag--clear"
                      onClick={() => setActiveTags(new Set())}
                    >
                      × clear
                    </button>
                  )}
                </div>
              )}
              {memTagPool.length > 0 && (
                <div className="learning__memory-tags learning__memory-tags--custom">
                  <span className="ot-micro learning__memory-tags-label">
                    custom tags
                  </span>
                  {memTagPool.map(({ tag, count }) => {
                    const active = activeMemTags.has(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={`learning__memory-tag learning__memory-tag--custom${active ? ' learning__memory-tag--active' : ''}`}
                        onClick={() => {
                          setActiveMemTags((prev) => {
                            const next = new Set(prev);
                            if (next.has(tag)) next.delete(tag);
                            else next.add(tag);
                            return next;
                          });
                        }}
                        title={
                          active
                            ? `Stop filtering by ${tag}`
                            : `Show memories tagged ${tag} (${count})`
                        }
                      >
                        {tag}
                        <span className="learning__memory-filter-n">{count}</span>
                      </button>
                    );
                  })}
                  {activeMemTags.size > 0 && (
                    <button
                      type="button"
                      className="learning__memory-tag learning__memory-tag--clear"
                      onClick={() => setActiveMemTags(new Set())}
                    >
                      × clear
                    </button>
                  )}
                </div>
              )}
              {filtered.length === 0 ? (
                <p className="ot-micro" style={{ margin: '12px 0' }}>
                  No memories in this category.
                </p>
              ) : (
                <ul className="learning__memories">
                  {filtered.map((m) => (
              <li key={m.id} className="learning__memory">
                <span className={`ot-pill learning__memory-cat learning__memory-cat--${m.category}`}>
                  {m.category.replace('_', ' ')}
                </span>
                {editingId === m.id ? (
                  <div className="learning__memory-edit-wrap">
                    <textarea
                      className="ot-input learning__memory-edit"
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => void commitEdit()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void commitEdit();
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                      rows={Math.max(2, Math.min(6, Math.ceil(draft.length / 60)))}
                    />
                    {draft.trim() && draft.trim() !== m.content.trim() && (
                      <MemoryDiff before={m.content} after={draft} />
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="learning__memory-content"
                    onClick={() => {
                      setEditingId(m.id);
                      setDraft(m.content);
                    }}
                    title="Click to edit"
                  >
                    {m.content}
                  </button>
                )}
                {/* Per-memory tag strip — explicit user-curated chips
                    plus an edit affordance. Clicking a chip activates
                    the global custom-tag filter. */}
                <div className="learning__memory-tag-strip">
                  {editingMemTagsFor === m.id ? (
                    (() => {
                      // Compute suggestions per-render — cheap (caps at 6,
                      // pool is pre-sorted) and stays in sync with every
                      // draft keystroke without needing a ref/effect dance.
                      const suggestions = memTagSuggestions(memTagDraft, m.tags);
                      const activeSuggestion = suggestions[
                        Math.min(memTagSuggestActive, Math.max(0, suggestions.length - 1))
                      ];
                      return (
                        <div className="learning__memory-tag-edit">
                          <input
                            type="text"
                            className="ot-input"
                            value={memTagDraft}
                            autoFocus
                            placeholder="space- or comma-separated tags…"
                            onChange={(e) => {
                              setMemTagDraft(e.target.value);
                              // Reset highlight to first chip whenever the
                              // partial word changes — the previously
                              // highlighted suggestion is probably no longer
                              // even in the filtered set.
                              setMemTagSuggestActive(0);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                // Enter + an active suggestion completes
                                // it; Enter on a bare draft saves. This
                                // mirrors VSCode-style completion UX —
                                // suggestions take priority when present.
                                if (activeSuggestion) {
                                  setMemTagDraft(
                                    completeTagFromSuggestion(
                                      memTagDraft,
                                      activeSuggestion,
                                    ),
                                  );
                                  setMemTagSuggestActive(0);
                                } else {
                                  void saveMemoryTags(m.id, memTagDraft);
                                }
                              } else if (e.key === 'Tab' && activeSuggestion) {
                                // Tab also completes — accessibility users
                                // who'd rather not learn an Enter-overload
                                // can use the canonical completion key.
                                e.preventDefault();
                                setMemTagDraft(
                                  completeTagFromSuggestion(
                                    memTagDraft,
                                    activeSuggestion,
                                  ),
                                );
                                setMemTagSuggestActive(0);
                              } else if (e.key === 'ArrowDown' && suggestions.length > 0) {
                                e.preventDefault();
                                setMemTagSuggestActive(
                                  (idx) => (idx + 1) % suggestions.length,
                                );
                              } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
                                e.preventDefault();
                                setMemTagSuggestActive(
                                  (idx) =>
                                    (idx - 1 + suggestions.length) % suggestions.length,
                                );
                              } else if (e.key === 'Escape') {
                                setEditingMemTagsFor(null);
                                setMemTagDraft('');
                                setMemTagSuggestActive(0);
                              }
                            }}
                            // Suppress save-on-blur when the blur was
                            // caused by clicking a suggestion chip. The
                            // chip's onMouseDown swallows focus to avoid
                            // racing the blur, but a fast cancel keeps
                            // us safe even if focus does move.
                            onBlur={() => void saveMemoryTags(m.id, memTagDraft)}
                          />
                          {suggestions.length > 0 && (
                            <div
                              className="learning__memory-tag-suggest"
                              role="listbox"
                              aria-label="Tag suggestions"
                            >
                              {suggestions.map((s, idx) => (
                                <button
                                  key={s}
                                  type="button"
                                  role="option"
                                  aria-selected={idx === memTagSuggestActive}
                                  className={`learning__memory-tag-suggest-chip${
                                    idx === memTagSuggestActive
                                      ? ' learning__memory-tag-suggest-chip--active'
                                      : ''
                                  }`}
                                  onMouseDown={(e) => {
                                    // Block focus theft so the input's
                                    // onBlur doesn't fire and trigger a
                                    // save before we apply the
                                    // suggestion.
                                    e.preventDefault();
                                  }}
                                  onClick={() => {
                                    setMemTagDraft(
                                      completeTagFromSuggestion(memTagDraft, s),
                                    );
                                    setMemTagSuggestActive(0);
                                  }}
                                  title={`Use existing tag: ${s}`}
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          )}
                          <span className="ot-micro">
                            Enter to save · Esc to cancel
                            {suggestions.length > 0 && ' · ↑↓ Tab to complete'}
                          </span>
                        </div>
                      );
                    })()
                  ) : (
                    <>
                      {Array.isArray(m.tags) &&
                        m.tags.map((t) => (
                          <button
                            key={t}
                            type="button"
                            className={`learning__memory-tag learning__memory-tag--custom learning__memory-tag--item${activeMemTags.has(t) ? ' learning__memory-tag--active' : ''}`}
                            onClick={() => {
                              setActiveMemTags((prev) => {
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
                        className="learning__memory-tag learning__memory-tag--edit"
                        onClick={() => {
                          setEditingMemTagsFor(m.id);
                          setMemTagDraft(
                            Array.isArray(m.tags) ? m.tags.join(' ') : '',
                          );
                        }}
                        title={
                          Array.isArray(m.tags) && m.tags.length > 0
                            ? 'Edit custom tags'
                            : 'Add custom tags'
                        }
                      >
                        {Array.isArray(m.tags) && m.tags.length > 0
                          ? '✎'
                          : '+ tag'}
                      </button>
                    </>
                  )}
                </div>
                <div className="learning__memory-meta">
                  <span className="ot-micro">importance {m.importance}/10</span>
                  <button
                    type="button"
                    className="learning__memory-remove"
                    onClick={() => void removeMemory(m.id)}
                    title="Forget this memory"
                    aria-label="Forget memory"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
                </ul>
              )}
            </>
          );
        })()}
      </section>

      {workflowRuns.length > 0 && (
        <section className="learning__section">
          <div className="learning__section-head">
            <h3>Recent workflow runs</h3>
            <p className="ot-micro">
              Goal + retraining workflows the orchestrator has kicked off
              in the past week (KV-backed, capped at 10).
            </p>
          </div>
          <ul className="learning__workflows">
            {workflowRuns.map((run) => {
              // Resumable when the run ended in a non-success state.
              // We can't restart a Workflow run mid-execution; the
              // /resume endpoint creates a fresh run with the same
              // goal text + plan and returns the new id.
              const resumable =
                run.kind === 'goal' &&
                (run.status === 'cancelled' ||
                  run.status === 'error' ||
                  run.status === 'aborted');
              return (
                <li
                  key={`${run.kind}:${run.id}`}
                  className={`learning__workflow learning__workflow--${run.status}`}
                >
                  <span
                    className={`ot-pill learning__workflow-kind learning__workflow-kind--${run.kind}`}
                  >
                    {run.kind}
                  </span>
                  <div className="learning__workflow-body">
                    <div className="learning__workflow-summary">
                      {run.summary || run.id}
                    </div>
                    <div className="ot-micro">
                      {new Date(run.createdAt).toLocaleString()} ·{' '}
                      <code>{run.id.slice(0, 14)}</code>
                    </div>
                  </div>
                  {resumable && (
                    <button
                      type="button"
                      className="learning__workflow-resume"
                      onClick={async () => {
                        try {
                          const res = await fetch(
                            `/api/goal/${encodeURIComponent(run.id)}/resume`,
                            { method: 'POST' },
                          );
                          const data = (await res.json()) as {
                            ok: boolean;
                            runId?: string;
                            error?: string;
                          };
                          if (data.ok) {
                            showToast(
                              `Resumed as ${data.runId?.slice(0, 12)}…`,
                              'ok',
                            );
                            // Optimistically prepend a new queued entry
                            // so the user sees their re-run immediately.
                            setWorkflowRuns((prev) => [
                              {
                                id: data.runId ?? `pending-${Date.now()}`,
                                kind: 'goal',
                                status: 'queued',
                                createdAt: Date.now(),
                                summary: run.summary,
                              },
                              ...prev,
                            ]);
                          } else {
                            showToast(
                              `Re-run failed${data.error ? ` · ${data.error}` : ''}`,
                              'err',
                            );
                          }
                        } catch {
                          showToast('Re-run failed', 'err');
                        }
                      }}
                      title="Start a fresh run with the same goal + plan"
                    >
                      ↻ Re-run
                    </button>
                  )}
                  <span
                    className={`ot-pill learning__workflow-status learning__workflow-status--${run.status}`}
                  >
                    {run.status}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <section className="learning__section">
        <div className="learning__section-head">
          <h3>Categories</h3>
          <p className="ot-micro">Where memories land by default.</p>
        </div>
        <div className="learning__categories">
          {CATEGORIES.map((c) => {
            const draft = quickAddDrafts[c.id] ?? '';
            const isBusy = quickAddBusy === c.id;
            return (
              <article key={c.id} className="learning__category">
                <h4>{c.title}</h4>
                <p>{c.body}</p>
                <span className="ot-micro">{summary?.memories.byCategory[c.id] ?? 0} memories</span>
                {/* Inline quick-add — drop a memory straight into the
                    matching category without needing to navigate
                    elsewhere. Enter to submit, Shift+Enter would
                    insert a newline (handled by the browser since
                    it's a textarea). */}
                <div className="learning__category-quickadd">
                  <input
                    type="text"
                    className="ot-input learning__category-quickadd-input"
                    placeholder={`Add to ${c.title.toLowerCase()}…`}
                    value={draft}
                    disabled={isBusy}
                    onChange={(e) => {
                      const v = e.target.value;
                      setQuickAddDrafts((prev) => ({ ...prev, [c.id]: v }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && draft.trim() && !isBusy) {
                        e.preventDefault();
                        void submitQuickAdd(c.id);
                      } else if (e.key === 'Escape' && draft) {
                        e.preventDefault();
                        setQuickAddDrafts((prev) => {
                          const next = { ...prev };
                          delete next[c.id];
                          return next;
                        });
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="ot-btn ot-btn--ghost learning__category-quickadd-btn"
                    onClick={() => void submitQuickAdd(c.id)}
                    disabled={isBusy || !draft.trim()}
                    title={`Add this memory to ${c.title}`}
                  >
                    {isBusy ? 'Adding…' : 'Add'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  extra,
  description,
}: {
  title: string;
  value: number;
  extra: string;
  description: string;
}) {
  return (
    <article className="summary-card">
      <h4>{title}</h4>
      <div className="summary-card__value">{value}</div>
      <div className="summary-card__extra">{extra}</div>
      <p className="summary-card__desc">{description}</p>
    </article>
  );
}

const CATEGORIES = [
  { id: 'user_facts', title: 'User facts', body: 'Stable details: name, role, location, working hours.' },
  { id: 'active_work', title: 'Active work', body: 'In-flight projects, blockers, next steps.' },
  { id: 'preferences', title: 'Preferences', body: 'How you like things — style, tone, defaults.' },
  { id: 'domain_knowledge', title: 'Domain knowledge', body: 'What you know that the agent should treat as ground truth.' },
  { id: 'people', title: 'People', body: 'The cast: collaborators, contacts, decision-makers.' },
];

// Inline "what changed" preview rendered below the memory edit textarea.
// Shows a single-line word-diff (red strikethrough for removed tokens,
// green underline for added ones) so the user can see at a glance what
// their tweak actually mutates before it lands. We use mousedown
// preventDefault so clicking the diff doesn't steal focus from the
// textarea and accidentally commit the edit.
function MemoryDiff({ before, after }: { before: string; after: string }) {
  const tokens = diffMemoryWords(before, after);
  const added = tokens.filter((t) => t.kind === 'add').length;
  const removed = tokens.filter((t) => t.kind === 'del').length;
  if (added === 0 && removed === 0) return null;
  return (
    <div
      className="learning__memory-diff"
      onMouseDown={(e) => {
        // Block focus theft — the textarea owns the active commit cycle
        // via its blur handler, and we don't want a stray click on the
        // diff strip to push the edit through.
        e.preventDefault();
      }}
    >
      <div className="learning__memory-diff-stats ot-micro">
        <span className="learning__memory-diff-add">+{added} added</span>
        <span className="learning__memory-diff-del">−{removed} removed</span>
        <span className="learning__memory-diff-hint">
          changes vs. saved memory
        </span>
      </div>
      <p className="learning__memory-diff-text">
        {tokens.map((t, i) => (
          <span
            key={i}
            className={`learning__memory-diff-tok learning__memory-diff-tok--${t.kind}`}
          >
            {t.text}
          </span>
        ))}
      </p>
    </div>
  );
}
