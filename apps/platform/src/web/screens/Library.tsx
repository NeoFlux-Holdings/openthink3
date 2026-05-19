// Library screen — grid of all artifacts across threads. PRD §11.
//
// Pulls from `/api/artifacts/list/<agent>` (R2-backed, with a deterministic
// stub when R2 is empty), supports filter chips by type + a fuzzy title
// search. Clicking a tile fires onOpen with the canonical key so the parent
// (Shell) can pop the artifact in the canvas.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArtifactPreview } from '../shell/ArtifactPreview';
import { showToast } from '../shell/Toast';
import { buildZipBlob } from '../utils/zip';
import './Library.css';

interface Props {
  agentName: string;
  onOpen: (id: string) => void;
}

interface ArtifactRow {
  id: string;
  key: string;
  type: string;
  title: string;
  version: number;
  size: number;
  uploadedAt: number;
  starred?: boolean;
  /** User-curated tags; persisted in KV under `artifact-tags:<key>`. */
  tags?: string[];
}

// Canonical Library ordering: starred first, then most-recent-uploaded.
// Used on initial fetch + every star toggle so the grid stays consistent
// across reloads. Pulling this into a helper means we can't forget to
// re-sort when we add a new mutation site.
function sortArtifacts(rows: ArtifactRow[]): ArtifactRow[] {
  return rows.slice().sort((a, b) => {
    if (!!a.starred !== !!b.starred) return a.starred ? -1 : 1;
    return b.uploadedAt - a.uploadedAt;
  });
}

const FILTERS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'starred', label: '★ Starred' },
  { id: 'document', label: 'Documents' },
  { id: 'code', label: 'Code' },
  { id: 'browser-session', label: 'Browser sessions' },
  { id: 'slides', label: 'Slides' },
  { id: 'chart', label: 'Charts' },
  { id: 'image', label: 'Images' },
  { id: 'table', label: 'Tables' },
  { id: 'webpage', label: 'Webpages' },
];

export function Library({ agentName, onOpen }: Props) {
  const [rows, setRows] = useState<ArtifactRow[]>([]);
  const [source, setSource] = useState<'r2' | 'stub'>('stub');
  const [loading, setLoading] = useState(true);
  // Filter + search query both round-trip through the URL hash so
  // deep links (`#/library?filter=code&q=foo`) and reload-survives just
  // work. We seed initial state from the hash on mount, and rewrite the
  // hash on every change via `history.replaceState` (no extra render).
  const [filter, setFilter] = useState<string>(() => {
    if (typeof window === 'undefined') return 'all';
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    return params.get('filter') || 'all';
  });
  const [query, setQuery] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    return params.get('q') || '';
  });
  // Tag filter — AND semantics across the set. The hash carries
  // `tags=a,b,c` so deep links to "every chart tagged Q4 and final"
  // survive a reload.
  const [activeTagFilter, setActiveTagFilter] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    const raw = params.get('tags');
    if (!raw) return new Set();
    return new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    );
  });
  const [viewing, setViewing] = useState<ArtifactRow | null>(null);

  // Mirror state into the hash on change so the URL is the source of
  // truth. Both filter and query collapse to defaults when omitted to
  // keep the URL short for the common case.
  useEffect(() => {
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('filter', filter);
    if (query.trim()) params.set('q', query.trim());
    if (activeTagFilter.size > 0) {
      params.set('tags', [...activeTagFilter].join(','));
    }
    const qs = params.toString();
    const next = qs ? `#/library?${qs}` : '#/library';
    if (window.location.hash !== next) {
      window.history.replaceState(null, '', next);
    }
  }, [filter, query, activeTagFilter]);
  // Bulk-select mode — toggled on by the "Select" button. While enabled,
  // tile clicks add/remove from the `selected` set instead of opening the
  // viewer. A floating action bar at the top shows the count and the
  // primary delete action.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  // Bulk-star action in flight — disables the button + shows a saving
  // hint while the parallel POSTs settle.
  const [starringBulk, setStarringBulk] = useState(false);
  // Bulk-tag state — when select mode is on and the user has picked
  // ≥1 artifacts, an input appears for adding tags to all of them.
  // Same UNION semantics as the Knowledge bulk-tag: new tags merge
  // into each artifact's existing set.
  const [bulkTagDraft, setBulkTagDraft] = useState('');
  const [bulkTagBusy, setBulkTagBusy] = useState(false);
  const sanitizeArtifactTagClient = (raw: string): string | null => {
    const t = raw
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);
    return t || null;
  };
  const applyBulkTags = async () => {
    if (selected.size === 0 || !bulkTagDraft.trim()) return;
    const parts = bulkTagDraft
      .split(/[\s,]+/)
      .map((t) => sanitizeArtifactTagClient(t))
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
    const snapshot = rows;
    setRows((prev) =>
      prev.map((r) => {
        if (!selected.has(r.id)) return r;
        const existing = Array.isArray(r.tags) ? r.tags : [];
        const merged = [...existing];
        for (const t of dedup) {
          if (!merged.includes(t) && merged.length < 12) merged.push(t);
        }
        return merged.length > 0 ? { ...r, tags: merged } : r;
      }),
    );
    try {
      const ids = [...selected];
      const cohort = 6;
      for (let i = 0; i < ids.length; i += cohort) {
        const batch = ids.slice(i, i + cohort);
        await Promise.all(
          batch.map((id) => {
            const row = rows.find((r) => r.id === id);
            const existing = Array.isArray(row?.tags) ? row!.tags! : [];
            const merged = [...existing];
            for (const t of dedup) {
              if (!merged.includes(t) && merged.length < 12) merged.push(t);
            }
            return fetch(
              `/api/artifacts/${encodeURIComponent(id)}/tags`,
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
        `Added ${dedup.length} tag${dedup.length === 1 ? '' : 's'} to ${ids.length} artifact${ids.length === 1 ? '' : 's'}`,
        'ok',
      );
      setBulkTagDraft('');
    } catch {
      setRows(snapshot);
      showToast('Bulk tag failed', 'err');
    } finally {
      setBulkTagBusy(false);
    }
  };

  // Mirror of applyBulkTags but in the subtraction direction —
  // removes the typed tags from each selected artifact's set. Only
  // hits the worker for rows that actually had at least one of the
  // tags so we don't burn round-trips on no-ops. The artifact's
  // `tags` field is dropped entirely when emptied, matching what the
  // single-row delete does, so empty arrays don't camp on the row.
  const removeBulkTags = async () => {
    if (selected.size === 0 || !bulkTagDraft.trim()) return;
    const parts = bulkTagDraft
      .split(/[\s,]+/)
      .map((t) => sanitizeArtifactTagClient(t))
      .filter((t): t is string => !!t);
    const dedup: string[] = [];
    const seen = new Set<string>();
    for (const t of parts) {
      if (!seen.has(t)) {
        seen.add(t);
        dedup.push(t);
      }
    }
    if (dedup.length === 0) return;
    // Identify selected rows that actually carry at least one of the
    // requested tags. If none do, surface a quick toast and bail —
    // saves a confirm + a wave of no-op PUTs.
    const affected = rows.filter(
      (r) =>
        selected.has(r.id) &&
        Array.isArray(r.tags) &&
        r.tags.some((t) => dedup.includes(t)),
    );
    if (affected.length === 0) {
      showToast('None of the selected rows carry those tags', 'err');
      return;
    }
    if (
      !window.confirm(
        `Remove ${dedup.length === 1 ? `the tag "${dedup[0]}"` : `${dedup.length} tags`} from ${affected.length} artifact${affected.length === 1 ? '' : 's'}?`,
      )
    ) {
      return;
    }
    setBulkTagBusy(true);
    const snapshot = rows;
    // Optimistic: subtract dedup from each affected row. If the
    // result is empty, drop `tags` from the row entirely so it
    // doesn't render an empty placeholder.
    setRows((prev) =>
      prev.map((r) => {
        if (!selected.has(r.id) || !Array.isArray(r.tags)) return r;
        const next = r.tags.filter((t) => !dedup.includes(t));
        if (next.length === r.tags.length) return r;
        if (next.length === 0) {
          const { tags: _drop, ...rest } = r;
          return rest;
        }
        return { ...r, tags: next };
      }),
    );
    try {
      const ids = affected.map((a) => a.id);
      const cohort = 6;
      for (let i = 0; i < ids.length; i += cohort) {
        const batch = ids.slice(i, i + cohort);
        await Promise.all(
          batch.map((id) => {
            const row = rows.find((r) => r.id === id);
            const existing = Array.isArray(row?.tags) ? row!.tags! : [];
            const next = existing.filter((t) => !dedup.includes(t));
            return fetch(
              `/api/artifacts/${encodeURIComponent(id)}/tags`,
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags: next }),
              },
            );
          }),
        );
      }
      showToast(
        `Removed ${dedup.length === 1 ? `"${dedup[0]}"` : `${dedup.length} tags`} from ${affected.length} artifact${affected.length === 1 ? '' : 's'}`,
        'ok',
      );
      setBulkTagDraft('');
    } catch {
      setRows(snapshot);
      showToast('Bulk untag failed', 'err');
    } finally {
      setBulkTagBusy(false);
    }
  };

  // Toggle the starred flag on every currently-selected non-stub
  // artifact. `target` flips them ALL to that value (true = star, false
  // = unstar), so a mixed selection becomes uniformly starred or
  // unstarred. Fires the POSTs in parallel + re-sorts on success.
  const bulkStar = async (target: boolean) => {
    if (selected.size === 0) return;
    const picks = rows.filter(
      (r) => selected.has(r.id) && !r.id.startsWith('stub-'),
    );
    if (picks.length === 0) return;
    setStarringBulk(true);
    // Optimistic: flip the local rows + re-sort so starred items float
    // to the top immediately, then reconcile on POST results.
    setRows((prev) =>
      sortArtifacts(
        prev.map((r) => (selected.has(r.id) ? { ...r, starred: target } : r)),
      ),
    );
    try {
      const results = await Promise.allSettled(
        picks.map((p) =>
          fetch(`/api/artifacts/${encodeURIComponent(p.key)}/star`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ starred: target }),
          }),
        ),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed === 0) {
        showToast(
          `${target ? 'Starred' : 'Unstarred'} ${picks.length} artifact${picks.length === 1 ? '' : 's'}`,
          'ok',
        );
      } else {
        showToast(
          `${target ? 'Starred' : 'Unstarred'} ${picks.length - failed} · ${failed} failed`,
          'info',
        );
      }
    } finally {
      setStarringBulk(false);
    }
  };

  // The id we most recently *clicked* (with or without shift). Shift+click
  // uses this as the range anchor so users can "click first, shift-click
  // last" the way Finder / Photos / GitHub work.
  const lastClickedRef = useRef<string | null>(null);

  // Right-click context menu state — one menu at a time, positioned at
  // the cursor with the artifact row whose tile was clicked. Cleared on
  // any click outside, Esc, or after the user picks an action.
  // Hover preview state — when a tile is hovered for ≥350ms, a
  // floating card appears next to it with the full metadata
  // (untruncated title, every tag, exact size/date, the artifact's
  // R2 key). Closes on mouseleave + clear-timer. Suppressed during
  // drag-to-tag, context-menu open, and select mode to avoid
  // popover pile-ups.
  const [hoverPreview, setHoverPreview] = useState<{
    row: ArtifactRow;
    rect: { left: number; top: number; right: number; bottom: number };
  } | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  // Grace timer used when the user leaves a tile — gives them a ~120ms
  // window to move the cursor into the popover before we clear it.
  // Without this, the popover dies the instant the cursor crosses the
  // tile boundary, making the popover's contents (key, tags) un-
  // interactable.
  const hoverGraceRef = useRef<number | null>(null);
  // Per-artifact snippet cache. Each entry is either the loaded text
  // (truncated to ~700 chars at the fetch site) or the literal
  // `'loading'` sentinel while a fetch is in flight. Stays in a ref
  // (not state) so the cache survives the component's hover state
  // churn — re-hovering the same tile gets a synchronous cache hit.
  const snippetCacheRef = useRef<Map<string, string | 'loading' | 'failed' | 'skipped'>>(
    new Map(),
  );
  const [, setSnippetTick] = useState(0);
  // Per-artifact image dimensions cache. Populated on the popover's
  // <img> onLoad — once we have the natural W×H we never need to
  // re-fetch even if the user re-hovers later. Lives in a ref so
  // re-renders don't churn it; a small bump-state forces the
  // popover to re-render once the dimensions are known.
  const imageDimsRef = useRef<Map<string, { w: number; h: number }>>(new Map());
  const snippetAbortRef = useRef<AbortController | null>(null);
  // Kick off a snippet fetch for the currently-hovered tile if its
  // type is text-y and we don't already have it cached. Skips binary
  // / opaque types (image, browser-session, etc.) — they have nothing
  // useful to render as a text snippet.
  const ensureSnippet = (row: ArtifactRow) => {
    if (row.id.startsWith('stub-')) return;
    const cache = snippetCacheRef.current;
    if (cache.has(row.id)) return;
    const TEXT_TYPES = new Set(['document', 'code', 'table', 'webpage']);
    if (!TEXT_TYPES.has(row.type)) {
      cache.set(row.id, 'skipped');
      return;
    }
    cache.set(row.id, 'loading');
    setSnippetTick((n) => n + 1);
    // Cancel any in-flight previous snippet so we don't overlap.
    snippetAbortRef.current?.abort();
    const controller = new AbortController();
    snippetAbortRef.current = controller;
    void (async () => {
      try {
        const res = await fetch(
          `/api/artifacts/${encodeURIComponent(row.key)}`,
          {
            headers: { Range: 'bytes=0-4095' },
            signal: controller.signal,
          },
        );
        if (!res.ok && res.status !== 206) {
          cache.set(row.id, 'failed');
          setSnippetTick((n) => n + 1);
          return;
        }
        const text = await res.text();
        // Truncate at the first 700 chars and at the last whole word
        // before that cap so the snippet doesn't end mid-token.
        let snippet = text.slice(0, 700);
        const lastSpace = snippet.lastIndexOf(' ', 680);
        if (lastSpace > 400) snippet = snippet.slice(0, lastSpace);
        // Strip any control bytes that would render as garbage in a
        // <pre>; keeps the snippet from making the popover look
        // corrupted when the file isn't actually text.
        snippet = snippet.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
        cache.set(row.id, snippet.length > 0 ? snippet : 'failed');
        setSnippetTick((n) => n + 1);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        cache.set(row.id, 'failed');
        setSnippetTick((n) => n + 1);
      }
    })();
  };
  const clearHover = () => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (hoverGraceRef.current) {
      window.clearTimeout(hoverGraceRef.current);
      hoverGraceRef.current = null;
    }
    snippetAbortRef.current?.abort();
    setHoverPreview(null);
  };
  // Esc closes the hover popover from anywhere — including when the
  // user has tabbed into the popover or moused away but the popover
  // is still open via the keep-alive grace timer. Tab when focus is
  // on the source tile redirects into the popover so keyboard users
  // can reach the copy-key button. Skipped when focus is in a text
  // input so the field's own Esc semantics (clear search, etc.)
  // take precedence.
  useEffect(() => {
    if (!hoverPreview) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (target?.isContentEditable) return;
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog && dialog.contains(target as Node)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        clearHover();
        return;
      }
      // Cmd/Ctrl+Enter opens the popover's source artifact in the
      // standard preview pane. Lets keyboard users go from
      // "hovering for a peek" to "actually open this" without
      // moving the mouse. We honor Cmd on Mac and Ctrl on
      // Windows/Linux so the muscle memory carries over.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const row = hoverPreview.row;
        clearHover();
        // Stub rows don't have a meaningful preview path — they
        // route through onOpen instead so the chat surface knows
        // to seed a new task. Match the tile-click behavior.
        if (row.id.startsWith('stub-')) {
          onOpen(row.id);
        } else {
          setViewing(row);
        }
        return;
      }
      // Cmd/Ctrl+C copies the artifact title to the clipboard —
      // but only when there's no text selection in the popover.
      // If the user has selected something, the browser's
      // native copy handler should win (that's what they
      // expect). When the popover is open with no selection,
      // Cmd+C grabs the title as a "I want to share this row
      // by name" affordance.
      if (
        e.key.toLowerCase() === 'c' &&
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey
      ) {
        // Only hijack when there's no active text selection AND
        // focus is inside the popover or on the source tile.
        // Anywhere else, let the browser handle Cmd+C normally.
        const sel = window.getSelection();
        const hasSelection = sel && sel.toString().trim().length > 0;
        if (hasSelection) return;
        const popover = document.querySelector('.library__hover-preview');
        const focusedTile = (target as HTMLElement | null)?.closest(
          '.library__tile',
        );
        const focusedId = focusedTile?.getAttribute('data-artifact-id');
        const inPopover =
          popover && target && popover.contains(target);
        const onSourceTile = focusedId === hoverPreview.row.id;
        if (!inPopover && !onSourceTile) return;
        e.preventDefault();
        const title = hoverPreview.row.title;
        void navigator.clipboard
          .writeText(title)
          .then(() => showToast(`Copied "${title.slice(0, 32)}${title.length > 32 ? '…' : ''}"`, 'ok'))
          .catch(() => showToast('Copy failed', 'err'));
        return;
      }
      // Cmd/Ctrl+Shift+C — deeper variant of the title-copy
      // shortcut. Same scoping rules (must be inside the popover
      // or on the source tile, no active text selection) but
      // grabs the R2 key instead. The key is the canonical
      // pointer for any worker call, scripting against the
      // artifact, or piping into wrangler — surfacing it on a
      // keystroke avoids the menu trip. Stubs don't have a real
      // R2 object yet, so we fall back to a toast that explains
      // why nothing landed on the clipboard.
      if (
        e.key.toLowerCase() === 'c' &&
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        !e.altKey
      ) {
        const sel = window.getSelection();
        const hasSelection = sel && sel.toString().trim().length > 0;
        if (hasSelection) return;
        const popover = document.querySelector('.library__hover-preview');
        const focusedTile = (target as HTMLElement | null)?.closest(
          '.library__tile',
        );
        const focusedId = focusedTile?.getAttribute('data-artifact-id');
        const inPopover =
          popover && target && popover.contains(target);
        const onSourceTile = focusedId === hoverPreview.row.id;
        if (!inPopover && !onSourceTile) return;
        e.preventDefault();
        const row = hoverPreview.row;
        if (row.id.startsWith('stub-')) {
          showToast('Stub row has no R2 key yet', 'err');
          return;
        }
        const r2Key = row.key;
        void navigator.clipboard
          .writeText(r2Key)
          .then(() =>
            showToast(
              `Copied key "${r2Key.length > 36 ? `…${r2Key.slice(-36)}` : r2Key}"`,
              'ok',
            ),
          )
          .catch(() => showToast('Copy failed', 'err'));
        return;
      }
      // Tab from the focused tile (the popover's anchor) → land on
      // the popover's first focusable child. Without this the
      // natural Tab order would walk to the next tile, skipping
      // the popover entirely. Shift+Tab gets the same treatment so
      // the user can reach the popover from the tile in either
      // direction without an explicit click.
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const focusedTile = (target as HTMLElement | null)?.closest(
          '.library__tile',
        );
        if (!focusedTile) return;
        const focusedId = focusedTile.getAttribute('data-artifact-id');
        if (focusedId !== hoverPreview.row.id) return;
        const popover = document.querySelector('.library__hover-preview');
        if (!popover) return;
        const focusable = popover.querySelector<HTMLElement>(
          'button, a, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable) {
          e.preventDefault();
          focusable.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hoverPreview]);
  // Schedule a deferred clear — gives the user 120ms to move the
  // cursor from the tile into the popover. The popover's own
  // mouseenter cancels this timer; its mouseleave clears the popover
  // immediately. Without the grace step the popover dies as soon as
  // the cursor crosses the tile boundary, making its contents
  // un-interactable.
  const scheduleHoverClear = () => {
    if (hoverGraceRef.current) {
      window.clearTimeout(hoverGraceRef.current);
    }
    hoverGraceRef.current = window.setTimeout(() => {
      hoverGraceRef.current = null;
      snippetAbortRef.current?.abort();
      setHoverPreview(null);
    }, 120);
  };
  const cancelHoverClear = () => {
    if (hoverGraceRef.current) {
      window.clearTimeout(hoverGraceRef.current);
      hoverGraceRef.current = null;
    }
  };

  const [contextMenu, setContextMenu] = useState<{
    row: ArtifactRow;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('.library__ctxmenu')) return;
      setContextMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setContextMenu(null);
        return;
      }
      // Arrow-key navigation inside the context menu — once
      // focus is in the menu (auto-focused on open, see below),
      // Up/Down walks items, Home/End jump to first/last, and
      // Enter/Space activate the focused item. The browser
      // already handles Enter/Space as button clicks, so we
      // only need to wire arrow keys here.
      const menuEl = document.querySelector('.library__ctxmenu');
      if (!menuEl) return;
      const items = Array.from(
        menuEl.querySelectorAll<HTMLElement>('.library__ctxmenu-item'),
      );
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? items.indexOf(active) : -1;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        // Cycle forward — wraps from last → first so the user
        // can sweep the menu in one direction without lifting
        // their finger.
        items[(idx + 1 + items.length) % items.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        // Cycle backward — same wrap behavior. Starts from the
        // last item when nothing is focused yet, which is the
        // natural "I'm typing my way up from the bottom"
        // expectation.
        const start = idx < 0 ? 0 : idx;
        items[(start - 1 + items.length) % items.length]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1]?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Auto-focus the first menu item on the next paint frame so
    // the user can immediately Tab / arrow-walk without a
    // separate click. rAF defers past the open transition so the
    // focus call lands after React has rendered the menu DOM.
    let frame = 0;
    frame = window.requestAnimationFrame(() => {
      const first = document.querySelector<HTMLElement>(
        '.library__ctxmenu .library__ctxmenu-item',
      );
      first?.focus();
    });
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [contextMenu]);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} artifact${selected.size === 1 ? '' : 's'}? This is permanent.`)) {
      return;
    }
    setDeleting(true);
    const keys = rows.filter((r) => selected.has(r.id)).map((r) => r.key);
    try {
      const res = await fetch('/api/artifacts/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
      });
      const data = (await res.json()) as { ok: boolean; deleted?: number };
      if (data.ok) {
        setRows((prev) => prev.filter((r) => !selected.has(r.id)));
        showToast(`Deleted ${data.deleted ?? selected.size} artifact${selected.size === 1 ? '' : 's'}`, 'ok');
        setSelected(new Set());
        setSelectMode(false);
      } else {
        showToast('Delete failed', 'err');
      }
    } catch {
      showToast('Delete failed', 'err');
    } finally {
      setDeleting(false);
    }
  };

  // Bulk download — kick off a sequential download for each selected
  // artifact, plus a manifest.json with the canonical metadata so the
  // user has a record of what was pulled and the original R2 keys.
  // We use a small delay between anchors so browsers don't drop later
  // downloads as a popup-blocker false-positive.
  const [downloading, setDownloading] = useState(false);
  // Per-bundle progress: { done, total } so the bulk action bar can
  // render a real progress bar instead of "Bundling…". Reset to null
  // when no download is in flight so the bar disappears between runs.
  const [downloadProgress, setDownloadProgress] = useState<{
    done: number;
    total: number;
    failed: number;
  } | null>(null);
  const downloadSelected = async () => {
    if (selected.size === 0) return;
    const picks = rows.filter((r) => selected.has(r.id));
    setDownloading(true);
    setDownloadProgress({ done: 0, total: picks.length, failed: 0 });
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      // Fetch each artifact body as raw bytes in parallel cohorts of 6
      // so we don't slam the worker with a hundred parallel R2 reads.
      // Failed fetches are skipped (counted into the toast at the end).
      const entries: Array<{ name: string; data: Uint8Array }> = [];
      let failed = 0;
      const used = new Map<string, number>();
      const cohort = 6;
      for (let i = 0; i < picks.length; i += cohort) {
        const batch = picks.slice(i, i + cohort);
        const resolved = await Promise.all(
          batch.map(async (p) => {
            try {
              const res = await fetch(
                `/api/artifacts/${encodeURIComponent(p.key)}`,
              );
              if (!res.ok) return null;
              const buf = new Uint8Array(await res.arrayBuffer());
              // Resolve a flat filename — prefer the R2 key's basename
              // (preserves extension); fall back to the title with the
              // R2 key's extension grafted on if there is one.
              const keyBase = p.key.split('/').pop() || `artifact-${i + 1}`;
              const baseExt = keyBase.includes('.')
                ? keyBase.slice(keyBase.lastIndexOf('.'))
                : '';
              const titleSafe =
                p.title
                  .replace(/[\\/:*?"<>|]/g, '_')
                  .replace(/\s+/g, ' ')
                  .trim() || keyBase.replace(baseExt, '');
              let name =
                titleSafe.toLowerCase().endsWith(baseExt.toLowerCase())
                  ? titleSafe
                  : `${titleSafe}${baseExt}`;
              // Dedupe within the zip (two artifacts with the same
              // title would otherwise collide).
              const n = (used.get(name) ?? 0) + 1;
              used.set(name, n);
              if (n > 1) {
                name = name.includes('.')
                  ? name.replace(/(\.[^.]+)$/, ` (${n})$1`)
                  : `${name} (${n})`;
              }
              return { name, data: buf };
            } catch {
              return null;
            }
          }),
        );
        for (const r of resolved) {
          if (r) entries.push(r);
          else failed += 1;
        }
        // Advance the progress meter after each cohort. Use a fresh
        // object so React sees a state change (the previous progress
        // value is captured in the closure as `prev`).
        setDownloadProgress((prev) =>
          prev
            ? {
                done: Math.min(prev.total, entries.length),
                total: prev.total,
                failed,
              }
            : prev,
        );
      }
      // Embed a manifest.json alongside the artifacts so the recipient
      // has the original metadata (title, type, version, R2 key,
      // uploadedAt) for each entry.
      const manifest = {
        agent: agentName,
        exportedAt: new Date().toISOString(),
        artifacts: picks.map((p) => ({
          key: p.key,
          title: p.title,
          type: p.type,
          version: p.version,
          size: p.size,
          uploadedAt: new Date(p.uploadedAt).toISOString(),
        })),
      };
      entries.unshift({
        name: 'manifest.json',
        data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
      });

      const zipBlob = buildZipBlob(entries);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${agentName || 'library'}-export-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 500);
      showToast(
        failed > 0
          ? `Exported ${entries.length - 1} · ${failed} failed`
          : `Exported ${entries.length - 1} artifact${entries.length - 1 === 1 ? '' : 's'} as zip`,
        failed > 0 ? 'info' : 'ok',
      );
    } catch {
      showToast('Download failed', 'err');
    } finally {
      setDownloading(false);
      // Hold the meter at 100% for a beat so the user sees a clean
      // completion state before it disappears.
      window.setTimeout(() => setDownloadProgress(null), 600);
    }
  };

  useEffect(() => {
    setLoading(true);
    void fetch(`/api/artifacts/list/${encodeURIComponent(agentName || 'default')}`)
      .then((r) => r.json())
      .then((data: { artifacts: ArtifactRow[]; source: 'r2' | 'stub' }) => {
        setRows(sortArtifacts(data.artifacts));
        setSource(data.source);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [agentName]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((a) => {
      if (filter === 'starred') {
        if (!a.starred) return false;
      } else if (filter !== 'all' && a.type !== filter) {
        return false;
      }
      // Tag filter AND-merges with the type filter. Each active tag
      // must be present on the artifact's tag list.
      if (activeTagFilter.size > 0) {
        if (!Array.isArray(a.tags) || a.tags.length === 0) return false;
        for (const want of activeTagFilter) {
          if (!a.tags.includes(want)) return false;
        }
      }
      if (!q) return true;
      return a.title.toLowerCase().includes(q) || a.key.toLowerCase().includes(q);
    });
  }, [rows, filter, query, activeTagFilter]);

  // User-curated tag order — drag-reorder of the filter chip row
  // persists here so the user's preferred sort sticks across reloads.
  // Tags listed appear in that exact order; tags missing from this
  // list fall back to the frequency-sorted tail.
  const [tagOrder, setTagOrder] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem('openthink:library-tag-order');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === 'string').slice(0, 200)
        : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (tagOrder.length === 0) {
      window.localStorage.removeItem('openthink:library-tag-order');
    } else {
      window.localStorage.setItem(
        'openthink:library-tag-order',
        JSON.stringify(tagOrder),
      );
    }
  }, [tagOrder]);
  // Drag state — track the tag currently being dragged + the tag
  // it's hovering over so the chip row can render an insertion
  // indicator and dim the source. Both nulls between drags.
  const [draggingTag, setDraggingTag] = useState<string | null>(null);
  const [dragOverTag, setDragOverTag] = useState<string | null>(null);
  // Drag-to-tag visual cue — true while ANY tile is being dragged
  // (no need to track WHICH tile here; the dataTransfer carries the
  // id). When true, every tag chip lights up as a valid drop target
  // so the user can see where their tile will land before they
  // commit. Set by tile onDragStart, cleared by tile onDragEnd.
  const [tileDragging, setTileDragging] = useState(false);

  // Tag pool across all rows — drives the filter chip row above the
  // grid. Sorted by user-curated order first (tags in `tagOrder`),
  // then by frequency for the unknown tail. New tags introduced
  // after the order was saved just append in their freq position
  // without disturbing the curated head.
  const tagPool = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (!Array.isArray(r.tags)) continue;
      for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const orderIdx = new Map(tagOrder.map((t, i) => [t, i]));
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => {
        const ai = orderIdx.get(a.tag);
        const bi = orderIdx.get(b.tag);
        if (ai !== undefined && bi !== undefined) return ai - bi;
        // Curated tags always sort before uncurated ones so the
        // user's drag-arranged head stays anchored.
        if (ai !== undefined) return -1;
        if (bi !== undefined) return 1;
        return b.count - a.count || a.tag.localeCompare(b.tag);
      });
  }, [rows, tagOrder]);

  // Reorder helper — moves `dragged` to land immediately before
  // `target` in the curated array. If `target` is undefined the
  // dragged tag goes to the end. Inserts any not-yet-curated tags
  // into the order on first drag, so a single drag operation can
  // promote a previously-floating tag into the curated set.
  const reorderTags = (dragged: string, target: string | null) => {
    setTagOrder((prev) => {
      // Seed: every tag currently in the visible pool (so the order
      // captures the existing baseline before we move things). This
      // way the first drag persists the implicit frequency order
      // for everything the user didn't touch.
      const seeded =
        prev.length === 0
          ? tagPool.map((t) => t.tag)
          : (() => {
              const known = new Set(prev);
              const extra = tagPool
                .map((t) => t.tag)
                .filter((t) => !known.has(t));
              return [...prev, ...extra];
            })();
      const without = seeded.filter((t) => t !== dragged);
      if (target === null) return [...without, dragged];
      const idx = without.indexOf(target);
      if (idx < 0) return [...without, dragged];
      return [...without.slice(0, idx), dragged, ...without.slice(idx)];
    });
  };

  // Tag rename state — when set, the corresponding chip swaps to an
  // inline input. Confirm rewrites every artifact that carries the
  // old tag via per-artifact PUT calls in cohorts of 6. The
  // optimistic local pass updates the rows so the user sees the
  // result before the network round-trips settle.
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [renameTagDraft, setRenameTagDraft] = useState('');
  const sanitizeLibraryTag = (raw: string): string | null => {
    const t = raw
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);
    return t || null;
  };
  // Drag-to-tag handler — fired when an artifact tile is dropped on
  // a tag chip in the filter row. Single-artifact write so the cost
  // is one PUT regardless of where the drag started. Skipped when
  // the artifact already carries the tag (no-op). Confirmation
  // toast on success so the user gets feedback even though the
  // visible change (a tag added to a row off-screen) might not be
  // obvious otherwise. Optimistic local row update + rollback on
  // failure, matching the bulk-tag pattern.
  const addTagToArtifact = async (artifactId: string, tag: string) => {
    const row = rows.find((r) => r.id === artifactId);
    if (!row) {
      showToast('Tag drop missed — artifact not found', 'err');
      return;
    }
    const existing = Array.isArray(row.tags) ? row.tags : [];
    if (existing.includes(tag)) {
      // Already tagged — fire a gentle confirm rather than silently
      // doing nothing. Same shape as the no-op path in the bulk
      // flow.
      showToast(`Already tagged "${tag}"`, 'ok');
      return;
    }
    if (existing.length >= 12) {
      // Server-side cap is also 12 — surface the limit client-side
      // so the drop doesn't silently fail at the worker.
      showToast(`Tag limit reached (12) — drop ignored`, 'err');
      return;
    }
    const next = [...existing, tag];
    const snapshot = rows;
    setRows((prev) =>
      prev.map((r) => (r.id === artifactId ? { ...r, tags: next } : r)),
    );
    try {
      const res = await fetch(
        `/api/artifacts/${encodeURIComponent(artifactId)}/tags`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: next }),
        },
      );
      const data = (await res.json()) as { ok: boolean };
      if (!data.ok) throw new Error('save_failed');
      showToast(
        `Tagged "${row.title.slice(0, 32)}${row.title.length > 32 ? '…' : ''}" with ${tag}`,
        'ok',
      );
    } catch {
      setRows(snapshot);
      showToast('Drag-to-tag failed', 'err');
    }
  };

  // Drop a tag from every artifact that carries it. Destructive, so
  // we confirm first with the user — same KV mutation path as
  // renameTag but with an empty replacement instead of a swap.
  // Active filter also drops the tag so the visible set follows.
  const deleteTag = async (tag: string) => {
    const affected = rows.filter(
      (r) => Array.isArray(r.tags) && r.tags.includes(tag),
    );
    if (affected.length === 0) return;
    if (
      !window.confirm(
        `Remove the tag "${tag}" from ${affected.length} artifact${affected.length === 1 ? '' : 's'}? The artifacts themselves stay; only the tag goes.`,
      )
    ) {
      return;
    }
    const snapshot = rows;
    setRows((prev) =>
      prev.map((r) => {
        if (!Array.isArray(r.tags) || !r.tags.includes(tag)) return r;
        const next = r.tags.filter((t) => t !== tag);
        if (next.length === 0) {
          const { tags: _t, ...rest } = r;
          return rest as ArtifactRow;
        }
        return { ...r, tags: next };
      }),
    );
    setActiveTagFilter((prev) => {
      if (!prev.has(tag)) return prev;
      const next = new Set(prev);
      next.delete(tag);
      return next;
    });
    try {
      const cohort = 6;
      for (let i = 0; i < affected.length; i += cohort) {
        const batch = affected.slice(i, i + cohort);
        await Promise.all(
          batch.map((r) => {
            const next = (r.tags ?? []).filter((t) => t !== tag);
            return fetch(
              `/api/artifacts/${encodeURIComponent(r.id)}/tags`,
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags: next }),
              },
            );
          }),
        );
      }
      showToast(
        `Removed "${tag}" from ${affected.length} artifact${affected.length === 1 ? '' : 's'}`,
        'ok',
      );
    } catch {
      setRows(snapshot);
      showToast('Tag delete failed', 'err');
    }
  };

  const renameTag = async (oldTag: string, newTagRaw: string) => {
    const newTag = sanitizeLibraryTag(newTagRaw);
    if (!newTag) {
      showToast('Tag must be lowercase alphanum or hyphen', 'err');
      return;
    }
    if (newTag === oldTag) {
      setRenamingTag(null);
      return;
    }
    const affected = rows.filter(
      (r) => Array.isArray(r.tags) && r.tags.includes(oldTag),
    );
    if (affected.length === 0) {
      setRenamingTag(null);
      return;
    }
    const snapshot = rows;
    // Optimistic local replace — swap the old tag for the new one in
    // each affected artifact's tag list, de-duping in case the new
    // tag was already present.
    setRows((prev) =>
      prev.map((r) => {
        if (!Array.isArray(r.tags) || !r.tags.includes(oldTag)) return r;
        const next: string[] = [];
        const seen = new Set<string>();
        for (const t of r.tags) {
          const swapped = t === oldTag ? newTag : t;
          if (seen.has(swapped)) continue;
          seen.add(swapped);
          next.push(swapped);
        }
        return { ...r, tags: next };
      }),
    );
    // Same active-tag-filter swap so the user's filter doesn't break.
    setActiveTagFilter((prev) => {
      if (!prev.has(oldTag)) return prev;
      const next = new Set(prev);
      next.delete(oldTag);
      next.add(newTag);
      return next;
    });
    setRenamingTag(null);
    setRenameTagDraft('');
    try {
      const cohort = 6;
      for (let i = 0; i < affected.length; i += cohort) {
        const batch = affected.slice(i, i + cohort);
        await Promise.all(
          batch.map((r) => {
            const next: string[] = [];
            const seen = new Set<string>();
            for (const t of r.tags ?? []) {
              const swapped = t === oldTag ? newTag : t;
              if (seen.has(swapped)) continue;
              seen.add(swapped);
              next.push(swapped);
            }
            return fetch(
              `/api/artifacts/${encodeURIComponent(r.id)}/tags`,
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags: next }),
              },
            );
          }),
        );
      }
      showToast(
        `Renamed "${oldTag}" → "${newTag}" across ${affected.length} artifact${affected.length === 1 ? '' : 's'}`,
        'ok',
      );
    } catch {
      setRows(snapshot);
      showToast('Rename failed', 'err');
    }
  };

  // Select every non-stub artifact in the currently-filtered grid. Used by
  // the ⌘A/Ctrl+A shortcut while select mode is on.
  const selectAllVisible = () => {
    const ids = visible.filter((v) => !v.id.startsWith('stub-')).map((v) => v.id);
    setSelected(new Set(ids));
  };

  // Shift+click range select: take every non-stub item between the last
  // clicked tile and the target tile (inclusive) and turn them ON. Falls
  // back to a plain toggle when there's no anchor or one of the ids isn't
  // in the visible grid (e.g. filter changed since the last click).
  const selectRangeTo = (id: string) => {
    const anchor = lastClickedRef.current;
    if (!anchor) {
      toggleSelect(id);
      return;
    }
    const a = visible.findIndex((v) => v.id === anchor);
    const b = visible.findIndex((v) => v.id === id);
    if (a < 0 || b < 0) {
      toggleSelect(id);
      return;
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    setSelected((prev) => {
      const next = new Set(prev);
      for (let i = lo; i <= hi; i++) {
        const item = visible[i];
        if (item && !item.id.startsWith('stub-')) next.add(item.id);
      }
      return next;
    });
  };

  // Keyboard shortcuts that only matter while select mode is on:
  //   ⌘A / Ctrl+A   → select every non-stub visible tile
  //   Esc           → exit select mode + clear selection
  // We skip when the focus is in a text input so the user can still
  // ⌘A inside the search box.
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        if (inField) return;
        e.preventDefault();
        selectAllVisible();
      } else if (e.key === 'Escape') {
        if (inField) return;
        setSelected(new Set());
        setSelectMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // visible is referenced inside selectAllVisible — re-bind when it
    // changes so a fresh ⌘A picks the post-filter set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectMode, visible]);

  return (
    <div className="library">
      <header className="library__header">
        <h2>Library</h2>
        <p className="library__lede">
          Every artifact {agentName} has ever made.
          {source === 'stub' && ' · sample entries shown — your R2 bucket is empty so far'}
        </p>
      </header>
      <div className="library__filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`library__filter${filter === f.id ? ' library__filter--active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        <input
          className="ot-input library__search"
          placeholder="Search title or key…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className={`library__filter${selectMode ? ' library__filter--active' : ''}`}
          onClick={() => {
            setSelectMode((v) => !v);
            if (selectMode) setSelected(new Set());
          }}
          disabled={source === 'stub'}
          title={source === 'stub' ? 'Real artifacts needed to delete' : 'Bulk select'}
        >
          {selectMode ? 'Cancel' : 'Select'}
        </button>
      </div>
      {/* Tag filter strip — only renders when the user has tagged at
          least one artifact. Each chip toggles a tag into the active
          filter (AND semantics). Tags persisted via the per-tile
          bulk-tag flow + the worker's `artifact-tags:<key>` KV. */}
      {tagPool.length > 0 && (
        <div className="library__tag-filters" role="group" aria-label="Filter by tag">
          <span className="ot-micro library__tag-filters-label">tags</span>
          {tagPool.map(({ tag, count }) => {
            const isActive = activeTagFilter.has(tag);
            const isRenaming = renamingTag === tag;
            if (isRenaming) {
              return (
                <span key={tag} className="library__tag-chip library__tag-chip--editing">
                  <input
                    type="text"
                    className="library__tag-chip-input"
                    value={renameTagDraft}
                    autoFocus
                    onChange={(e) => setRenameTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void renameTag(tag, renameTagDraft);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setRenamingTag(null);
                        setRenameTagDraft('');
                      }
                    }}
                    onBlur={() => {
                      if (renameTagDraft && renameTagDraft !== tag) {
                        void renameTag(tag, renameTagDraft);
                      } else {
                        setRenamingTag(null);
                        setRenameTagDraft('');
                      }
                    }}
                    aria-label={`Rename tag ${tag}`}
                  />
                </span>
              );
            }
            const isDragging = draggingTag === tag;
            const isDragOver = dragOverTag === tag && draggingTag && draggingTag !== tag;
            return (
              <span
                key={tag}
                draggable
                className={`library__tag-chip-wrap${isDragging ? ' library__tag-chip-wrap--dragging' : ''}${isDragOver ? ' library__tag-chip-wrap--over' : ''}${tileDragging ? ' library__tag-chip-wrap--tile-target' : ''}`}
                onDragStart={(e) => {
                  setDraggingTag(tag);
                  // Carry the tag on the dataTransfer so external
                  // drag targets (none today, but future-proof) see
                  // the payload. Effect 'move' since we're
                  // reordering, not duplicating.
                  e.dataTransfer.setData('text/plain', tag);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => {
                  setDraggingTag(null);
                  setDragOverTag(null);
                }}
                onDragOver={(e) => {
                  // Two acceptable drop sources: a tag chip being
                  // reordered (handled by `draggingTag`), or an
                  // artifact tile being tagged. Inspect the
                  // dataTransfer types since the latter doesn't go
                  // through our drag-state machinery — it's an
                  // external-style payload from the tile.
                  const isTile = e.dataTransfer.types.includes(
                    'application/x-openthink-tile',
                  );
                  if (isTile) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    if (dragOverTag !== tag) setDragOverTag(tag);
                    return;
                  }
                  if (!draggingTag || draggingTag === tag) return;
                  // preventDefault here is what allows the drop to
                  // fire; without it the browser cancels the drop
                  // gesture as the cursor moves over the target.
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverTag !== tag) setDragOverTag(tag);
                }}
                onDragLeave={() => {
                  if (dragOverTag === tag) setDragOverTag(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  // Tile drop takes priority — if the dataTransfer
                  // carries a tile id, apply this tag to that
                  // artifact. Otherwise fall through to the
                  // tag-reorder path.
                  const tileId = e.dataTransfer.getData(
                    'application/x-openthink-tile',
                  );
                  setDragOverTag(null);
                  if (tileId) {
                    void addTagToArtifact(tileId, tag);
                    return;
                  }
                  const dragged = draggingTag;
                  setDraggingTag(null);
                  if (!dragged || dragged === tag) return;
                  reorderTags(dragged, tag);
                }}
                title={
                  isDragging
                    ? `Drop on another chip to set the order`
                    : `Drag to reorder · click to filter by ${tag}`
                }
              >
                <button
                  type="button"
                  className={`library__tag-chip${isActive ? ' library__tag-chip--active' : ''}`}
                  onClick={() => {
                    setActiveTagFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(tag)) next.delete(tag);
                      else next.add(tag);
                      return next;
                    });
                  }}
                  title={
                    isActive
                      ? `Stop filtering by ${tag}`
                      : `Show artifacts tagged ${tag} (${count})`
                  }
                >
                  {tag}
                  <span className="library__tag-chip-n">{count}</span>
                </button>
                <button
                  type="button"
                  className="library__tag-chip-rename"
                  onClick={() => {
                    setRenamingTag(tag);
                    setRenameTagDraft(tag);
                  }}
                  aria-label={`Rename tag ${tag}`}
                  title={`Rename "${tag}" across all ${count} artifact${count === 1 ? '' : 's'}`}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="library__tag-chip-delete"
                  onClick={() => void deleteTag(tag)}
                  aria-label={`Delete tag ${tag}`}
                  title={`Remove "${tag}" from all ${count} artifact${count === 1 ? '' : 's'}`}
                >
                  ×
                </button>
                {(() => {
                  // "Untag from selected" — only renders when the
                  // user is in select mode with ≥1 selected row and
                  // at least one of those rows carries this tag. The
                  // ⊟ icon visually distinguishes it from the all-
                  // affecting × delete: it removes the tag only
                  // from the highlighted rows.
                  if (!selectMode || selected.size === 0) return null;
                  const selectedWithTag = rows.filter(
                    (r) =>
                      selected.has(r.id) &&
                      Array.isArray(r.tags) &&
                      r.tags.includes(tag),
                  );
                  if (selectedWithTag.length === 0) return null;
                  return (
                    <button
                      type="button"
                      className="library__tag-chip-untag-selected"
                      onClick={() => {
                        // Pre-stage the bulk-untag flow: drop this
                        // single tag into the bulk-tag draft and
                        // invoke the existing removeBulkTags
                        // helper. Reusing that path keeps the
                        // confirmation copy + per-row cohort
                        // semantics consistent with the bulk-tag
                        // toolbar's Remove button.
                        setBulkTagDraft(tag);
                        // Fire-and-forget — removeBulkTags reads
                        // the draft itself; we just need the
                        // setState to land first. queueMicrotask
                        // is enough to let React flush.
                        window.queueMicrotask(() => {
                          void removeBulkTags();
                        });
                      }}
                      aria-label={`Remove tag ${tag} from ${selectedWithTag.length} selected artifact${selectedWithTag.length === 1 ? '' : 's'}`}
                      title={`Remove "${tag}" from the ${selectedWithTag.length} selected artifact${selectedWithTag.length === 1 ? '' : 's'} that carry it`}
                    >
                      ⊟ {selectedWithTag.length}
                    </button>
                  );
                })()}
              </span>
            );
          })}
          {activeTagFilter.size > 0 && (
            <button
              type="button"
              className="library__tag-chip library__tag-chip--clear"
              onClick={() => setActiveTagFilter(new Set())}
            >
              × clear
            </button>
          )}
          {tagOrder.length > 0 && (
            <button
              type="button"
              className="library__tag-chip library__tag-chip--reset-order"
              onClick={() => {
                if (
                  window.confirm(
                    'Reset tag order? Chips will go back to frequency sort.',
                  )
                ) {
                  setTagOrder([]);
                  showToast('Tag order reset', 'ok');
                }
              }}
              title="Drop the curated drag order and sort tags by usage frequency again"
            >
              ↺ reset order
            </button>
          )}
        </div>
      )}
      {selectMode && (
        <div className="library__bulk">
          <span className="library__bulk-count">
            {selected.size === 0
              ? 'Click tiles · Shift+click or Shift+arrows for range · ⌘A for all'
              : `${selected.size} selected`}
          </span>
          <button
            type="button"
            className="ot-btn ot-btn--ghost"
            disabled={deleting || downloading}
            onClick={() => selectAllVisible()}
            title="Select every artifact currently shown (⌘A)"
          >
            Select all
          </button>
          {(() => {
            // Determine whether the selected set is fully starred — if
            // so, the bulk button unstars; otherwise it stars (idempotent
            // for items already starred).
            const picks = rows.filter((r) => selected.has(r.id));
            const allStarred = picks.length > 0 && picks.every((p) => p.starred);
            const nextStar = !allStarred;
            return (
              <button
                type="button"
                className="ot-btn ot-btn--ghost"
                disabled={
                  selected.size === 0 || starringBulk || downloading || deleting
                }
                onClick={() => void bulkStar(nextStar)}
                title={nextStar ? 'Star every selected artifact' : 'Unstar every selected artifact'}
              >
                {starringBulk
                  ? 'Saving…'
                  : `${nextStar ? '★' : '☆'} ${nextStar ? 'Star' : 'Unstar'} ${selected.size || ''}`}
              </button>
            );
          })()}
          <button
            type="button"
            className="ot-btn ot-btn--ghost"
            disabled={selected.size === 0 || downloading || deleting}
            onClick={() => void downloadSelected()}
            title="Bundle selected artifacts + manifest.json into a single .zip"
          >
            {downloading ? 'Bundling…' : `Zip ${selected.size || ''} ↓`}
          </button>
          <button
            type="button"
            className="ot-btn"
            disabled={selected.size === 0 || deleting || downloading}
            onClick={() => void deleteSelected()}
          >
            {deleting ? 'Deleting…' : `Delete ${selected.size || ''}`}
          </button>
        </div>
      )}
      {/* Bulk-tag input — visible only in select mode AND when the
          user has picked ≥1 artifacts. Tags UNION into each selected
          artifact's existing list so the bulk action is additive,
          matching the Knowledge bulk-tag flow. */}
      {selectMode && selected.size > 0 && (
        <div className="library__bulk-tag">
          <input
            type="text"
            className="ot-input library__bulk-tag-input"
            placeholder="Add tags to every selected artifact (space- or comma-separated)…"
            value={bulkTagDraft}
            onChange={(e) => setBulkTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && bulkTagDraft.trim() && !bulkTagBusy) {
                e.preventDefault();
                void applyBulkTags();
              }
            }}
            disabled={bulkTagBusy}
          />
          <button
            type="button"
            className="ot-btn ot-btn--ghost"
            onClick={() => void applyBulkTags()}
            disabled={bulkTagBusy || !bulkTagDraft.trim()}
            title="Add the typed tags to every selected artifact"
          >
            {bulkTagBusy ? 'Tagging…' : 'Add tags'}
          </button>
          <button
            type="button"
            className="ot-btn ot-btn--ghost library__bulk-tag-remove"
            onClick={() => void removeBulkTags()}
            disabled={bulkTagBusy || !bulkTagDraft.trim()}
            title="Remove the typed tags from every selected artifact that carries them"
          >
            {bulkTagBusy ? 'Removing…' : 'Remove tags'}
          </button>
        </div>
      )}
      {/* Bundle progress meter — fills as cohorts complete. Stays
          visible for ~600ms after the zip lands so the user sees a
          clean 100% state before it disappears. */}
      {downloadProgress && downloadProgress.total > 0 && (
        <div className="library__bundle-progress" role="status" aria-live="polite">
          <div className="library__bundle-progress-bar">
            <div
              className="library__bundle-progress-fill"
              style={{
                width: `${Math.round(
                  (downloadProgress.done / downloadProgress.total) * 100,
                )}%`,
              }}
            />
          </div>
          <span className="library__bundle-progress-label ot-micro">
            Bundling {downloadProgress.done} / {downloadProgress.total}
            {downloadProgress.failed > 0 &&
              ` · ${downloadProgress.failed} failed`}
          </span>
        </div>
      )}
      {loading ? (
        <div className="library__grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="library__tile library__tile--skeleton">
              <div className="library__tile-thumb" />
              <div className="library__tile-meta">
                <span className="library__tile-title library__skel-line" />
                <span className="library__tile-sub library__skel-line library__skel-line--short" />
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="ot-empty">
          <span className="ot-empty__glyph" aria-hidden>
            ◇
          </span>
          <h3 className="ot-empty__title">
            {query.trim() || filter !== 'all'
              ? 'No artifacts match this filter'
              : `${agentName} hasn't made anything yet`}
          </h3>
          <p className="ot-empty__body">
            Documents, code, charts, slides, browser sessions — anything the agent
            produces lands here automatically.
          </p>
          {query.trim() && (() => {
            // Did-you-mean: when the user's search has no results,
            // surface up to 3 row titles whose Levenshtein distance is
            // small relative to the query. Helps a typo land on the
            // intended artifact without retyping.
            const q = query.trim().toLowerCase();
            const candidates: Array<{ row: ArtifactRow; dist: number }> = [];
            for (const r of rows) {
              if (r.id.startsWith('stub-')) continue;
              const t = r.title.toLowerCase();
              const dist = libraryEditDistance(q, t);
              // Accept anything where the cost is ≤ 1/3 of the query
              // length (or ≤ 4 chars for short queries). Keeps the list
              // tight — only real near-misses.
              const cap = Math.max(4, Math.floor(q.length / 3));
              if (dist <= cap) candidates.push({ row: r, dist });
            }
            candidates.sort((a, b) => a.dist - b.dist);
            const top = candidates.slice(0, 3);
            if (top.length === 0) return null;
            return (
              <div className="library__did-you-mean">
                <span className="ot-micro">Did you mean</span>
                {top.map(({ row }) => (
                  <button
                    key={row.id}
                    type="button"
                    className="library__did-you-mean-chip"
                    onClick={() => setQuery(row.title)}
                    title={`Match: "${row.title}"`}
                  >
                    {row.title}
                  </button>
                ))}
              </div>
            );
          })()}
          <div className="ot-empty__actions">
            <button
              className="ot-btn"
              type="button"
              onClick={() => onOpen('__new__')}
            >
              Start a task →
            </button>
            {(query.trim() || filter !== 'all') && (
              <button
                className="ot-btn ot-btn--ghost"
                type="button"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="library__grid">
          {visible.map((a) => {
            const isSelected = selected.has(a.id);
            const isStub = a.id.startsWith('stub-');
            const toggleStar = async () => {
              const next = !a.starred;
              // Optimistic local flip + canonical re-sort.
              setRows((prev) =>
                sortArtifacts(
                  prev.map((r) => (r.id === a.id ? { ...r, starred: next } : r)),
                ),
              );
              try {
                await fetch(
                  `/api/artifacts/${encodeURIComponent(a.key)}/star`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ starred: next }),
                  },
                );
              } catch {
                /* keep optimistic; next refresh will reconcile */
              }
            };
            // Title attribute surfaces the row name plus the
            // grid-only chord we wired in tick 44 — without an
            // in-UI hint, the Cmd+Shift+Click R2-key copy was
            // discoverable only from the popover footer. We
            // suppress the chord hint on stubs (no key) and in
            // select-mode (Shift modifies range-select instead).
            const tileTitle = isStub
              ? a.title
              : selectMode
                ? `${a.title} · Shift+click to range-select`
                : `${a.title} · ⌘/Ctrl+Shift+Click copies R2 key`;
            return (
              <div
                key={a.id}
                data-artifact-id={a.id}
                draggable={!isStub}
                title={tileTitle}
                onDragStart={(e) => {
                  if (isStub) {
                    e.preventDefault();
                    return;
                  }
                  // Custom MIME type so tag-chip drop targets can
                  // distinguish a tile drop (apply a tag) from a
                  // tag-chip drop (reorder). Also seed text/plain
                  // with the title for any future external drop
                  // targets that might want a sensible default.
                  e.dataTransfer.setData('application/x-openthink-tile', a.id);
                  e.dataTransfer.setData('text/plain', a.title);
                  e.dataTransfer.effectAllowed = 'copy';
                  // Light up the tag-chip row as a visible drop-
                  // target hint while the drag is in flight.
                  setTileDragging(true);
                }}
                onDragEnd={() => {
                  setTileDragging(false);
                  // Drag cancelled mouseleave events on some browsers —
                  // make sure the hover preview clears so it doesn't
                  // strand a popover after a drop.
                  clearHover();
                }}
                onMouseEnter={(e) => {
                  // Suppress hover preview during drag + select-mode +
                  // when the context menu is up — three concurrent
                  // overlays on one tile is too much chrome. Stubs
                  // don't have meaningful metadata so we skip them
                  // too.
                  if (
                    isStub ||
                    tileDragging ||
                    selectMode ||
                    contextMenu !== null
                  ) {
                    return;
                  }
                  const target = e.currentTarget;
                  if (hoverTimerRef.current) {
                    window.clearTimeout(hoverTimerRef.current);
                  }
                  hoverTimerRef.current = window.setTimeout(() => {
                    const r = target.getBoundingClientRect();
                    setHoverPreview({
                      row: a,
                      rect: {
                        left: r.left,
                        top: r.top,
                        right: r.right,
                        bottom: r.bottom,
                      },
                    });
                    // Fire the snippet fetch in parallel with the
                    // popover render so the user doesn't see a flash
                    // of empty space if the network is quick.
                    ensureSnippet(a);
                    hoverTimerRef.current = null;
                  }, 350);
                }}
                onMouseLeave={() => {
                  // Drop any pending hover-spawn timer immediately —
                  // we don't want a popover materializing AFTER the
                  // user has already left the tile.
                  if (hoverTimerRef.current) {
                    window.clearTimeout(hoverTimerRef.current);
                    hoverTimerRef.current = null;
                  }
                  // If a popover is already up, give the user a 120ms
                  // grace window to slide into it before we clear.
                  if (hoverPreview) {
                    scheduleHoverClear();
                  }
                }}
                className={`library__tile${isSelected ? ' library__tile--selected' : ''}${selectMode ? ' library__tile--selectable' : ''}${a.starred ? ' library__tile--starred' : ''}`}
                onClick={(e) => {
                  // Cmd/Ctrl+Shift+Click on a tile copies its R2
                  // key directly — parity with the popover-only
                  // Cmd+Shift+C shortcut, but reachable without
                  // having to hover-into the preview first. Power
                  // users who want to grab keys from the grid
                  // (wrangler scripts, debugging, sharing pointers)
                  // can chord directly on the tile. Stubs don't
                  // have a key yet, so we surface a toast instead
                  // of silently failing. We bail before selectMode
                  // and the open/setViewing branches so the chord
                  // doesn't accidentally toggle selection or pop
                  // the preview pane.
                  if (
                    e.shiftKey &&
                    (e.metaKey || e.ctrlKey) &&
                    !e.altKey
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isStub) {
                      showToast('Stub row has no R2 key yet', 'err');
                      return;
                    }
                    void navigator.clipboard
                      .writeText(a.key)
                      .then(() =>
                        showToast(
                          `Copied key "${a.key.length > 36 ? `…${a.key.slice(-36)}` : a.key}"`,
                          'ok',
                        ),
                      )
                      .catch(() => showToast('Copy failed', 'err'));
                    return;
                  }
                  if (selectMode) {
                    if (isStub) return;
                    if (e.shiftKey) {
                      selectRangeTo(a.id);
                    } else {
                      toggleSelect(a.id);
                    }
                    // Always remember the latest click as the next range
                    // anchor — Finder-style.
                    lastClickedRef.current = a.id;
                    return;
                  }
                  if (isStub) {
                    onOpen(a.id);
                  } else {
                    setViewing(a);
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  // Enter / Space — activate the focused tile (open or
                  // toggle-select, matching the click handler above).
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).click();
                    return;
                  }
                  // Arrow keys + Home/End — grid-aware focus movement.
                  // Column count is read from the live DOM (offsetTop
                  // breakpoint), so this Just Works across viewport
                  // resizes and the CSS auto-fill grid track count.
                  const NAV_KEYS = [
                    'ArrowLeft',
                    'ArrowRight',
                    'ArrowUp',
                    'ArrowDown',
                    'Home',
                    'End',
                  ];
                  if (!NAV_KEYS.includes(e.key)) return;
                  const grid = (e.currentTarget as HTMLElement).parentElement;
                  if (!grid) return;
                  const tiles = Array.from(
                    grid.querySelectorAll<HTMLElement>('.library__tile'),
                  );
                  const idx = tiles.indexOf(e.currentTarget as HTMLElement);
                  if (idx < 0 || tiles.length === 0) return;
                  e.preventDefault();
                  // Walk forward from the first tile until offsetTop
                  // changes — that's our column count for the current
                  // viewport. Single-row grids collapse to cols = length.
                  let cols = tiles.length;
                  const firstTop = tiles[0]!.offsetTop;
                  for (let i = 1; i < tiles.length; i++) {
                    if (tiles[i]!.offsetTop !== firstTop) {
                      cols = i;
                      break;
                    }
                  }
                  let target = idx;
                  if (e.key === 'ArrowLeft') {
                    target = Math.max(0, idx - 1);
                  } else if (e.key === 'ArrowRight') {
                    target = Math.min(tiles.length - 1, idx + 1);
                  } else if (e.key === 'ArrowUp') {
                    target = idx - cols < 0 ? idx : idx - cols;
                  } else if (e.key === 'ArrowDown') {
                    target =
                      idx + cols >= tiles.length ? idx : idx + cols;
                  } else if (e.key === 'Home') {
                    target = 0;
                  } else if (e.key === 'End') {
                    target = tiles.length - 1;
                  }
                  if (target !== idx) {
                    tiles[target]?.focus();
                    // Bring the newly-focused tile into view if the
                    // grid is taller than the viewport. `nearest` keeps
                    // the page from jumping when the tile is already
                    // visible.
                    tiles[target]?.scrollIntoView({
                      block: 'nearest',
                      inline: 'nearest',
                    });
                    // Shift+arrow → extend the selection from the
                    // anchor (last-clicked tile) to the new focused
                    // tile. Finder-style range select. Falls back to
                    // anchoring on the current tile when no prior
                    // click exists. Only fires in select mode + on
                    // tiles with real R2 keys (stubs can't be
                    // selected, and bulk actions skip them anyway).
                    if (e.shiftKey && selectMode) {
                      const targetTile = tiles[target];
                      const targetId = targetTile?.getAttribute('data-artifact-id');
                      // Re-read non-stub via the row payload — the
                      // tile DOM doesn't know it's a stub, but the
                      // `visible` list does. Reach into the
                      // closure's `a` (current tile) only for anchor
                      // fallback; the target id comes from the DOM
                      // attribute so we don't have to map idx → row.
                      if (targetId && !targetId.startsWith('stub-')) {
                        if (!lastClickedRef.current) {
                          lastClickedRef.current = a.id;
                        }
                        selectRangeTo(targetId);
                      }
                    }
                  }
                }}
                onContextMenu={(e) => {
                  // Right-click → context menu. Stubs don't have a real
                  // R2 key so we skip them — there's nothing the menu
                  // could meaningfully do.
                  if (isStub) return;
                  e.preventDefault();
                  setContextMenu({ row: a, x: e.clientX, y: e.clientY });
                }}
              >
                {selectMode && !isStub && (
                  <span
                    className={`library__tile-check${isSelected ? ' library__tile-check--on' : ''}`}
                    aria-hidden
                  >
                    {isSelected ? '✓' : ''}
                  </span>
                )}
                {!selectMode && !isStub && (
                  <button
                    type="button"
                    className={`library__tile-star${a.starred ? ' library__tile-star--on' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleStar();
                    }}
                    aria-label={a.starred ? 'Unstar' : 'Star'}
                    title={a.starred ? 'Unstar' : 'Star'}
                  >
                    {a.starred ? '★' : '☆'}
                  </button>
                )}
                <LibraryTileThumb artifact={a} isStub={isStub} />
                <div className="library__tile-meta">
                  <span className="library__tile-title">{a.title}</span>
                  <span className="library__tile-sub">
                    {a.type} · v{a.version} · {formatBytes(a.size)}
                  </span>
                  <span className="library__tile-age ot-micro">
                    {relTime(a.uploadedAt)}
                  </span>
                  {Array.isArray(a.tags) && a.tags.length > 0 && (
                    <div className="library__tile-tags">
                      {a.tags.slice(0, 4).map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={`library__tile-tag${activeTagFilter.has(t) ? ' library__tile-tag--active' : ''}`}
                          onClick={(ev) => {
                            // Don't open the artifact preview when
                            // clicking the tag chip — toggle the
                            // global filter instead.
                            ev.stopPropagation();
                            setActiveTagFilter((prev) => {
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
                      {a.tags.length > 4 && (
                        <span className="library__tile-tag library__tile-tag--more">
                          +{a.tags.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {viewing && (() => {
        // Walk the same `visible` list the grid is showing so ← / → respect
        // the user's filter + search. Stub rows have already been routed to
        // the chat by the click handler — they never end up in `viewing`,
        // so we don't need to filter them out here.
        const idx = visible.findIndex((a) => a.id === viewing.id);
        const total = visible.length;
        return (
          <ArtifactPreview
            source={viewing.key}
            title={viewing.title}
            meta={`${viewing.type} · v${viewing.version} · ${formatBytes(viewing.size)} · ${viewing.key}`}
            onClose={() => setViewing(null)}
            position={idx >= 0 ? { index: idx, total } : undefined}
            onPrev={idx > 0 ? () => setViewing(visible[idx - 1]!) : undefined}
            onNext={idx >= 0 && idx < total - 1 ? () => setViewing(visible[idx + 1]!) : undefined}
            onRename={async (next) => {
              // PATCH writes the title override to KV under
              // `artifact-title:<r2 key>`; the next list refresh picks it
              // up via the override pre-check in the list endpoint.
              try {
                const res = await fetch(
                  `/api/artifacts/${encodeURIComponent(viewing.key)}`,
                  {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: next }),
                  },
                );
                const data = (await res.json()) as { ok: boolean };
                if (data.ok) {
                  setRows((prev) =>
                    prev.map((r) =>
                      r.id === viewing.id ? { ...r, title: next } : r,
                    ),
                  );
                  setViewing((cur) => (cur ? { ...cur, title: next } : cur));
                  showToast('Renamed', 'ok');
                  return true;
                }
                showToast('Rename failed', 'err');
                return false;
              } catch {
                showToast('Rename failed', 'err');
                return false;
              }
            }}
          />
        );
      })()}
      {hoverPreview && (() => {
        // Floating popover anchored to the hovered tile. Prefers the
        // right side; flips to the left when the tile is near the
        // viewport's right edge. Vertical: tries top-align with the
        // tile, then drops to fit when overflow would clip.
        const a = hoverPreview.row;
        const PANEL_W = 280;
        const PANEL_H = 220;
        const GUTTER = 12;
        const vw =
          typeof window !== 'undefined' ? window.innerWidth : 1024;
        const vh =
          typeof window !== 'undefined' ? window.innerHeight : 768;
        const wantRight = hoverPreview.rect.right + GUTTER + PANEL_W <= vw;
        const left = wantRight
          ? hoverPreview.rect.right + GUTTER
          : Math.max(8, hoverPreview.rect.left - GUTTER - PANEL_W);
        const top = Math.max(
          8,
          Math.min(vh - PANEL_H - 8, hoverPreview.rect.top),
        );
        const tags = Array.isArray(a.tags) ? a.tags : [];
        const ageMs = Date.now() - a.uploadedAt;
        const ageHuman =
          ageMs < 60_000
            ? 'just now'
            : ageMs < 3_600_000
              ? `${Math.round(ageMs / 60_000)}m ago`
              : ageMs < 86_400_000
                ? `${Math.round(ageMs / 3_600_000)}h ago`
                : `${Math.round(ageMs / 86_400_000)}d ago`;
        return (
          <div
            className="library__hover-preview"
            style={{ left, top }}
            role="tooltip"
            aria-hidden
            onMouseEnter={() => {
              // Cancel the deferred clear from the tile mouseleave so
              // the popover stays alive while the cursor is in it —
              // lets the user select / copy the R2 key, click into
              // a tag (future), etc.
              cancelHoverClear();
            }}
            onMouseLeave={() => {
              // Leaving the popover always clears immediately. The
              // user gave up on the interaction.
              clearHover();
            }}
          >
            <div className="library__hover-preview-head">
              <span className="library__hover-preview-type ot-micro">
                {a.type}
              </span>
              <span className="library__hover-preview-age ot-micro">
                {ageHuman}
              </span>
            </div>
            <h4 className="library__hover-preview-title">{a.title}</h4>
            <dl className="library__hover-preview-meta">
              <dt>Size</dt>
              <dd>{formatBytes(a.size)}</dd>
              <dt>Version</dt>
              <dd>v{a.version}</dd>
              <dt>Uploaded</dt>
              <dd>{new Date(a.uploadedAt).toLocaleString()}</dd>
              {(() => {
                // Owning workspace — derived from the R2 key prefix
                // (`artifacts/<agentId>/<filename>`). The agentId is
                // the closest analog to "last-modified by" we
                // currently have without an explicit author field;
                // surfaces useful provenance when the user is
                // browsing a shared library across workspaces or
                // wonders which agent dropped this artifact. Falls
                // through silently when the key doesn't match the
                // expected shape (stubs, manual uploads).
                const parts = a.key.split('/');
                if (parts.length < 3 || parts[0] !== 'artifacts') return null;
                const owner = parts[1];
                if (!owner) return null;
                return (
                  <>
                    <dt>Workspace</dt>
                    <dd>
                      <code className="library__hover-preview-workspace">
                        {owner}
                      </code>
                    </dd>
                  </>
                );
              })()}
              {a.starred && (
                <>
                  <dt>Starred</dt>
                  <dd>★</dd>
                </>
              )}
              {(() => {
                // Image-only: render the natural W×H + a small
                // aspect-ratio descriptor (square / 16:9 / 4:3 /
                // portrait / landscape) when the dimensions have
                // landed via the popover image's onLoad. Cached in
                // a ref keyed by artifact id so re-hovering reads
                // synchronously.
                if (a.type !== 'image') return null;
                const dims = imageDimsRef.current.get(a.id);
                if (!dims) return null;
                const ratio = dims.w / dims.h;
                const ratioLabel =
                  Math.abs(ratio - 1) < 0.05
                    ? 'square'
                    : Math.abs(ratio - 16 / 9) < 0.05
                      ? '16:9'
                      : Math.abs(ratio - 4 / 3) < 0.05
                        ? '4:3'
                        : Math.abs(ratio - 3 / 2) < 0.05
                          ? '3:2'
                          : Math.abs(ratio - 21 / 9) < 0.05
                            ? '21:9'
                            : ratio > 1.05
                              ? 'landscape'
                              : 'portrait';
                return (
                  <>
                    <dt>Dimensions</dt>
                    <dd>
                      {dims.w} × {dims.h}{' '}
                      <span className="library__hover-preview-ratio">
                        · {ratioLabel}
                      </span>
                    </dd>
                  </>
                );
              })()}
            </dl>
            {tags.length > 0 && (
              <div className="library__hover-preview-tags">
                {tags.map((t) => {
                  const isFiltered = activeTagFilter.has(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      className={`library__hover-preview-tag${isFiltered ? ' library__hover-preview-tag--active' : ''}`}
                      onClick={() => {
                        setActiveTagFilter((prev) => {
                          const next = new Set(prev);
                          if (next.has(t)) next.delete(t);
                          else next.add(t);
                          return next;
                        });
                        // Close the popover after toggling — the
                        // filter change is the meaningful effect;
                        // keeping the popover up over a now-
                        // filtered grid feels weird.
                        clearHover();
                      }}
                      title={
                        isFiltered
                          ? `Stop filtering by ${t}`
                          : `Filter library by ${t}`
                      }
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            )}
            {(() => {
              // Image-typed artifacts get a thumbnail preview inside
              // the popover instead of the binary-skipped placeholder.
              // Uses `loading="lazy"` so popover-spawn doesn't pre-
              // fetch every tile's image until the user actually
              // hovers; max-height caps the popover at a reasonable
              // size even for tall portrait shots.
              if (a.type === 'image' && !a.id.startsWith('stub-')) {
                return (
                  <div className="library__hover-preview-image">
                    <img
                      src={`/api/artifacts/${encodeURIComponent(a.key)}`}
                      alt={a.title}
                      loading="lazy"
                      decoding="async"
                      onLoad={(e) => {
                        // Capture natural dimensions for the meta
                        // row. naturalWidth/Height read the
                        // decoded image's true size, not the
                        // displayed pixel size. Bump the snippet
                        // tick state (re-used as a generic
                        // re-render trigger) so the dl picks up
                        // the new entry on the next render pass.
                        const img = e.currentTarget as HTMLImageElement;
                        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                          imageDimsRef.current.set(a.id, {
                            w: img.naturalWidth,
                            h: img.naturalHeight,
                          });
                          setSnippetTick((n) => n + 1);
                        }
                      }}
                      onError={(e) => {
                        // Hide the image on decode failure so we
                        // don't leak a broken-image glyph into the
                        // popover. The metadata + tags + key still
                        // render cleanly.
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                );
              }
              // Pull the snippet (if any) for this artifact. Renders
              // distinct states: loading dot, the truncated text, or
              // a quiet "binary" hint when the type wasn't text-y.
              const snippet = snippetCacheRef.current.get(a.id);
              if (snippet === undefined || snippet === 'loading') {
                return (
                  <div className="library__hover-preview-snippet library__hover-preview-snippet--loading ot-micro">
                    loading snippet…
                  </div>
                );
              }
              if (snippet === 'failed') {
                return null;
              }
              if (snippet === 'skipped') {
                return (
                  <div className="library__hover-preview-snippet library__hover-preview-snippet--skipped ot-micro">
                    (binary — no text snippet)
                  </div>
                );
              }
              // For `code` artifacts, run a tiny tokenizer over the
              // snippet so keywords / strings / comments / numbers
              // render with subtle color cues. Same pre body, just
              // wrapped spans for the matched ranges.
              if (a.type === 'code') {
                return (
                  <pre className="library__hover-preview-snippet library__hover-preview-snippet--code">
                    {highlightCodeSnippet(snippet, a.key)}
                  </pre>
                );
              }
              return (
                <pre className="library__hover-preview-snippet">{snippet}</pre>
              );
            })()}
            <div
              className="library__hover-preview-hint ot-micro"
              title="Cmd/Ctrl+Enter opens this artifact in the preview pane · Cmd+C copies the title · Cmd+Shift+C copies the R2 key · Esc closes"
            >
              <kbd>⌘</kbd><kbd>↵</kbd> open · <kbd>⌘</kbd><kbd>C</kbd> title · <kbd>⌘</kbd><kbd>⇧</kbd><kbd>C</kbd> key · <kbd>esc</kbd> close
            </div>
            <div className="library__hover-preview-actions">
              {/* Copy-key button — interactive surface inside the
                  popover so Tab from the focused tile has somewhere
                  to land. Doubles as a one-click affordance for
                  users who want to grab the R2 key without
                  selecting the text by hand. */}
              <button
                type="button"
                className="library__hover-preview-copy"
                data-hover-preview-focusable="1"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(a.key);
                    showToast('R2 key copied', 'ok');
                  } catch {
                    showToast('Copy failed', 'err');
                  }
                }}
                title={`Copy ${a.key} to clipboard`}
              >
                ⧉ Copy key
              </button>
              {/* Compact ext+size chip — surfaces the two facts
                  a power user reaches for first (filetype +
                  weight) without making them parse the R2 key.
                  Extension is the trailing `.xyz` segment of
                  the key when present, else falls back to the
                  generic type label so we never render a bare
                  size chip with no leading marker. Stubs have
                  no real R2 object yet (size === 0), so we
                  render just the ext in that case. */}
              {(() => {
                const m = /\.([A-Za-z0-9]{1,8})$/.exec(a.key);
                const ext = m
                  ? `.${m[1]!.toLowerCase()}`
                  : a.type
                    ? a.type.toLowerCase()
                    : 'file';
                const sizeLabel = a.size > 0 ? formatBytes(a.size) : null;
                const label = sizeLabel ? `${ext} · ${sizeLabel}` : ext;
                return (
                  <code
                    className="library__hover-preview-meta"
                    title={
                      sizeLabel
                        ? `Type ${ext} · weighs ${sizeLabel} on R2`
                        : `Type ${ext} (stub — not yet on R2)`
                    }
                  >
                    {label}
                  </code>
                );
              })()}
              <code
                className="library__hover-preview-key"
                title={a.key}
              >
                {a.key}
              </code>
            </div>
          </div>
        );
      })()}
      {contextMenu && (() => {
        const a = contextMenu.row;
        const close = () => setContextMenu(null);
        // Clamp the menu to the viewport so it doesn't render off-edge
        // when the user right-clicks near the bottom-right of the grid.
        const MENU_W = 220;
        // Bumped from 248 to accommodate the Duplicate row that
        // slotted in between Copy R2 key and the separator.
        const MENU_H = 288;
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
        const x = Math.min(contextMenu.x, vw - MENU_W - 8);
        const y = Math.min(contextMenu.y, vh - MENU_H - 8);
        const handleStar = async () => {
          close();
          const nextStar = !a.starred;
          setRows((prev) =>
            sortArtifacts(
              prev.map((r) => (r.id === a.id ? { ...r, starred: nextStar } : r)),
            ),
          );
          try {
            await fetch(`/api/artifacts/${encodeURIComponent(a.key)}/star`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ starred: nextStar }),
            });
          } catch {
            /* keep optimistic */
          }
        };
        const handleRename = async () => {
          close();
          const next = window.prompt('Rename artifact', a.title);
          if (!next || next.trim() === a.title) return;
          try {
            const res = await fetch(
              `/api/artifacts/${encodeURIComponent(a.key)}`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: next.trim() }),
              },
            );
            const data = (await res.json()) as { ok: boolean };
            if (data.ok) {
              setRows((prev) =>
                prev.map((r) =>
                  r.id === a.id ? { ...r, title: next.trim() } : r,
                ),
              );
              showToast('Renamed', 'ok');
            } else {
              showToast('Rename failed', 'err');
            }
          } catch {
            showToast('Rename failed', 'err');
          }
        };
        const handleCopyKey = async () => {
          close();
          try {
            await navigator.clipboard.writeText(a.key);
            showToast('R2 key copied', 'ok');
          } catch {
            showToast('Copy failed', 'err');
          }
        };
        // Compute the same ext+size string the hover popover chip
        // renders, so the "Copy ext+size" menu entry matches what
        // the user just saw. Falls back to `a.type` when the R2
        // key has no recognizable extension, and elides the size
        // segment entirely on stubs (size === 0). Result is a
        // copy-paste-friendly token like ".png · 124.3 KB" the
        // user can drop into a note / ticket / commit message.
        const extSizeLabel = (() => {
          const m = /\.([A-Za-z0-9]{1,8})$/.exec(a.key);
          const ext = m
            ? `.${m[1]!.toLowerCase()}`
            : a.type
              ? a.type.toLowerCase()
              : 'file';
          return a.size > 0 ? `${ext} · ${formatBytes(a.size)}` : ext;
        })();
        const handleCopyExtSize = async () => {
          close();
          try {
            await navigator.clipboard.writeText(extSizeLabel);
            showToast(`Copied "${extSizeLabel}"`, 'ok');
          } catch {
            showToast('Copy failed', 'err');
          }
        };
        const handleDownload = () => {
          close();
          const link = document.createElement('a');
          link.href = `/api/artifacts/${encodeURIComponent(a.key)}`;
          link.download = a.title || a.key.split('/').pop() || 'artifact';
          document.body.appendChild(link);
          link.click();
          link.remove();
        };
        // Duplicate the artifact: pull the R2 bytes, write them back
        // under a freshly-suffixed key, and seed a "(copy)" title +
        // matching tags. Stays purely client-orchestrated because all
        // the existing routes already expose what we need — no new
        // worker endpoint required. Star flag is intentionally
        // dropped: a duplicate is a working draft, not a peer of the
        // pinned original.
        const handleDuplicate = async () => {
          close();
          try {
            // Step 1: fetch the source bytes + content-type. Without
            // these we can't safely repackage the new artifact, so
            // bail early on any failure.
            const srcRes = await fetch(
              `/api/artifacts/${encodeURIComponent(a.key)}`,
            );
            if (!srcRes.ok) {
              showToast('Could not fetch source artifact', 'err');
              return;
            }
            const contentType =
              srcRes.headers.get('content-type') ?? 'application/octet-stream';
            const bytes = await srcRes.arrayBuffer();
            // Step 2: build a unique new R2 key by inserting
            // `-copy-<6char>` before the extension. Keeps the
            // directory prefix so the artifact stays on the same
            // agent shelf; keeps the extension so the inferred type
            // + downloaded filename feel right.
            const sep = a.key.lastIndexOf('/');
            const dir = sep >= 0 ? a.key.slice(0, sep + 1) : '';
            const base = sep >= 0 ? a.key.slice(sep + 1) : a.key;
            const dot = base.lastIndexOf('.');
            const stem = dot >= 0 ? base.slice(0, dot) : base;
            const ext = dot >= 0 ? base.slice(dot) : '';
            const shortId =
              typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID().slice(0, 6)
                : Math.random().toString(36).slice(2, 8);
            const newKey = `${dir}${stem}-copy-${shortId}${ext}`;
            const newTitle = `${a.title} (copy)`;
            // Step 3: PUT the bytes back to R2 under the new key.
            const putRes = await fetch(
              `/api/artifacts/${encodeURIComponent(newKey)}`,
              {
                method: 'PUT',
                headers: {
                  'Content-Type': contentType,
                  'X-Artifact-Title': newTitle,
                  'X-Artifact-Version': '1',
                },
                body: bytes,
              },
            );
            const putData = (await putRes.json()) as { ok: boolean };
            if (!putData.ok) {
              showToast('Duplicate failed', 'err');
              return;
            }
            // Step 4: optimistic insert into the rendered grid. The
            // canonical re-sort drops it just under any starred rows
            // and floats it to the top of the "recent" tier. A
            // subsequent /list refresh would land it identically.
            const newRow: ArtifactRow = {
              id: newKey,
              key: newKey,
              type: a.type,
              title: newTitle,
              version: 1,
              size: bytes.byteLength,
              uploadedAt: Date.now(),
              starred: false,
              ...(a.tags && a.tags.length > 0 ? { tags: [...a.tags] } : {}),
            };
            setRows((prev) => sortArtifacts([newRow, ...prev]));
            // Step 5: if the source carried tags, mirror them via
            // the /tags endpoint so they survive a hard reload. Done
            // best-effort — a transient failure leaves the row
            // tag-less rather than rolling back the whole duplicate.
            if (a.tags && a.tags.length > 0) {
              try {
                await fetch(
                  `/api/artifacts/${encodeURIComponent(newKey)}/tags`,
                  {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tags: a.tags }),
                  },
                );
              } catch {
                /* keep optimistic — refresh reconciles */
              }
            }
            showToast(`Duplicated as "${newTitle}"`, 'ok');
          } catch {
            showToast('Duplicate failed', 'err');
          }
        };
        const handleDelete = async () => {
          close();
          if (
            !window.confirm(
              `Delete "${a.title}"? This permanently removes the R2 object.`,
            )
          ) {
            return;
          }
          try {
            const res = await fetch(
              `/api/artifacts/${encodeURIComponent(a.key)}`,
              { method: 'DELETE' },
            );
            const data = (await res.json()) as { ok: boolean };
            if (data.ok) {
              setRows((prev) => prev.filter((r) => r.id !== a.id));
              showToast('Deleted', 'ok');
            } else {
              showToast('Delete failed', 'err');
            }
          } catch {
            showToast('Delete failed', 'err');
          }
        };
        return (
          <div
            className="library__ctxmenu"
            style={{ left: x, top: y }}
            role="menu"
            aria-label={`Actions for ${a.title}`}
          >
            <button
              type="button"
              className="library__ctxmenu-item"
              role="menuitem"
              onClick={() => {
                close();
                setViewing(a);
              }}
            >
              <span className="library__ctxmenu-glyph">⌖</span> Open
            </button>
            <button
              type="button"
              className="library__ctxmenu-item"
              role="menuitem"
              onClick={() => void handleRename()}
            >
              <span className="library__ctxmenu-glyph">✎</span> Rename…
            </button>
            <button
              type="button"
              className="library__ctxmenu-item"
              role="menuitem"
              onClick={() => void handleStar()}
            >
              <span className="library__ctxmenu-glyph">{a.starred ? '☆' : '★'}</span>{' '}
              {a.starred ? 'Unstar' : 'Star'}
            </button>
            <button
              type="button"
              className="library__ctxmenu-item"
              role="menuitem"
              onClick={handleDownload}
            >
              <span className="library__ctxmenu-glyph">↓</span> Download
            </button>
            <button
              type="button"
              className="library__ctxmenu-item"
              role="menuitem"
              onClick={() => void handleCopyKey()}
            >
              <span className="library__ctxmenu-glyph">⎘</span> Copy R2 key
            </button>
            <button
              type="button"
              className="library__ctxmenu-item"
              role="menuitem"
              onClick={() => void handleCopyExtSize()}
              title={`Copy "${extSizeLabel}" — same string the hover preview chip shows`}
            >
              <span className="library__ctxmenu-glyph">⎘ƒ</span> Copy ext+size
              <span className="library__ctxmenu-shortcut">
                {extSizeLabel}
              </span>
            </button>
            <button
              type="button"
              className="library__ctxmenu-item"
              role="menuitem"
              onClick={() => void handleDuplicate()}
              title="Clone this artifact as a fresh draft (bytes + tags copied, star + version reset)"
            >
              <span className="library__ctxmenu-glyph">⎘+</span> Duplicate
            </button>
            <div className="library__ctxmenu-sep" aria-hidden />
            <button
              type="button"
              className="library__ctxmenu-item library__ctxmenu-item--danger"
              role="menuitem"
              onClick={() => void handleDelete()}
            >
              <span className="library__ctxmenu-glyph">✕</span> Delete
            </button>
          </div>
        );
      })()}
    </div>
  );
}

// Library tile thumbnail. For image-typed artifacts, lazy-loads the
// actual R2 blob via `loading="lazy"` so a 200-row grid doesn't fire
// 200 image requests up front. Falls back to the type-glyph when the
// image fails to decode OR when the artifact isn't an image. Stubs
// always render the glyph (they don't have a real R2 key).
function LibraryTileThumb({
  artifact,
  isStub,
}: {
  artifact: ArtifactRow;
  isStub: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const isImage = artifact.type === 'image' && !isStub && !failed;
  // Pull the file extension off the R2 key — e.g. `thread/abc/x.json`
  // → `json`. We bound at 1–8 chars so we don't surface long
  // garbage when the key is a UUID-only path. Falls back to null
  // when no recognizable extension exists (the type-glyph alone
  // is still informative). Stubs render no badge — they don't
  // have a real R2 object yet, so an extension would be
  // misleading.
  const extMatch =
    !isStub && !isImage ? /\.([A-Za-z0-9]{1,8})$/.exec(artifact.key) : null;
  const ext = extMatch ? extMatch[1]!.toLowerCase() : null;
  return (
    <div className="library__tile-thumb">
      {isImage ? (
        <img
          className="library__tile-image"
          src={`/api/artifacts/${encodeURIComponent(artifact.key)}`}
          alt={artifact.title}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="library__tile-glyph" aria-hidden>
          {GLYPHS[artifact.type] ?? '◇'}
        </span>
      )}
      {ext && (
        <span
          className="library__tile-ext"
          aria-hidden
          title={`.${ext}`}
        >
          {ext}
        </span>
      )}
    </div>
  );
}

const GLYPHS: Record<string, string> = {
  document: '📄',
  code: '⟨ ⟩',
  table: '⌗',
  chart: '◧',
  image: '🖼',
  slides: '▤',
  webpage: '◰',
  'browser-session': '🌐',
};

// Tiny single-pass code highlighter for the Library hover snippet.
// Detects language from the file extension; the keyword set is a
// curated common-tokens list across JS/TS/Py/Go/Rust/Java/Ruby so a
// single shared regex pass works without per-language plumbing. The
// goal is "subtle visual cues" — not a real editor — so the
// classification is intentionally coarse: strings, comments,
// keywords, numbers, the rest. Returns a flat node array suitable
// for dropping into a <pre>.
const CODE_KEYWORDS = new Set([
  // JS/TS
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for',
  'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'this',
  'class', 'extends', 'super', 'import', 'export', 'from', 'as',
  'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof',
  'instanceof', 'in', 'of', 'true', 'false', 'null', 'undefined',
  'interface', 'type', 'enum', 'public', 'private', 'protected',
  'readonly', 'static', 'void',
  // Python
  'def', 'lambda', 'yield', 'global', 'nonlocal', 'pass', 'raise',
  'with', 'and', 'or', 'not', 'is', 'None', 'True', 'False', 'self',
  'elif', 'except',
  // Go
  'func', 'package', 'go', 'defer', 'chan', 'select', 'struct',
  'map', 'range', 'interface',
  // Rust
  'fn', 'let', 'mut', 'pub', 'impl', 'trait', 'use', 'mod',
  'match', 'Some', 'None', 'Ok', 'Err',
  // Ruby
  'end', 'unless', 'until', 'begin', 'rescue', 'ensure',
]);

function highlightCodeSnippet(
  snippet: string,
  key: string,
): React.ReactNode[] {
  // The tokenizer walks left-to-right, classifying each chunk into
  // string / comment / keyword / number / plain. Quotes use a tiny
  // state machine so escapes (`\"`, `\\`) don't terminate strings
  // prematurely. Comments are line-comments (// or #) — block
  // comments are rare enough in a 700-char snippet that we don't
  // pay for them. Anything that doesn't match falls through as
  // plain text in a single span run.
  const lowerKey = key.toLowerCase();
  const isHashComment =
    /\.(py|rb|sh|yml|yaml|toml|conf)$/.test(lowerKey);
  const out: React.ReactNode[] = [];
  let plainBuf = '';
  let key2 = 0;
  const flushPlain = () => {
    if (plainBuf.length === 0) return;
    out.push(plainBuf);
    plainBuf = '';
  };
  const push = (cls: string, text: string) => {
    flushPlain();
    out.push(
      <span key={`h-${key2++}`} className={`library__code-${cls}`}>
        {text}
      </span>,
    );
  };
  let i = 0;
  while (i < snippet.length) {
    const ch = snippet[i]!;
    // Strings — single, double, backtick
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < snippet.length) {
        if (snippet[j] === '\\' && j + 1 < snippet.length) {
          j += 2;
          continue;
        }
        if (snippet[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      push('str', snippet.slice(i, j));
      i = j;
      continue;
    }
    // Line comment — `//` for C-family, `#` for Python/Ruby/etc.
    const isSlashComment =
      ch === '/' && snippet[i + 1] === '/' && !isHashComment;
    const isHashLine = ch === '#' && isHashComment;
    if (isSlashComment || isHashLine) {
      let j = i;
      while (j < snippet.length && snippet[j] !== '\n') j += 1;
      push('comment', snippet.slice(i, j));
      i = j;
      continue;
    }
    // Numbers — leading digit, including decimals + suffixes (n / L)
    if (/[0-9]/.test(ch) && (i === 0 || !/[a-zA-Z_]/.test(snippet[i - 1] ?? ''))) {
      let j = i;
      while (j < snippet.length && /[0-9._a-fA-FxX]/.test(snippet[j]!)) j += 1;
      push('num', snippet.slice(i, j));
      i = j;
      continue;
    }
    // Identifiers — collect a run of \w then check against the
    // keyword set. Anything outside the set falls into plain.
    if (/[a-zA-Z_$]/.test(ch)) {
      let j = i;
      while (j < snippet.length && /[a-zA-Z0-9_$]/.test(snippet[j]!)) j += 1;
      const word = snippet.slice(i, j);
      if (CODE_KEYWORDS.has(word)) {
        push('kw', word);
      } else {
        plainBuf += word;
      }
      i = j;
      continue;
    }
    plainBuf += ch;
    i += 1;
  }
  flushPlain();
  return out;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// Zip helpers live in a shared module so the Settings full-agent
// snapshot can reuse the same store-only PKZip writer. See the
// module for the rationale (no compression, no dep, ~50 LOC).

// Compute the minimum edit distance between `a` and `b` while
// allowing the search to land on any contiguous substring of `b` —
// the canonical "approximate substring match" trick. Returns 0 when
// `a` appears as a substring of `b` (so a successful direct hit
// wouldn't show up in the did-you-mean list, because such hits filter
// in `visible` already). Implementation uses the standard
// O(|a|·|b|) Wagner–Fischer table with a "skip from any column" seed
// in row 0 so we don't pay for a prefix mismatch the user didn't
// intend.
function libraryEditDistance(a: string, b: string): number {
  if (!a) return 0;
  if (!b) return a.length;
  const m = a.length;
  const n = b.length;
  // Initialize: row 0 is all zeros (we allow starting anywhere in b).
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1]! + 1,        // insert
        prev[j]! + 1,            // delete
        prev[j - 1]! + cost,     // substitute
      );
    }
    [prev, curr] = [curr, prev];
  }
  for (let j = 0; j <= n; j++) best = Math.min(best, prev[j]!);
  return best;
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d}d ago`;
  const mo = Math.round(d / 30);
  return `${mo}mo ago`;
}
