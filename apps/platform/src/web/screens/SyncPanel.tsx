import { useEffect, useMemo, useRef, useState } from 'react';
import { showToast } from '../shell/Toast';
import './SyncPanel.css';

export interface SyncStatus {
  upstreamSha: string;
  localSha: string;
  ahead: number;
  behind: number;
  summary: string;
  lastChecked: number;
  commits: Array<{
    sha: string;
    author: string;
    message: string;
    ts: number;
  }>;
  recentPRs: Array<{
    number: number;
    title: string;
    url: string;
    state: 'open' | 'merged' | 'closed';
    openedAt: number;
    draft?: boolean;
    requestedReviewers?: number;
    /**
     * True when the PR's base SHA has drifted from main's current
     * HEAD — surfaces a "stale" badge so the user knows the branch
     * will likely need a rebase before merging. Undefined when we
     * couldn't determine (e.g. base.sha missing from GitHub list
     * response).
     */
    staleBehind?: boolean;
  }>;
}

export function SyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [pulling, setPulling] = useState(false);
  const [dryRun, setDryRun] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // PR list filter + sort. Both persist to localStorage so the user's
  // preferred lens (e.g. "show me only open PRs, sorted by state")
  // sticks across reloads.
  const [prFilter, setPrFilter] = useState<'all' | 'open' | 'merged' | 'closed'>(() => {
    if (typeof window === 'undefined') return 'all';
    const raw = window.localStorage.getItem('openthink:sync-pr-filter');
    if (raw === 'open' || raw === 'merged' || raw === 'closed') return raw;
    return 'all';
  });
  const [prSort, setPrSort] = useState<'newest' | 'oldest' | 'state'>(() => {
    if (typeof window === 'undefined') return 'newest';
    const raw = window.localStorage.getItem('openthink:sync-pr-sort');
    if (raw === 'oldest' || raw === 'state') return raw;
    return 'newest';
  });
  useEffect(() => {
    window.localStorage.setItem('openthink:sync-pr-filter', prFilter);
  }, [prFilter]);
  useEffect(() => {
    window.localStorage.setItem('openthink:sync-pr-sort', prSort);
  }, [prSort]);
  // Free-text search across PR title + number. Lowercased substring
  // match — fast and forgiving. Persisted to localStorage so the
  // user's "show me only PRs about the auth flow" lens sticks
  // across reloads alongside the filter + sort preferences.
  const [prSearch, setPrSearch] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem('openthink:sync-pr-search') ?? '';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (prSearch) {
      window.localStorage.setItem('openthink:sync-pr-search', prSearch);
    } else {
      window.localStorage.removeItem('openthink:sync-pr-search');
    }
  }, [prSearch]);
  // Broadcast attention to the Settings nav when the agent has fallen
  // behind upstream. The Settings shell renders a `!` badge on the
  // tab so a user reviewing another pane sees the cue. Cleared when
  // we're back in sync.
  useEffect(() => {
    if (!status) return;
    const reason =
      status.behind > 0
        ? `${status.behind} commit${status.behind === 1 ? '' : 's'} behind upstream`
        : null;
    window.dispatchEvent(
      new CustomEvent('openthink:settings-attention', {
        detail: { tab: 'sync', reason },
      }),
    );
  }, [status]);
  // PR-back state — kept inline so the user sees the result without
  // navigating away. `proposedPr` is the latest opened PR; surfaced as a
  // small toast next to the button so they can click through immediately.
  const [proposing, setProposing] = useState(false);
  const [proposedPr, setProposedPr] = useState<{ number: number; url: string } | null>(null);
  // Per-PR merge state — keyed by PR number so two simultaneous merge
  // clicks don't conflate spinners. Cleared when refresh() lands a new
  // status payload (the PR's `state` flips to 'merged' there).
  const [mergingPr, setMergingPr] = useState<number | null>(null);
  // Captures a per-PR error from the merge endpoint so we can render a
  // small inline note instead of just toasting. Keyed by PR number.
  const [mergeError, setMergeError] = useState<Record<number, string>>({});
  // Per-PR mark-ready state. Same shape as mergingPr — keyed by PR
  // number so two simultaneous draft→ready clicks don't conflate, and
  // the inline error chip rendering can reuse the same `mergeError`
  // map (the slot is "what's wrong with this PR right now", not
  // action-specific). We just store the action label in the error
  // string so the user knows which try failed.
  const [readyingPr, setReadyingPr] = useState<number | null>(null);
  // Multi-select state for PR rows. Click the checkbox-style ⊕ on a
  // ready PR to add it; the bulk-merge button appears when ≥2 are
  // selected. We require the selection to consist entirely of
  // ready-state PRs (the per-PR merge API would 405 on drafts /
  // pending-reviewers anyway) so the button doesn't surface a
  // promise we can't keep.
  const [selectedPrs, setSelectedPrs] = useState<Set<number>>(new Set());
  const [bulkMerging, setBulkMerging] = useState(false);
  // Live progress for the bulk-merge loop. Toggling between done/total
  // so the user gets a "Merging 2/5 · #421…" readout as the serial
  // iteration walks the selection. Cleared when the loop finishes.
  const [bulkMergeProgress, setBulkMergeProgress] = useState<{
    done: number;
    total: number;
    current: number | null;
    failures: number;
  } | null>(null);
  const togglePrSelection = (n: number) => {
    setSelectedPrs((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };
  const bulkMergeSelected = async (prNumbers: number[]) => {
    if (prNumbers.length === 0 || bulkMerging || mergingPr !== null) return;
    if (
      !window.confirm(
        `${mergeVerb(mergeMethod)} ${prNumbers.length} pull request${prNumbers.length === 1 ? '' : 's'}? GitHub processes them sequentially.`,
      )
    ) {
      return;
    }
    setBulkMerging(true);
    setBulkMergeProgress({
      done: 0,
      total: prNumbers.length,
      current: prNumbers[0] ?? null,
      failures: 0,
    });
    let ok = 0;
    let failed = 0;
    // Serial loop — GitHub's merge API rate-limits per-repo and
    // serializes per-PR anyway. Each iteration optimistically
    // marks the PR merged locally; refresh() at the end pulls
    // the canonical state.
    for (let i = 0; i < prNumbers.length; i++) {
      const num = prNumbers[i]!;
      setBulkMergeProgress({
        done: i,
        total: prNumbers.length,
        current: num,
        failures: failed,
      });
      try {
        const res = await fetch(`/api/sync/pulls/${num}/merge`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mergeMethod }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          merged?: boolean;
          error?: string;
        };
        if (data.ok && data.merged) {
          ok += 1;
          setStatus((prev) =>
            prev
              ? {
                  ...prev,
                  recentPRs: prev.recentPRs.map((p) =>
                    p.number === num ? { ...p, state: 'merged' as const } : p,
                  ),
                }
              : prev,
          );
        } else {
          failed += 1;
          setMergeError((prev) => ({
            ...prev,
            [num]: data.error ?? 'merge failed',
          }));
        }
      } catch (err) {
        failed += 1;
        setMergeError((prev) => ({
          ...prev,
          [num]: err instanceof Error ? err.message : 'merge failed',
        }));
      }
    }
    // Final progress frame so the bar lands at 100% before clearing.
    setBulkMergeProgress({
      done: prNumbers.length,
      total: prNumbers.length,
      current: null,
      failures: failed,
    });
    // Linger briefly so the user sees the completed state before the
    // bar collapses out of view.
    window.setTimeout(() => setBulkMergeProgress(null), 800);
    setBulkMerging(false);
    setSelectedPrs(new Set());
    showToast(
      `Bulk merge: ${ok} merged${failed > 0 ? ` · ${failed} failed` : ''}`,
      failed > 0 ? 'err' : 'ok',
    );
    void refresh();
  };
  // Per-commit expansion state — surfaces a "what did this commit
  // change" inline diff drilldown in the Recent-upstream-commits list.
  // Three parallel maps keyed by short SHA: expanded toggles
  // visibility, loading guards the fetch, diffs caches the response
  // (string for ok, { error } shape for failures so the row can render
  // an inline error).
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  const [loadingCommits, setLoadingCommits] = useState<Set<string>>(new Set());
  const [commitDiffs, setCommitDiffs] = useState<
    Record<string, string | { error: string }>
  >({});
  // Per-PR diff preview state — mirrors the commit-diff trio. Lets
  // the user scan a PR's actual changes inline before merging.
  // Cached so collapse+re-open doesn't refetch.
  const [expandedPrs, setExpandedPrs] = useState<Set<number>>(new Set());
  const [loadingPrs, setLoadingPrs] = useState<Set<number>>(new Set());
  const [prDiffs, setPrDiffs] = useState<
    Record<number, string | { error: string }>
  >({});
  const loadPrDiff = async (prNumber: number) => {
    setLoadingPrs((prev) => {
      const next = new Set(prev);
      next.add(prNumber);
      return next;
    });
    try {
      const res = await fetch(`/api/sync/pulls/${prNumber}/diff`);
      const data = (await res.json()) as {
        ok: boolean;
        diff?: string;
        error?: string;
      };
      if (data.ok && typeof data.diff === 'string') {
        setPrDiffs((prev) => ({ ...prev, [prNumber]: data.diff! }));
      } else {
        setPrDiffs((prev) => ({
          ...prev,
          [prNumber]: { error: data.error ?? 'fetch_failed' },
        }));
      }
    } catch (err) {
      setPrDiffs((prev) => ({
        ...prev,
        [prNumber]: { error: err instanceof Error ? err.message : 'fetch_failed' },
      }));
    } finally {
      setLoadingPrs((prev) => {
        const next = new Set(prev);
        next.delete(prNumber);
        return next;
      });
    }
  };
  const togglePrDiff = (prNumber: number) => {
    const isOpen = expandedPrs.has(prNumber);
    setExpandedPrs((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(prNumber);
      else next.add(prNumber);
      return next;
    });
    if (!isOpen && !(prNumber in prDiffs)) {
      void loadPrDiff(prNumber);
    }
  };

  // Fetch the per-commit diff. Sets the loading flag for this SHA,
  // caches the response (either the raw diff string or an `{error}`
  // shape on failure), and clears the loading flag in `finally`.
  // Pulled out of `toggleCommitDiff` so the Retry button can re-fire
  // the fetch without re-running the open/close logic.
  const loadCommitDiff = async (sha: string) => {
    setLoadingCommits((prev) => {
      const next = new Set(prev);
      next.add(sha);
      return next;
    });
    try {
      const res = await fetch(`/api/sync/commits/${encodeURIComponent(sha)}/diff`);
      const data = (await res.json()) as {
        ok: boolean;
        diff?: string;
        error?: string;
      };
      if (data.ok && typeof data.diff === 'string') {
        setCommitDiffs((prev) => ({ ...prev, [sha]: data.diff! }));
      } else {
        setCommitDiffs((prev) => ({
          ...prev,
          [sha]: { error: data.error ?? 'fetch_failed' },
        }));
      }
    } catch (err) {
      setCommitDiffs((prev) => ({
        ...prev,
        [sha]: { error: err instanceof Error ? err.message : 'fetch_failed' },
      }));
    } finally {
      setLoadingCommits((prev) => {
        const next = new Set(prev);
        next.delete(sha);
        return next;
      });
    }
  };

  // Toggle a commit row's inline diff. First-time expansion fires the
  // backend fetch; subsequent toggles re-use the cached payload so the
  // user can collapse + re-open without burning another request.
  const toggleCommitDiff = (sha: string) => {
    const isOpen = expandedCommits.has(sha);
    setExpandedCommits((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(sha);
      else next.add(sha);
      return next;
    });
    if (!isOpen && !(sha in commitDiffs)) {
      void loadCommitDiff(sha);
    }
  };

  // Keyboard-driven row focus for the recent-commits list. j moves
  // forward, k moves backward, Enter expands/collapses the focused
  // commit. Tracks the SHA rather than the index so a status refresh
  // that re-orders the list doesn't strand the highlight on a moved
  // row. Same shape as the Audit j/k/p shortcuts so users only have
  // to learn the pattern once.
  const [focusedCommitSha, setFocusedCommitSha] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Skip when a dialog has captured focus — the dry-run diff
      // viewer and the merge confirm both render dialogs, and we
      // don't want j to navigate underneath them.
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog && dialog.contains(target as Node)) return;
      // Bail when the sync panel isn't actually visible — Shell
      // routes Settings into a hash like `#/settings/sync`, so when
      // the user is on a different tab the panel isn't mounted at
      // all and this listener wouldn't fire. But the panel can
      // mount inside Settings even when the user has navigated to
      // Audit, so we cheaply gate on the panel root being present
      // in the DOM and visible.
      const panelRoot = document.querySelector('.sync-panel__commits');
      if (!panelRoot) return;
      const key = e.key;
      if (!['j', 'k', 'J', 'K', 'Enter', ' '].includes(key)) return;
      if ((key === 'Enter' || key === ' ') && !focusedCommitSha) return;
      if (!status || status.commits.length === 0) return;
      const ordered = status.commits.map((c) => c.sha);
      e.preventDefault();
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'j') {
        const cur = focusedCommitSha ? ordered.indexOf(focusedCommitSha) : -1;
        const next = ordered[(cur + 1) % ordered.length];
        if (next) {
          setFocusedCommitSha(next);
          window.requestAnimationFrame(() => {
            document
              .querySelector(`[data-commit-sha="${next}"]`)
              ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          });
        }
      } else if (lowerKey === 'k') {
        const cur = focusedCommitSha ? ordered.indexOf(focusedCommitSha) : 0;
        const prev = ordered[(cur - 1 + ordered.length) % ordered.length];
        if (prev) {
          setFocusedCommitSha(prev);
          window.requestAnimationFrame(() => {
            document
              .querySelector(`[data-commit-sha="${prev}"]`)
              ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          });
        }
      } else if ((key === 'Enter' || key === ' ') && focusedCommitSha) {
        toggleCommitDiff(focusedCommitSha);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, focusedCommitSha, commitDiffs]);
  // Drop the focus highlight when the focused SHA is no longer in
  // the visible commit list (status refresh dropped it off the
  // recent-window tail).
  useEffect(() => {
    if (
      focusedCommitSha &&
      status &&
      !status.commits.some((c) => c.sha === focusedCommitSha)
    ) {
      setFocusedCommitSha(null);
    }
  }, [status, focusedCommitSha]);

  // Keyboard navigation for the PR list — same shape as the commit-
  // list j/k but scoped to PR numbers. Enter opens the PR's URL in a
  // new tab (PRs already have target=_blank links; this just
  // mirrors that for keyboard users). Mod+Enter on a ready open PR
  // could trigger merge, but that's a more dangerous shortcut so we
  // leave it to the inline button for now.
  const [focusedPrNumber, setFocusedPrNumber] = useState<number | null>(null);
  // Whether the keyboard-shortcuts help overlay is open. `?`
  // (Shift+/) toggles it, Esc dismisses. Closed by default so we
  // don't claim screen real estate; persisted via no storage —
  // it's a transient reference card, not a setting.
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // `?` (Shift+/) toggles the shortcuts help overlay from
      // anywhere on the panel. We special-case this BEFORE the
      // dialog/input gates because a help overlay is the kind of
      // thing the user reaches for when they're confused —
      // making it conditional on having no dialog up would be
      // unhelpful. Esc dismisses, both from inside the overlay
      // and from outside.
      if (e.key === '?' && !showShortcutsHelp) {
        e.preventDefault();
        setShowShortcutsHelp(true);
        return;
      }
      if (e.key === 'Escape' && showShortcutsHelp) {
        e.preventDefault();
        setShowShortcutsHelp(false);
        return;
      }
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog && dialog.contains(target as Node)) return;
      // Bail when the PR list isn't actually present in the DOM (e.g.
      // user is on a tab that doesn't mount the sync panel). The
      // commits j/k listener has the same gate; both can co-exist
      // because the commit-list and PR-list have different DOM
      // anchors and the listeners check their own.
      const panelRoot = document.querySelector('.sync-panel__prs');
      if (!panelRoot) return;
      // Don't double-fire: if the commit-list listener is going to
      // claim a j/k press (the user is hovering / focused on a
      // commit), defer. We approximate this by checking whether
      // a focused commit row exists; if so, the commit-list
      // listener wins for j/k. Otherwise the PR list takes over.
      // This trades a little subtlety for not needing a global
      // event-source arbitration scheme.
      if (focusedCommitSha) return;
      if (!status || status.recentPRs.length === 0) return;
      const filteredByState =
        prFilter === 'all'
          ? status.recentPRs
          : status.recentPRs.filter((p) => p.state === prFilter);
      const searchQ = prSearch.trim().toLowerCase();
      const filtered = searchQ
        ? filteredByState.filter(
            (p) =>
              p.title.toLowerCase().includes(searchQ) ||
              String(p.number).includes(searchQ),
          )
        : filteredByState;
      if (filtered.length === 0) return;
      const ordered = filtered.map((p) => p.number);
      const key = e.key;
      if (!['j', 'k', 'J', 'K', 'Enter', 'm', 'M', 'c', 'C', ' ', 'Spacebar'].includes(key)) return;
      if (key === 'Enter' && !focusedPrNumber) return;
      // `m` only makes sense when a PR is actually focused. Suppress
      // before we preventDefault so unfocused presses don't swallow
      // typing into the search box (the outer guards already exclude
      // input focus, but defense in depth).
      if ((key === 'm' || key === 'M') && !focusedPrNumber) return;
      // `c` (copy URL) — same focus-required gate. Lets keyboard
      // users grab the PR's GitHub URL without a mouse trip to the
      // Shift+click chord. Suppressed when no PR is focused so we
      // don't claim the keystroke from text that the user is
      // selecting on the page.
      if ((key === 'c' || key === 'C') && !focusedPrNumber) return;
      // Space toggles bulk-merge selection on the focused PR — only
      // valid when a PR is focused AND that PR is in the
      // canMerge-eligible cohort. Drafts / pending-review rows can't
      // be bulk-merged anyway, so a space-toggle there would
      // accumulate selections the bulk action would then drop. The
      // checkbox button already enforces the same gate visually.
      if ((key === ' ' || key === 'Spacebar') && !focusedPrNumber) return;
      e.preventDefault();
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'j') {
        const cur = focusedPrNumber ? ordered.indexOf(focusedPrNumber) : -1;
        const next = ordered[(cur + 1) % ordered.length];
        if (typeof next === 'number') {
          setFocusedPrNumber(next);
          window.requestAnimationFrame(() => {
            document
              .querySelector(`[data-pr-number="${next}"]`)
              ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          });
        }
      } else if (lowerKey === 'k') {
        const cur = focusedPrNumber ? ordered.indexOf(focusedPrNumber) : 0;
        const prev = ordered[(cur - 1 + ordered.length) % ordered.length];
        if (typeof prev === 'number') {
          setFocusedPrNumber(prev);
          window.requestAnimationFrame(() => {
            document
              .querySelector(`[data-pr-number="${prev}"]`)
              ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          });
        }
      } else if (key === 'Enter' && focusedPrNumber) {
        // Enter on a focused PR opens it on GitHub. The PR's URL
        // is in the row's anchor; reach into the rendered DOM
        // rather than re-deriving from status, so a stale
        // focusedPrNumber across a status refetch doesn't open
        // the wrong PR.
        const anchor = document
          .querySelector(`[data-pr-number="${focusedPrNumber}"]`)
          ?.querySelector('a');
        if (anchor instanceof HTMLAnchorElement) {
          window.open(anchor.href, '_blank', 'noopener,noreferrer');
        }
      } else if (
        (lowerKey === 'm') &&
        focusedPrNumber !== null
      ) {
        // `m` on a focused PR fires the inline merge — parity
        // with j/k (nav), Enter (open on GitHub), and the
        // existing `r` mark-ready chord. We re-derive the PR's
        // ready/stale state from current status (rather than
        // trusting the row that was focused N renders ago) so a
        // background refresh that just merged/blocked the PR
        // doesn't make us fire against the wrong row. Each
        // bailout surfaces a per-cause toast so the user knows
        // why nothing happened.
        const focusedPr = status?.recentPRs.find(
          (p) => p.number === focusedPrNumber,
        );
        if (!focusedPr) {
          showToast(
            `PR #${focusedPrNumber} is no longer in the list`,
            'err',
          );
        } else if (focusedPr.state !== 'open') {
          showToast(
            `PR #${focusedPrNumber} is ${focusedPr.state}, can't merge`,
            'err',
          );
        } else if (focusedPr.draft) {
          showToast(
            `PR #${focusedPrNumber} is a draft — press \`r\` to mark ready first`,
            'info',
          );
        } else if ((focusedPr.requestedReviewers ?? 0) > 0) {
          showToast(
            `PR #${focusedPrNumber} has reviews pending — resolve on GitHub first`,
            'info',
          );
        } else if (focusedPr.staleBehind) {
          showToast(
            `PR #${focusedPrNumber} is stale — rebase before merging`,
            'info',
          );
        } else if (mergingPr !== null) {
          showToast(
            `Another merge is already in flight (PR #${mergingPr})`,
            'info',
          );
        } else {
          // All gates clear — fire the merge. handleMergePr
          // owns its own confirm() prompt so we don't double-
          // confirm here; the keyboard chord is just the
          // trigger.
          void handleMergePr(focusedPrNumber);
        }
      } else if (
        (lowerKey === 'c') &&
        focusedPrNumber !== null
      ) {
        // `c` copies the focused PR's GitHub URL to the clipboard
        // — parity with the Shift+click chord on the row title
        // that already does this via mouse. Reach into the
        // rendered DOM rather than re-deriving from status so a
        // stale focusedPrNumber across a refetch doesn't copy
        // the wrong PR's URL.
        const anchor = document
          .querySelector(`[data-pr-number="${focusedPrNumber}"]`)
          ?.querySelector('a');
        if (anchor instanceof HTMLAnchorElement && anchor.href) {
          void navigator.clipboard
            .writeText(anchor.href)
            .then(() =>
              showToast(`Copied PR #${focusedPrNumber} URL`, 'ok'),
            )
            .catch(() => showToast('Copy failed', 'err'));
        } else {
          showToast(
            `PR #${focusedPrNumber} URL not found`,
            'err',
          );
        }
      } else if (
        (key === ' ' || key === 'Spacebar') &&
        focusedPrNumber !== null
      ) {
        // Space-toggle adds/removes the focused PR from the
        // bulk-merge selection. We re-derive ready-state from
        // current status so a row that's flipped to draft /
        // pending-review under us doesn't end up in the
        // selection. Drafts get a hint toast pointing at the
        // checkbox (which gates ready-state in render) so the
        // user knows what's blocking.
        const focusedPr = status?.recentPRs.find(
          (p) => p.number === focusedPrNumber,
        );
        if (!focusedPr) {
          showToast(
            `PR #${focusedPrNumber} is no longer in the list`,
            'err',
          );
        } else if (focusedPr.state !== 'open') {
          showToast(
            `PR #${focusedPrNumber} is ${focusedPr.state}, can't bulk-merge`,
            'err',
          );
        } else if (focusedPr.draft) {
          showToast(
            `PR #${focusedPrNumber} is a draft — press \`r\` to mark ready first`,
            'info',
          );
        } else if ((focusedPr.requestedReviewers ?? 0) > 0) {
          showToast(
            `PR #${focusedPrNumber} has reviews pending — resolve on GitHub first`,
            'info',
          );
        } else {
          togglePrSelection(focusedPrNumber);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // mergingPr is in the deps so the `m`-shortcut gate sees the
    // current merge-in-flight state instead of a stale closure
    // value — without it, two quick `m` presses could fire a
    // duplicate merge. showShortcutsHelp lets the same listener
    // toggle the overlay open/closed without a separate effect.
  }, [
    status,
    prFilter,
    prSearch,
    focusedPrNumber,
    focusedCommitSha,
    mergingPr,
    showShortcutsHelp,
  ]);
  // Drop the focus highlight when the focused PR is no longer
  // visible (filter changed, search narrowed it out, status
  // refresh).
  useEffect(() => {
    if (!status || focusedPrNumber === null) return;
    if (!status.recentPRs.some((p) => p.number === focusedPrNumber)) {
      setFocusedPrNumber(null);
    }
  }, [status, focusedPrNumber]);
  // Last successful /api/sync/status response time — drives the
  // "checked Xs ago" relative time in the recent-PRs header so the user
  // knows how stale the state is.
  const [lastCheckedAt, setLastCheckedAt] = useState<number>(Date.now());
  // Forces the "Xs ago" string to re-render every 15s without refetching.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/sync/status');
      const s = (await res.json()) as SyncStatus;
      setStatus(s);
      setLastCheckedAt(Date.now());
    } catch {
      setStatus(FALLBACK_STATUS);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refresh();
    // 60-second auto-refresh so the panel reflects new upstream commits
    // without forcing the user to navigate away and back. The server's KV
    // cache absorbs the load.
    const id = window.setInterval(() => void refresh(), 60_000);

    // Refresh when the tab becomes visible — the auto-interval may have
    // been suspended by the browser while the tab was backgrounded, and
    // the user is most likely to glance at the status right after they
    // return. Same cheap fetch the manual refresh button hits.
    const lastRefreshRef = { current: Date.now() };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      // Throttle to once per 10s — Settings tab focus during normal use
      // can fire visibility events repeatedly.
      if (Date.now() - lastRefreshRef.current < 10_000) return;
      lastRefreshRef.current = Date.now();
      void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, []);

  const handlePull = async () => {
    setPulling(true);
    try {
      const res = await fetch('/api/sync/pull', { method: 'POST' });
      const data = (await res.json()) as { ok: boolean; diff?: string };
      if (data.ok && data.diff) {
        setDryRun(data.diff);
      }
    } catch (err) {
      console.error('[sync] pull failed', err);
    } finally {
      setPulling(false);
    }
  };

  // Per-agent default merge method — persisted to localStorage so
  // teams that prefer a non-squash workflow (e.g. trunk-based with
  // rebase, or merge-commit shops) don't have to flip the dropdown
  // every time. Defaults to squash, which is the right call for the
  // agent-authored single-purpose patches we typically open.
  const [mergeMethod, setMergeMethod] = useState<'squash' | 'merge' | 'rebase'>(() => {
    if (typeof window === 'undefined') return 'squash';
    const raw = window.localStorage.getItem('openthink:sync-merge-method');
    return raw === 'merge' || raw === 'rebase' ? raw : 'squash';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('openthink:sync-merge-method', mergeMethod);
  }, [mergeMethod]);
  const mergeVerb = (m: 'squash' | 'merge' | 'rebase'): string =>
    m === 'squash' ? 'Squash + merge' : m === 'rebase' ? 'Rebase + merge' : 'Merge commit';

  // Inline merge for ready-state PRs. Method honors the current
  // user preference (squash by default; can be flipped via the
  // inline picker). Optimistically flips the PR's state in local
  // status so the row repaints immediately, then re-fetches
  // /status to pull the canonical state. On failure we rollback
  // the optimistic flip and surface a per-PR error string.
  const handleMergePr = async (prNumber: number) => {
    if (mergingPr !== null) return;
    if (!window.confirm(`${mergeVerb(mergeMethod)} PR #${prNumber}?`)) return;
    setMergingPr(prNumber);
    setMergeError((prev) => {
      // Drop any stale error for this PR while the new attempt is in
      // flight — keeps the inline note from contradicting the spinner.
      if (!(prNumber in prev)) return prev;
      const next = { ...prev };
      delete next[prNumber];
      return next;
    });
    const snapshot = status;
    setStatus((prev) =>
      prev
        ? {
            ...prev,
            recentPRs: prev.recentPRs.map((p) =>
              p.number === prNumber ? { ...p, state: 'merged' as const } : p,
            ),
          }
        : prev,
    );
    try {
      const res = await fetch(`/api/sync/pulls/${prNumber}/merge`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mergeMethod }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        merged?: boolean;
        error?: string;
        status?: number;
      };
      if (data.ok && data.merged) {
        showToast(`PR #${prNumber} merged`, 'ok');
        // Re-pull canonical status so the upstream-behind count + commit
        // list reflect the new HEAD if this was the last open PR ahead.
        void refresh();
      } else {
        // Rollback the optimistic flip and surface a per-PR error chip.
        setStatus(snapshot);
        const label =
          data.error === 'not_mergeable'
            ? 'not mergeable — conflicts or required reviews'
            : data.error === 'sha_mismatch'
              ? 'head SHA changed — refresh and retry'
              : data.error ?? 'merge failed';
        setMergeError((prev) => ({ ...prev, [prNumber]: label }));
        showToast(`PR #${prNumber}: ${label}`, 'err');
      }
    } catch (err) {
      setStatus(snapshot);
      const label = err instanceof Error ? err.message : 'merge failed';
      setMergeError((prev) => ({ ...prev, [prNumber]: label }));
      showToast(`PR #${prNumber}: ${label}`, 'err');
    } finally {
      setMergingPr(null);
    }
  };

  // Inline draft → ready transition for PRs the agent opened in draft
  // mode. Two-step on the backend (REST lookup → GraphQL mutation);
  // here we just fire the PUT and optimistically flip `draft: false`
  // on the local status. On failure we rollback and surface the
  // structured error in the per-PR error map.
  const handleMarkReady = async (prNumber: number) => {
    if (readyingPr !== null || mergingPr !== null) return;
    setReadyingPr(prNumber);
    setMergeError((prev) => {
      if (!(prNumber in prev)) return prev;
      const next = { ...prev };
      delete next[prNumber];
      return next;
    });
    const snapshot = status;
    setStatus((prev) =>
      prev
        ? {
            ...prev,
            recentPRs: prev.recentPRs.map((p) =>
              p.number === prNumber ? { ...p, draft: false } : p,
            ),
          }
        : prev,
    );
    try {
      const res = await fetch(`/api/sync/pulls/${prNumber}/ready`, {
        method: 'PUT',
      });
      const data = (await res.json()) as {
        ok: boolean;
        ready?: boolean;
        error?: string;
      };
      if (data.ok && data.ready) {
        showToast(`PR #${prNumber} marked ready`, 'ok');
        // Re-pull canonical state so reviewer requests / labels that
        // CODEOWNERS auto-fires when a PR transitions from draft to
        // ready show up in the row's reviewer chip immediately.
        void refresh();
      } else {
        setStatus(snapshot);
        const label =
          data.error === 'not_found'
            ? 'mark-ready: PR not found'
            : `mark-ready: ${data.error ?? 'failed'}`;
        setMergeError((prev) => ({ ...prev, [prNumber]: label }));
        showToast(`PR #${prNumber}: ${label}`, 'err');
      }
    } catch (err) {
      setStatus(snapshot);
      const label = `mark-ready: ${err instanceof Error ? err.message : 'failed'}`;
      setMergeError((prev) => ({ ...prev, [prNumber]: label }));
      showToast(`PR #${prNumber}: ${label}`, 'err');
    } finally {
      setReadyingPr(null);
    }
  };

  const handleProposePr = async () => {
    if (proposing) return;
    setProposing(true);
    try {
      const res = await fetch('/api/sync/propose-pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Propose changes from agent',
          body: 'Opened from Settings → Sync. Review the diff and merge if it looks right.',
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        prUrl?: string;
        prNumber?: number;
      };
      if (data.ok && data.prUrl && typeof data.prNumber === 'number') {
        setProposedPr({ number: data.prNumber, url: data.prUrl });
        // Re-pull status so the PR shows up in the "recent PRs" list too.
        void refresh();
        // Clear the inline confirmation after a beat so the row doesn't
        // camp on the toast forever.
        window.setTimeout(() => setProposedPr(null), 12_000);
      } else {
        console.warn('[sync] propose-pr failed', data);
      }
    } catch (err) {
      console.error('[sync] propose-pr failed', err);
    } finally {
      setProposing(false);
    }
  };

  if (!status) {
    return (
      <div className="sync-panel">
        <p className="ot-micro">Checking upstream…</p>
      </div>
    );
  }

  const inSync = status.behind === 0 && status.ahead === 0;
  return (
    <div className="sync-panel">
      <header className="sync-panel__head">
        {inSync ? (
          <span className="ot-pill ot-pill--good">up to date</span>
        ) : (
          <span className="ot-pill ot-pill--accent">{status.behind} behind upstream</span>
        )}
        <span className="ot-micro">
          last checked {Math.round((Date.now() - status.lastChecked) / 60_000)} min ago
        </span>
        <button
          type="button"
          className="sync-panel__refresh"
          onClick={() => void refresh()}
          disabled={refreshing}
          aria-label="Refresh"
          title="Refresh now"
        >
          {refreshing ? '…' : '↻'}
        </button>
      </header>

      <p className="sync-panel__summary">{status.summary}</p>

      {status.commits.length > 0 && (
        <div className="sync-panel__commits">
          <span className="ot-label">
            Recent upstream commits
            <span
              className="sync-panel__commits-hint"
              title="Keyboard: j next · k previous · Enter expand"
            >
              {' '}· <kbd>j</kbd><kbd>k</kbd> nav · <kbd>↵</kbd> expand
            </span>
          </span>
          <ul>
            {status.commits.map((c) => {
              const isOpen = expandedCommits.has(c.sha);
              const isLoading = loadingCommits.has(c.sha);
              const cached = commitDiffs[c.sha];
              const isFocused = focusedCommitSha === c.sha;
              return (
                <li
                  key={c.sha}
                  data-commit-sha={c.sha}
                  className={`sync-commit${isOpen ? ' sync-commit--open' : ''}${isFocused ? ' sync-commit--kbd-focus' : ''}`}
                >
                  <button
                    type="button"
                    className="sync-commit__row"
                    onClick={() => void toggleCommitDiff(c.sha)}
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? 'Collapse' : 'Expand'} diff for commit ${c.sha.slice(0, 7)}`}
                    title={isOpen ? 'Hide diff' : 'Show file-level diff'}
                  >
                    <span className="sync-commit__caret" aria-hidden>
                      {isOpen ? '▾' : '▸'}
                    </span>
                    <code className="sync-commit__sha">{c.sha.slice(0, 7)}</code>
                    <span className="sync-commit__msg">{c.message}</span>
                    <span className="sync-commit__author">{c.author}</span>
                  </button>
                  {isOpen && (
                    <div className="sync-commit__diff">
                      {isLoading && (
                        <p className="ot-micro sync-commit__diff-status">
                          Loading diff…
                        </p>
                      )}
                      {!isLoading && cached === undefined && (
                        <p className="ot-micro sync-commit__diff-status">
                          (no diff yet)
                        </p>
                      )}
                      {!isLoading && typeof cached === 'string' && (
                        <CommitDiffBody diff={cached} />
                      )}
                      {!isLoading && cached && typeof cached === 'object' && (
                        <p className="ot-micro sync-commit__diff-error">
                          ⚠ Couldn't load this commit's diff
                          {cached.error === 'not_found'
                            ? ' (GitHub returned 404 — the SHA may have been force-pushed away)'
                            : cached.error === 'invalid_sha'
                              ? ' (invalid SHA shape)'
                              : ` (${cached.error})`}
                          .{' '}
                          <button
                            type="button"
                            className="sync-commit__diff-retry"
                            onClick={() => {
                              // Drop the cached error + re-fire the
                              // fetch without touching the open state.
                              setCommitDiffs((prev) => {
                                const next = { ...prev };
                                delete next[c.sha];
                                return next;
                              });
                              void loadCommitDiff(c.sha);
                            }}
                          >
                            Retry
                          </button>
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="sync-panel__actions">
        <button className="ot-btn" disabled={inSync || pulling} onClick={handlePull}>
          {pulling ? 'Running dry-run…' : 'Pull latest'}
        </button>
        <button
          className="ot-btn ot-btn--ghost"
          disabled={proposing}
          onClick={() => void handleProposePr()}
          title="Open a draft PR upstream with your local changes"
        >
          {proposing ? 'Opening PR…' : 'Propose PR upstream ↗'}
        </button>
        {proposedPr && (
          <span className="sync-panel__pr-toast">
            ✓ <a href={proposedPr.url} target="_blank" rel="noreferrer">#{proposedPr.number}</a>{' '}
            opened
          </span>
        )}
      </div>

      {dryRun && (
        <DiffViewer
          diff={dryRun}
          onClose={() => setDryRun(null)}
          onApplied={() => {
            // Server returns deployVersion + status: 'queued'. Hide the
            // diff and re-pull status so the "behind upstream" pill
            // resolves to "up to date".
            setDryRun(null);
            void refresh();
          }}
        />
      )}

      <div className="sync-panel__prs">
        <div className="sync-panel__prs-head">
          <span className="ot-label">
            Pull requests this agent has opened upstream
            <span
              className="sync-panel__commits-hint"
              title="Keyboard: j next · k previous · Enter open on GitHub · m merge · r mark ready · ? full list"
            >
              {' '}· <kbd>j</kbd><kbd>k</kbd> nav · <kbd>↵</kbd> open ·{' '}
              <button
                type="button"
                className="sync-panel__shortcuts-help-toggle"
                onClick={() => setShowShortcutsHelp(true)}
                title="Show all keyboard shortcuts (?)"
                aria-label="Show all keyboard shortcuts"
              >
                <kbd>?</kbd> more
              </button>
            </span>
          </span>
          {status.recentPRs.length > 0 && (
            <span className="sync-panel__prs-checked ot-micro">
              checked {syncCheckedAgo(lastCheckedAt)}
              <button
                type="button"
                className="sync-panel__prs-refresh"
                onClick={() => void refresh()}
                disabled={refreshing}
                title="Refresh PR states now"
                aria-label="Refresh"
              >
                ↻
              </button>
            </span>
          )}
        </div>
        {status.recentPRs.length === 0 ? (
          <p className="ot-micro">None yet. Run a Train-mode session that produces a generic skill to surface a contribution candidate.</p>
        ) : (() => {
          // Filter + sort chip cluster. Only render when there are 2+
          // PRs since a single row has nothing to filter against. Both
          // chip rows persist their selection across reloads so the
          // user's preferred lens sticks.
          const counts = {
            all: status.recentPRs.length,
            open: status.recentPRs.filter((p) => p.state === 'open').length,
            merged: status.recentPRs.filter((p) => p.state === 'merged').length,
            closed: status.recentPRs.filter((p) => p.state === 'closed').length,
          };
          const filterByState =
            prFilter === 'all'
              ? status.recentPRs
              : status.recentPRs.filter((p) => p.state === prFilter);
          // Apply the free-text search on top of the state filter.
          // Match against title + number so a user typing "423" or
          // "auth" both work.
          const searchQ = prSearch.trim().toLowerCase();
          const filtered = searchQ
            ? filterByState.filter(
                (p) =>
                  p.title.toLowerCase().includes(searchQ) ||
                  String(p.number).includes(searchQ),
              )
            : filterByState;
          const sorted = filtered.slice().sort((a, b) => {
            if (prSort === 'oldest') return a.openedAt - b.openedAt;
            if (prSort === 'state') {
              // Open first (most actionable), then merged, then closed.
              const order: Record<string, number> = { open: 0, merged: 1, closed: 2 };
              const diff = (order[a.state] ?? 99) - (order[b.state] ?? 99);
              if (diff !== 0) return diff;
              return b.openedAt - a.openedAt;
            }
            return b.openedAt - a.openedAt;
          });
          return (
            <>
              {status.recentPRs.length > 1 && (
                <div className="sync-panel__prs-controls">
                  <div className="sync-panel__prs-filters" role="radiogroup" aria-label="Filter PRs by state">
                    {(['all', 'open', 'merged', 'closed'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={prFilter === s}
                        className={`sync-panel__prs-chip${prFilter === s ? ' sync-panel__prs-chip--active' : ''}`}
                        onClick={() => setPrFilter(s)}
                        disabled={counts[s] === 0 && s !== 'all'}
                      >
                        {s}
                        <span className="sync-panel__prs-chip-n">{counts[s]}</span>
                      </button>
                    ))}
                  </div>
                  <select
                    className="sync-panel__prs-sort"
                    value={prSort}
                    onChange={(e) =>
                      setPrSort(e.target.value as 'newest' | 'oldest' | 'state')
                    }
                    aria-label="Sort PRs"
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="state">Open first, then by date</option>
                  </select>
                  {/* Merge-method picker — applies to single-row
                      merges + the bulk-merge action. Persists to
                      localStorage. Default is squash, which is
                      right for agent-authored single-purpose
                      patches; teams with linear-history or
                      merge-commit conventions can switch here
                      once and never touch it again. */}
                  <label className="sync-panel__prs-merge-method">
                    <span className="ot-micro">merge as</span>
                    <select
                      className="sync-panel__prs-merge-method-select"
                      value={mergeMethod}
                      onChange={(e) =>
                        setMergeMethod(e.target.value as 'squash' | 'merge' | 'rebase')
                      }
                      aria-label="Default merge method"
                      title="Applies to the inline Merge button + the bulk-merge action"
                    >
                      <option value="squash">squash</option>
                      <option value="merge">merge commit</option>
                      <option value="rebase">rebase</option>
                    </select>
                  </label>
                  {/* Free-text PR search — matches title + number,
                      case-insensitive substring. Sits inline with
                      the filter chips + sort so all three narrowing
                      controls cluster together. Escape clears. */}
                  <div className="sync-panel__prs-search">
                    <span
                      className="sync-panel__prs-search-glyph"
                      aria-hidden
                    >
                      ⌕
                    </span>
                    <input
                      type="search"
                      className="sync-panel__prs-search-input"
                      placeholder="Search PR title or #number"
                      value={prSearch}
                      onChange={(e) => setPrSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape' && prSearch) {
                          e.preventDefault();
                          e.stopPropagation();
                          setPrSearch('');
                        }
                      }}
                      aria-label="Search pull requests"
                    />
                    {prSearch && (
                      <button
                        type="button"
                        className="sync-panel__prs-search-clear"
                        onClick={() => setPrSearch('')}
                        title="Clear search (Esc)"
                        aria-label="Clear search"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              )}
              {selectedPrs.size >= 2 && (() => {
                // Bulk-merge action bar — only renders when ≥2 PRs
                // are selected. Skips selections that no longer
                // resolve to a ready PR in the current view (e.g.
                // status refresh just merged one of them out from
                // under the user) so the action's count reflects
                // what would actually fire.
                const stillReady = [...selectedPrs].filter((n) =>
                  sorted.some(
                    (p) =>
                      p.number === n &&
                      p.state === 'open' &&
                      !p.draft &&
                      (p.requestedReviewers ?? 0) === 0,
                  ),
                );
                if (stillReady.length < 2) return null;
                // staleBehind PRs would fail the merge with a
                // not-mergeable error on the GitHub side. We filter
                // them out before firing the parallel POST burst
                // and surface the skipped numbers in a toast so the
                // user knows which ones to rebase first. The
                // user's selection set is left intact so they can
                // still see what was picked — only the merge
                // request itself sees the filtered list.
                const staleNumbers = stillReady.filter((n) =>
                  sorted.some(
                    (p) => p.number === n && p.staleBehind === true,
                  ),
                );
                const mergeable = stillReady.filter(
                  (n) => !staleNumbers.includes(n),
                );
                const progress = bulkMergeProgress;
                const pct =
                  progress && progress.total > 0
                    ? Math.round((progress.done / progress.total) * 100)
                    : 0;
                return (
                  <div className="sync-panel__prs-bulk">
                    <span className="ot-micro">
                      {progress
                        ? `Merging ${progress.done}/${progress.total}${
                            progress.current ? ` · #${progress.current}` : ''
                          }${progress.failures > 0 ? ` · ${progress.failures} failed` : ''}`
                        : staleNumbers.length > 0
                        ? `${stillReady.length} selected · ${staleNumbers.length} stale will be skipped`
                        : `${stillReady.length} selected for bulk merge`}
                    </span>
                    {progress && (
                      <div
                        className="sync-panel__prs-bulk-progress"
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`Bulk merge progress: ${progress.done} of ${progress.total}`}
                      >
                        <div
                          className={`sync-panel__prs-bulk-progress-fill${progress.failures > 0 ? ' sync-panel__prs-bulk-progress-fill--has-failures' : ''}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      className="ot-btn ot-btn--ghost"
                      onClick={() => setSelectedPrs(new Set())}
                      disabled={bulkMerging}
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      className="ot-btn sync-panel__prs-bulk-merge"
                      onClick={() => {
                        // If everything in the selection is stale,
                        // there's nothing to merge — bail loudly
                        // instead of firing an empty request that
                        // would silently no-op.
                        if (mergeable.length === 0) {
                          showToast(
                            `All ${stillReady.length} selected PRs are stale — rebase #${staleNumbers
                              .map((n) => n)
                              .slice(0, 5)
                              .join(', #')}${
                              staleNumbers.length > 5
                                ? ` (+${staleNumbers.length - 5} more)`
                                : ''
                            } before bulk-merging`,
                            'err',
                          );
                          return;
                        }
                        if (staleNumbers.length > 0) {
                          showToast(
                            `Skipping ${staleNumbers.length} stale PR${
                              staleNumbers.length === 1 ? '' : 's'
                            } — rebase #${staleNumbers
                              .slice(0, 5)
                              .join(', #')}${
                              staleNumbers.length > 5
                                ? ` (+${staleNumbers.length - 5} more)`
                                : ''
                            } first`,
                            'info',
                          );
                        }
                        void bulkMergeSelected(mergeable);
                      }}
                      disabled={
                        bulkMerging ||
                        mergingPr !== null ||
                        mergeable.length === 0
                      }
                      title={
                        staleNumbers.length > 0
                          ? `Bulk merge ${mergeable.length} (${staleNumbers.length} stale will be skipped)`
                          : `Bulk merge ${mergeable.length} selected PRs`
                      }
                    >
                      {bulkMerging
                        ? `Merging ${mergeable.length}…`
                        : `${mergeVerb(mergeMethod)} ${mergeable.length} ↩`}
                    </button>
                  </div>
                );
              })()}
              {sorted.length === 0 ? (
                <p className="ot-micro">
                  {prSearch.trim()
                    ? `No PRs match "${prSearch.trim()}"${prFilter === 'all' ? '' : ` in the ${prFilter} filter`}.`
                    : 'No PRs match the active filter.'}
                </p>
              ) : (
          <ul>
            {sorted.map((pr) => {
              const reviewerStatus =
                pr.state !== 'open'
                  ? null
                  : pr.draft
                    ? { label: 'draft', kind: 'draft' as const }
                    : pr.requestedReviewers && pr.requestedReviewers > 0
                      ? {
                          label: `${pr.requestedReviewers} review${pr.requestedReviewers === 1 ? '' : 's'} requested`,
                          kind: 'pending' as const,
                        }
                      : { label: 'ready for review', kind: 'ready' as const };
              // Only "ready" PRs get the inline Merge action — drafts
              // and PRs with pending reviewers need a roundtrip on the
              // GitHub UI to ready/approve first, so showing the button
              // there would just produce 405s from the API. Closed and
              // already-merged states are filtered upstream by the state
              // check itself.
              const canMerge = pr.state === 'open' && reviewerStatus?.kind === 'ready';
              // Draft PRs get the inline "Mark ready" action instead —
              // promotes them out of draft state via the GraphQL
              // markPullRequestReadyForReview mutation. Once ready,
              // the row flips to the canMerge branch on the next
              // refresh() tick.
              const canMarkReady = pr.state === 'open' && reviewerStatus?.kind === 'draft';
              const isMergingThis = mergingPr === pr.number;
              const isReadyingThis = readyingPr === pr.number;
              const inlineError = mergeError[pr.number];
              const isSelected = selectedPrs.has(pr.number);
              return (
                <li
                  key={pr.number}
                  data-pr-number={pr.number}
                  className={`sync-pr sync-pr--${pr.state}${focusedPrNumber === pr.number ? ' sync-pr--kbd-focus' : ''}${isSelected ? ' sync-pr--selected' : ''}`}
                  onClick={async (ev) => {
                    // Shift+click on any empty space in the PR row
                    // copies the PR URL to the clipboard. Plain
                    // clicks on the # link / title still open the
                    // PR (their default anchor behavior), so this
                    // gives keyboard-light users a one-gesture way
                    // to grab the URL without right-click→copy.
                    // We only fire when the click target isn't a
                    // button/anchor/input — otherwise the shift+
                    // click on the merge button (etc.) would
                    // double-fire.
                    if (!ev.shiftKey) return;
                    const target = ev.target as HTMLElement | null;
                    const interactive = target?.closest(
                      'a,button,input,select,textarea,[role="button"]',
                    );
                    if (interactive) return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    try {
                      await navigator.clipboard.writeText(pr.url);
                      showToast(`Copied PR #${pr.number} URL`, 'ok');
                    } catch {
                      showToast('Copy failed', 'err');
                    }
                  }}
                  title="Shift+click anywhere on this row to copy the PR URL"
                >
                  {/* Multi-select toggle — only renders on ready PRs
                      since bulk-merge can only work on those. The
                      bulk-merge action bar pops in when ≥2 are
                      selected. */}
                  {canMerge ? (
                    <button
                      type="button"
                      className={`sync-pr__select${isSelected ? ' sync-pr__select--on' : ''}`}
                      onClick={() => togglePrSelection(pr.number)}
                      aria-label={
                        isSelected
                          ? `Deselect PR #${pr.number}`
                          : `Select PR #${pr.number} for bulk merge`
                      }
                      title={
                        isSelected
                          ? 'Click to deselect'
                          : 'Click to add to the bulk-merge selection'
                      }
                      disabled={bulkMerging}
                    >
                      {isSelected ? '✓' : ' '}
                    </button>
                  ) : (
                    // Non-ready PR — render a placeholder square so
                    // alignment stays consistent across rows.
                    <span className="sync-pr__select sync-pr__select--placeholder" aria-hidden />
                  )}
                  <a href={pr.url} target="_blank" rel="noreferrer">
                    #{pr.number}
                  </a>
                  <span>{pr.title}</span>
                  {reviewerStatus && (
                    <span
                      className={`sync-pr__review sync-pr__review--${reviewerStatus.kind}`}
                      title={
                        reviewerStatus.kind === 'draft'
                          ? 'Marked as draft on GitHub'
                          : reviewerStatus.kind === 'pending'
                            ? `${pr.requestedReviewers} reviewer${pr.requestedReviewers === 1 ? '' : 's'} have not yet approved`
                            : 'Open with no pending reviewers'
                      }
                    >
                      {reviewerStatus.kind === 'draft' ? '✎' : reviewerStatus.kind === 'pending' ? '◐' : '✓'}{' '}
                      {reviewerStatus.label}
                    </span>
                  )}
                  {canMerge && (
                    <button
                      type="button"
                      className="sync-pr__merge"
                      onClick={() => void handleMergePr(pr.number)}
                      disabled={mergingPr !== null || readyingPr !== null}
                      title={`${mergeVerb(mergeMethod)} this PR upstream`}
                    >
                      {isMergingThis
                        ? 'Merging…'
                        : mergeMethod === 'squash'
                          ? 'Merge ↩'
                          : mergeMethod === 'rebase'
                            ? 'Rebase ↩'
                            : 'Merge commit ↩'}
                    </button>
                  )}
                  {canMarkReady && (
                    <button
                      type="button"
                      className="sync-pr__ready"
                      onClick={() => void handleMarkReady(pr.number)}
                      disabled={readyingPr !== null || mergingPr !== null}
                      title="Promote this draft PR to ready-for-review (triggers reviewer requests + CODEOWNERS routing)"
                    >
                      {isReadyingThis ? 'Marking…' : 'Mark ready ↑'}
                    </button>
                  )}
                  <span className={`ot-pill sync-pr__state sync-pr__state--${pr.state}`}>
                    {pr.state}
                  </span>
                  {/* Stale badge — surfaces only for open PRs whose
                      base.sha has drifted from main's current HEAD.
                      Tells the user at a glance which PRs will
                      likely need a rebase before they can be
                      merged cleanly (without forcing the user to
                      click into GitHub to find out). Mute/warn
                      tones rather than danger; this is "heads up,"
                      not "broken." */}
                  {pr.state === 'open' && pr.staleBehind && (
                    <span
                      className="ot-pill sync-pr__stale"
                      title="This PR's base has drifted from main since it was last synced — it'll likely need a rebase before merging cleanly."
                    >
                      ↺ stale
                    </span>
                  )}
                  {/* Inline diff preview toggle — only on open PRs
                      (merged/closed PRs would show a stale diff
                      that's not actionable). Fetches the diff on
                      first expand, caches it so subsequent toggles
                      don't refetch. Reuses the CommitDiffBody
                      renderer since the shape is identical. */}
                  {pr.state === 'open' && (() => {
                    // Once the diff has loaded, parse it for stats
                    // so the Preview pill carries an inline
                    // `+12 −4` chip — the user can see the
                    // change size at a glance without expanding.
                    // The parseDiff helper is already O(lines)
                    // and the diffs we render are small, so we
                    // don't bother memoizing per-pr.
                    const cached = prDiffs[pr.number];
                    let stats: { added: number; removed: number; files: number } | null = null;
                    if (typeof cached === 'string') {
                      const files = parseDiff(cached);
                      let added = 0;
                      let removed = 0;
                      for (const f of files) {
                        added += f.added;
                        removed += f.removed;
                      }
                      stats = { added, removed, files: files.length };
                    }
                    // First-fetch flag: the Preview pill should
                    // show a spinner while the GitHub round-trip is
                    // in flight. We only consider it "loading" when
                    // we've never cached a result before — re-toggles
                    // are instant (cached), so a spinner there would
                    // be misleading. Combining `loadingPrs` with
                    // "no cache yet" gives an honest signal.
                    const isLoading =
                      loadingPrs.has(pr.number) && cached === undefined;
                    return (
                      <button
                        type="button"
                        className={`sync-pr__preview${isLoading ? ' sync-pr__preview--loading' : ''}`}
                        onClick={() => togglePrDiff(pr.number)}
                        aria-expanded={expandedPrs.has(pr.number)}
                        aria-busy={isLoading}
                        disabled={isLoading}
                        title={
                          isLoading
                            ? 'Fetching the diff from GitHub…'
                            : expandedPrs.has(pr.number)
                            ? `Hide PR diff preview${stats ? ` · ${stats.files} file${stats.files === 1 ? '' : 's'} · +${stats.added} −${stats.removed}` : ''}`
                            : 'Show inline diff preview of this PR'
                        }
                      >
                        {isLoading && (
                          <span
                            className="sync-pr__preview-spinner"
                            aria-hidden
                          />
                        )}
                        {isLoading
                          ? 'Loading…'
                          : expandedPrs.has(pr.number)
                          ? 'Hide diff ▴'
                          : 'Preview ▾'}
                        {stats && !isLoading && (
                          <span className="sync-pr__preview-stats" aria-hidden>
                            <span className="sync-pr__preview-stats-files">
                              {stats.files}f
                            </span>
                            <span className="sync-pr__preview-stats-add">
                              +{stats.added}
                            </span>
                            <span className="sync-pr__preview-stats-del">
                              −{stats.removed}
                            </span>
                          </span>
                        )}
                      </button>
                    );
                  })()}
                  {inlineError && (
                    <span
                      className="sync-pr__merge-error ot-micro"
                      title={inlineError}
                    >
                      ⚠ {inlineError}
                    </span>
                  )}
                  {expandedPrs.has(pr.number) && (
                    <div className="sync-pr__diff" style={{ flexBasis: '100%' }}>
                      {loadingPrs.has(pr.number) && (
                        <p className="ot-micro sync-commit__diff-status">
                          Loading PR diff…
                        </p>
                      )}
                      {!loadingPrs.has(pr.number) &&
                        typeof prDiffs[pr.number] === 'string' && (
                          <CommitDiffBody diff={prDiffs[pr.number] as string} />
                        )}
                      {!loadingPrs.has(pr.number) &&
                        prDiffs[pr.number] &&
                        typeof prDiffs[pr.number] === 'object' && (
                          <p className="ot-micro sync-commit__diff-error">
                            ⚠ Couldn't load this PR's diff
                            {(prDiffs[pr.number] as { error: string }).error ===
                            'not_found'
                              ? ' (GitHub returned 404 — the PR may have been deleted)'
                              : ` (${(prDiffs[pr.number] as { error: string }).error})`}
                            .{' '}
                            <button
                              type="button"
                              className="sync-commit__diff-retry"
                              onClick={() => {
                                setPrDiffs((prev) => {
                                  const next = { ...prev };
                                  delete next[pr.number];
                                  return next;
                                });
                                void loadPrDiff(pr.number);
                              }}
                            >
                              Retry
                            </button>
                          </p>
                        )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
              )}
            </>
          );
        })()}
      </div>
      {showShortcutsHelp && (
        <div
          className="sync-panel__shortcuts-help"
          role="dialog"
          aria-modal="true"
          aria-label="Sync panel keyboard shortcuts"
          onClick={(e) => {
            // Click on the backdrop dismisses; click on the card
            // itself is left for selection / scroll.
            if (e.target === e.currentTarget) {
              setShowShortcutsHelp(false);
            }
          }}
        >
          <div
            className="sync-panel__shortcuts-help-card"
            role="document"
          >
            <header className="sync-panel__shortcuts-help-head">
              <h3 className="sync-panel__shortcuts-help-title">
                Keyboard shortcuts
              </h3>
              <button
                type="button"
                className="sync-panel__shortcuts-help-close"
                onClick={() => setShowShortcutsHelp(false)}
                title="Close (Esc)"
                aria-label="Close shortcuts help"
              >
                ✕
              </button>
            </header>
            <dl className="sync-panel__shortcuts-help-list">
              <div className="sync-panel__shortcuts-help-row">
                <dt>
                  <kbd>j</kbd>
                  <span className="sync-panel__shortcuts-help-sep">/</span>
                  <kbd>k</kbd>
                </dt>
                <dd>Navigate the PR list down / up (wraps at edges)</dd>
              </div>
              <div className="sync-panel__shortcuts-help-row">
                <dt>
                  <kbd>↵</kbd>
                </dt>
                <dd>Open the focused PR on GitHub</dd>
              </div>
              <div className="sync-panel__shortcuts-help-row">
                <dt>
                  <kbd>m</kbd>
                </dt>
                <dd>
                  Merge the focused PR
                  <span className="sync-panel__shortcuts-help-note">
                    (gated on ready state — draft / pending-review / stale
                    PRs surface a cause-specific toast)
                  </span>
                </dd>
              </div>
              <div className="sync-panel__shortcuts-help-row">
                <dt>
                  <kbd>r</kbd>
                </dt>
                <dd>Mark the focused draft PR as ready for review</dd>
              </div>
              <div className="sync-panel__shortcuts-help-row">
                <dt>
                  <kbd>c</kbd>
                </dt>
                <dd>
                  Copy the focused PR's URL to the clipboard
                  <span className="sync-panel__shortcuts-help-note">
                    (Shift+click on the row title does the same thing)
                  </span>
                </dd>
              </div>
              <div className="sync-panel__shortcuts-help-row">
                <dt>
                  <kbd>space</kbd>
                </dt>
                <dd>
                  Toggle the focused PR in/out of the bulk-merge selection
                  <span className="sync-panel__shortcuts-help-note">
                    (clicking the ☐ checkbox in the row does the same thing;
                    ≥2 selected pops the bulk action bar)
                  </span>
                </dd>
              </div>
              <div className="sync-panel__shortcuts-help-row">
                <dt>
                  <kbd>?</kbd>
                </dt>
                <dd>Toggle this overlay</dd>
              </div>
              <div className="sync-panel__shortcuts-help-row">
                <dt>
                  <kbd>esc</kbd>
                </dt>
                <dd>Close this overlay</dd>
              </div>
            </dl>
            <footer className="sync-panel__shortcuts-help-foot ot-micro">
              Shortcuts work when the Sync panel is mounted and your
              focus isn't in a text field.
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

// Parse a unified diff into per-file blocks. Splits on `diff --git a/foo b/foo`
// headers when present (the standard git format), otherwise falls back to
// splitting on `+++ b/foo` markers (some Compare API responses omit the
// `diff --git` line). Hunks within a single file stay grouped — each block
// is one collapsible `<details>` so the user can scan filenames first and
// only expand the ones they care about.
interface DiffFile {
  path: string;
  lines: string[];
  added: number;
  removed: number;
  // Count of unresolved-merge marker lines (`<<<<<<<`, `=======`,
  // `>>>>>>>`). When the agent-update workflow's 3-way merge can't
  // auto-reconcile a hunk, these markers get committed with a `WIP:`
  // prefix and surface through the unified diff. We tally them so the
  // file header can warn the user before they hit Apply.
  conflicts: number;
}

// Recognize the three git conflict marker line prefixes. Includes
// `||||||| ` (the rare base-blob marker shown by `merge.conflictStyle =
// diff3`) so users on either default see the warning.
// Module-level highlight helper — wraps every occurrence of `query`
// inside `line` in a <mark>. Case-insensitive substring match.
// Returns a flat node array suitable for dropping into a <span>;
// callers append the newline themselves so they can render with
// or without trailing whitespace depending on context. Guarded
// against empty queries (returns the raw text) and degenerate
// zero-length matches (would loop forever otherwise). Pulled out
// of the DiffViewer body so the per-commit CommitDiffBody can
// share the same highlight semantics without duplicating the
// search loop.
function highlightDiffLine(
  line: string,
  query: string,
): React.ReactNode[] {
  const q = query.trim();
  if (!q) return [line];
  const needle = q.toLowerCase();
  if (needle.length === 0) return [line];
  const lower = line.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < line.length) {
    const idx = lower.indexOf(needle, i);
    if (idx === -1) {
      out.push(line.slice(i));
      break;
    }
    if (idx > i) out.push(line.slice(i, idx));
    out.push(
      <mark key={`m-${key++}`} className="sync-find__hit">
        {line.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
  }
  return out;
}

function isConflictMarker(line: string): boolean {
  return (
    line.startsWith('<<<<<<<') ||
    line.startsWith('>>>>>>>') ||
    line.startsWith('=======') ||
    line.startsWith('||||||| ')
  );
}

function parseDiff(raw: string): DiffFile[] {
  if (!raw) return [];
  const rawLines = raw.split('\n');
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;

  const flush = () => {
    if (current && current.lines.length > 0) files.push(current);
  };

  for (const line of rawLines) {
    if (line.startsWith('diff --git')) {
      flush();
      // `diff --git a/path b/path` — pull the b-side path.
      const match = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
      const path = match ? match[2]! : line.replace(/^diff --git\s+/, '');
      current = { path, lines: [line], added: 0, removed: 0, conflicts: 0 };
      continue;
    }
    if (line.startsWith('+++ b/') && (!current || current.lines.some((l) => l.startsWith('@@')))) {
      // Compare API sometimes omits `diff --git`. Treat the `+++ b/` as the
      // start of a new file if we don't already have one open. The second
      // condition guards the trailing `+++ /dev/null` deletion case.
      flush();
      current = { path: line.replace(/^\+\+\+ b\//, ''), lines: [line], added: 0, removed: 0, conflicts: 0 };
      continue;
    }
    if (!current) {
      // Preamble (commit hash, etc.) before the first file header — bucket
      // it into a synthetic block so nothing is lost.
      current = { path: '(preamble)', lines: [line], added: 0, removed: 0, conflicts: 0 };
      continue;
    }
    current.lines.push(line);
    if (line.startsWith('+') && !line.startsWith('+++')) current.added += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) current.removed += 1;
    // Bare-line conflict markers OR diff-prefixed (`+<<<<<<<`) appearing
    // as upstream additions both count — the markers may show up as
    // brand-new added lines when the workflow committed a WIP merge.
    const stripped = line.startsWith('+') || line.startsWith('-') ? line.slice(1) : line;
    if (isConflictMarker(stripped)) current.conflicts += 1;
  }
  flush();
  return files.filter((f) => f.path !== '(preamble)' || f.lines.some((l) => l.trim().length > 0));
}

// Render a per-file diff as two parallel columns: removed lines on the
// left (before), added lines on the right (after). Context lines render
// on both sides; hunks (`@@`) span both columns with a soft divider.
// We pair `-` and `+` runs within each hunk so the user can scan the
// edit pair at a glance. Unpaired removals/additions get an empty cell
// opposite. Best-effort — large diffs still benefit from the unified
// view's cheaper rendering, which is why the toggle exists.
function SplitDiff({ lines }: { lines: string[] }) {
  // Walk the lines and group into rows. A row is either a hunk header
  // (full-width) or a {left, right} pair. We accumulate consecutive `-`
  // lines and `+` lines, then zip them so removals + additions appear on
  // the same row when they line up.
  type Row =
    | { kind: 'hunk'; text: string }
    | { kind: 'ctx'; left: string; right: string }
    | { kind: 'pair'; left: string | null; right: string | null };
  const rows: Row[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flushPairs = () => {
    const max = Math.max(removed.length, added.length);
    for (let i = 0; i < max; i++) {
      rows.push({
        kind: 'pair',
        left: removed[i] ?? null,
        right: added[i] ?? null,
      });
    }
    removed = [];
    added = [];
  };
  for (const raw of lines) {
    if (raw.startsWith('diff --git') || raw.startsWith('+++') || raw.startsWith('---')) {
      // File headers — surface as a hunk-style row so the user knows
      // where the boundary is (rarely useful in split since each file
      // has its own <details>).
      continue;
    }
    if (raw.startsWith('@@')) {
      flushPairs();
      rows.push({ kind: 'hunk', text: raw });
      continue;
    }
    if (raw.startsWith('+')) {
      added.push(raw.slice(1));
      continue;
    }
    if (raw.startsWith('-')) {
      removed.push(raw.slice(1));
      continue;
    }
    // Context line — pairs flush before context to keep ordering.
    flushPairs();
    rows.push({ kind: 'ctx', left: raw, right: raw });
  }
  flushPairs();

  return (
    <div className="sync-split">
      {rows.map((r, i) => {
        if (r.kind === 'hunk') {
          return (
            <div key={`h-${i}`} className="sync-split__hunk">
              {r.text}
            </div>
          );
        }
        if (r.kind === 'ctx') {
          return (
            <div key={`c-${i}`} className="sync-split__row">
              <pre className="sync-split__cell sync-split__cell--ctx">{r.left}</pre>
              <pre className="sync-split__cell sync-split__cell--ctx">{r.right}</pre>
            </div>
          );
        }
        // Paired add/del: highlight the words that actually changed
        // between left and right. When one side is null this collapses
        // to plain whole-line coloring (everything's added or removed).
        const leftSegs =
          r.left != null && r.right != null
            ? diffWords(r.left, r.right).left
            : null;
        const rightSegs =
          r.left != null && r.right != null
            ? diffWords(r.left, r.right).right
            : null;
        return (
          <div key={`p-${i}`} className="sync-split__row">
            <pre
              className={`sync-split__cell${r.left != null ? ' sync-split__cell--del' : ' sync-split__cell--empty'}`}
            >
              {leftSegs
                ? leftSegs.map((seg, j) =>
                    seg.changed ? (
                      <mark key={j} className="sync-split__word sync-split__word--del">
                        {seg.text}
                      </mark>
                    ) : (
                      <span key={j}>{seg.text}</span>
                    ),
                  )
                : (r.left ?? '')}
            </pre>
            <pre
              className={`sync-split__cell${r.right != null ? ' sync-split__cell--add' : ' sync-split__cell--empty'}`}
            >
              {rightSegs
                ? rightSegs.map((seg, j) =>
                    seg.changed ? (
                      <mark key={j} className="sync-split__word sync-split__word--add">
                        {seg.text}
                      </mark>
                    ) : (
                      <span key={j}>{seg.text}</span>
                    ),
                  )
                : (r.right ?? '')}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

// Word-level diff between two single-line strings. Tokenizes by
// whitespace/punctuation boundaries (so we get meaningful unit-level
// highlights, not character-level noise), runs a longest-common-
// subsequence pass to identify the runs that match, then walks both
// sides emitting `{text, changed}` segments. Used by SplitDiff to
// pop only the words that actually moved between an add/del pair.
interface WordSeg {
  text: string;
  changed: boolean;
}
function diffWords(a: string, b: string): { left: WordSeg[]; right: WordSeg[] } {
  // Tokenize: capture each `[\w]+` run or any single non-word char as
  // its own token. Keeps whitespace + punctuation visible in the
  // output so the rendered line reads identically to the source.
  const tokenize = (s: string): string[] => s.match(/\w+|[^\w]/g) ?? [];
  const at = tokenize(a);
  const bt = tokenize(b);
  const m = at.length;
  const n = bt.length;
  // Standard O(m·n) LCS table. Skip when one side is empty.
  if (m === 0 || n === 0) {
    return {
      left: m === 0 ? [] : [{ text: a, changed: true }],
      right: n === 0 ? [] : [{ text: b, changed: true }],
    };
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (at[i - 1] === bt[j - 1]) dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      else dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  // Backtrack to label each token as "match" or "changed".
  const leftLabels: boolean[] = new Array(m).fill(true); // true = changed
  const rightLabels: boolean[] = new Array(n).fill(true);
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (at[i - 1] === bt[j - 1]) {
      leftLabels[i - 1] = false;
      rightLabels[j - 1] = false;
      i -= 1;
      j -= 1;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  // Collapse runs of equal `changed` flag into single segments so the
  // renderer emits fewer DOM nodes (and adjacent words with the same
  // status read as one highlight).
  const collapse = (tokens: string[], labels: boolean[]): WordSeg[] => {
    const out: WordSeg[] = [];
    let buf = '';
    let bufChanged: boolean | null = null;
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k]!;
      const c = labels[k]!;
      if (bufChanged === null) {
        buf = t;
        bufChanged = c;
      } else if (bufChanged === c) {
        buf += t;
      } else {
        out.push({ text: buf, changed: bufChanged });
        buf = t;
        bufChanged = c;
      }
    }
    if (bufChanged !== null) out.push({ text: buf, changed: bufChanged });
    return out;
  };
  return {
    left: collapse(at, leftLabels),
    right: collapse(bt, rightLabels),
  };
}

// Compact inline diff renderer for the per-commit drilldown in the
// Recent-upstream-commits list. Reuses parseDiff so files surface as
// the same path/added/removed tuples DiffViewer renders, but every
// file starts collapsed (commits often touch a lot of files; the
// summary is the useful surface, the body is on-demand).
function CommitDiffBody({ diff }: { diff: string }) {
  const files = parseDiff(diff);
  const totalAdded = files.reduce((s, f) => s + f.added, 0);
  const totalRemoved = files.reduce((s, f) => s + f.removed, 0);
  // Per-commit find query. Independent state per CommitDiffBody
  // instance so each expanded commit has its own scope — searching
  // for "fetch" in commit A doesn't leak into commit B. Filters
  // files with zero matches and highlights every occurrence inline
  // via the shared `highlightDiffLine` helper.
  const [findQuery, setFindQuery] = useState('');
  const findMatches = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!q) return null;
    return files.map((f) => {
      let n = 0;
      for (const line of f.lines) {
        if (line.toLowerCase().includes(q)) n += 1;
      }
      return n;
    });
  }, [files, findQuery]);
  const totalFindHits = findMatches?.reduce((s, n) => s + n, 0) ?? 0;
  const filesAfterFind = findMatches
    ? files.filter((_, i) => (findMatches[i] ?? 0) > 0)
    : files;
  if (files.length === 0) {
    return (
      <p className="ot-micro sync-commit__diff-status">
        (empty diff — likely a merge commit or whitespace-only change)
      </p>
    );
  }
  return (
    <div className="sync-commit__diff-body">
      <div className="sync-commit__diff-summary ot-micro">
        <span>
          {files.length} file{files.length === 1 ? '' : 's'}
        </span>
        <span className="sync-file__add">+{totalAdded}</span>
        <span className="sync-file__del">−{totalRemoved}</span>
        {/* Only render the find input when there's enough surface
            area to make searching worthwhile — single-file
            commits already render their full diff above, so the
            user can use the browser's native Ctrl+F there. */}
        {files.length >= 2 && (
          <span className="sync-commit__diff-find">
            <span className="sync-panel__find-glyph" aria-hidden>⌕</span>
            <input
              type="search"
              className="sync-commit__diff-find-input"
              placeholder="Find in this commit"
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && findQuery) {
                  e.preventDefault();
                  e.stopPropagation();
                  setFindQuery('');
                }
              }}
              aria-label="Find in this commit's diff"
            />
            {findQuery && (
              <span
                className={`sync-panel__find-count${totalFindHits === 0 ? ' sync-panel__find-count--zero' : ''}`}
              >
                {totalFindHits}
              </span>
            )}
          </span>
        )}
      </div>
      {filesAfterFind.length === 0 && findQuery ? (
        <p className="ot-micro sync-commit__diff-status">
          No matches for "{findQuery}" in this commit.
        </p>
      ) : (
        filesAfterFind.map((f, i) => {
          // Per-file match count for the summary chip — re-resolved
          // from the original index so an active filter doesn't
          // misalign the lookup.
          const origIdx = files.indexOf(f);
          const hitCount = findMatches?.[origIdx] ?? 0;
          const openForFind = findQuery.trim().length > 0 && hitCount > 0;
          return (
        <details
          key={`${f.path}-${i}`}
          className="sync-file"
          open={openForFind || files.length === 1}
        >
          <summary className="sync-file__head">
            <span className="sync-file__path">{f.path}</span>
            <span className="sync-file__stats">
              {findQuery.trim() && hitCount > 0 && (
                <span
                  className="sync-find__file-count"
                  title={`${hitCount} match${hitCount === 1 ? '' : 'es'} in this file`}
                >
                  ⌕ {hitCount}
                </span>
              )}
              {f.added > 0 && <span className="sync-file__add">+{f.added}</span>}
              {f.removed > 0 && <span className="sync-file__del">−{f.removed}</span>}
            </span>
          </summary>
          <pre>
            {f.lines.map((line, j) => {
              const cls =
                line.startsWith('+++') ||
                line.startsWith('---') ||
                line.startsWith('diff --git')
                  ? 'diff--file'
                  : line.startsWith('+')
                    ? 'diff--add'
                    : line.startsWith('-')
                      ? 'diff--del'
                      : line.startsWith('@@')
                        ? 'diff--hunk'
                        : 'diff--ctx';
              return (
                <span key={j} className={cls}>
                  {findQuery.trim() ? highlightDiffLine(line, findQuery) : line}
                  {'\n'}
                </span>
              );
            })}
          </pre>
        </details>
          );
        })
      )}
    </div>
  );
}

function DiffViewer({
  diff,
  onClose,
  onApplied,
}: {
  diff: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const files = parseDiff(diff);
  // Single-file diffs default to expanded; multi-file collapses everything so
  // the user gets a filename overview first.
  const defaultOpen = files.length === 1;
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);
  // Bulk file expansion state — `null` defers to each <details>'s own
  // initial state (defaultOpen), a `true` forces every file open, a
  // `false` collapses everything. Bumping a counter forces re-render
  // so toggling the same state twice still applies (e.g. expand → user
  // closes one → expand again).
  const [expandAll, setExpandAll] = useState<{
    open: boolean | null;
    bump: number;
  }>({ open: null, bump: 0 });
  // Esc dismisses the dialog. The Toast handler already probes for
  // `[role="dialog"]` before firing its own Esc handler so toasts
  // don't poach this. Skipped when focus is in a text input/textarea
  // so Esc can still blur fields normally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const editable = (e.target as HTMLElement | null)?.isContentEditable;
      if (tag === 'input' || tag === 'textarea' || editable) return;
      if (applying) return; // don't bail mid-apply
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, applying]);
  // Total line stats — quick header summary so the user knows how big
  // the change set is before they start expanding files.
  const totalAdded = files.reduce((s, f) => s + f.added, 0);
  const totalRemoved = files.reduce((s, f) => s + f.removed, 0);
  // Copy the full raw diff to the clipboard so the user can paste it
  // into a bug report / chat without scrolling and selecting. Same
  // pattern the audit + deploy bundles use.
  const copyDiff = async () => {
    try {
      await navigator.clipboard.writeText(diff);
      showToast(`Copied ${totalAdded + totalRemoved} change line${totalAdded + totalRemoved === 1 ? '' : 's'}`, 'ok');
    } catch {
      showToast('Copy failed', 'err');
    }
  };
  // Multi-phase progress strip shown while the apply flow is running.
  // Phases: 0 sending, 1 queued, 2 building, 3 deployed. -1 = error.
  // The actual redeploy happens out-of-band (agent-deploy.yml), so the
  // post-queue phases are time-based — they give the user a felt sense
  // of progress without lying about real CI state.
  const APPLY_PHASES = [
    'Sending diff to worker',
    'Apply queued',
    'GitHub Actions kicked off',
    'Live deploy in progress',
  ] as const;
  const [applyPhase, setApplyPhase] = useState<number>(-2); // -2 = idle
  // Aggregate conflict count across all files. When >0, the dry-run
  // banner gains a warning chip and the Apply button gains a confirm
  // prompt so a user can't redeploy a half-merged source tree without
  // acknowledging the risk.
  const totalConflicts = files.reduce((sum, f) => sum + f.conflicts, 0);
  // View mode — `unified` (the existing single-column +/- view) or
  // `split` (before/after columns side-by-side). The split renderer
  // groups removed lines on the left + added lines on the right, with
  // context rendered on both sides. Persists to localStorage so the
  // user's preference sticks across sessions.
  const [view, setView] = useState<'unified' | 'split'>(() => {
    if (typeof window === 'undefined') return 'unified';
    return window.localStorage.getItem('openthink:diffView') === 'split'
      ? 'split'
      : 'unified';
  });
  const setViewMode = (next: 'unified' | 'split') => {
    setView(next);
    window.localStorage.setItem('openthink:diffView', next);
  };
  // Find-in-diff — substring filter applied per-file. Empty query
  // shows everything; non-empty hides files with zero matches and
  // wraps matching lines in a yellow-highlight span. Ctrl/Cmd+F
  // captures focus to the input so the user can drive it from the
  // keyboard the way they drive a browser's native find. Auto-
  // expands files that have matches so the user doesn't have to
  // open each one to see why it survived the filter.
  const [findQuery, setFindQuery] = useState('');
  const findInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Only intercept Ctrl/Cmd+F when focus is inside the dialog —
      // otherwise the page's native find should still work. The
      // dialog's role attribute is the anchor; we look up the
      // active element's closest match.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        const root = (e.target as HTMLElement | null)?.closest?.('[role="dialog"]');
        if (!root) return;
        e.preventDefault();
        findInputRef.current?.focus();
        findInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Per-file match counts, computed once per (files, findQuery) pair.
  // Drives the filter (zero-match files collapse out of the list)
  // and the per-file count chip in the summary line.
  const findMatches = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!q) return null;
    return files.map((f) => {
      let n = 0;
      for (const line of f.lines) {
        if (line.toLowerCase().includes(q)) n += 1;
      }
      return n;
    });
  }, [files, findQuery]);
  const totalFindHits =
    findMatches?.reduce((sum, n) => sum + n, 0) ?? 0;
  const filesAfterFind = findMatches
    ? files.filter((_, i) => (findMatches[i] ?? 0) > 0)
    : files;
  // Highlight wrapper for the dry-run viewer's per-file unified diff.
  // Delegates to the module-level helper so the per-commit drilldown
  // shares the same matching semantics; the trailing newline is
  // appended here since the unified-diff renderer relies on the
  // line's `\n` to break to the next line in a <pre>.
  const highlightLine = (line: string): React.ReactNode => {
    return [...highlightDiffLine(line, findQuery), '\n'];
  };

  const apply = async () => {
    if (totalConflicts > 0) {
      const ok = window.confirm(
        `${totalConflicts} unresolved merge marker${totalConflicts === 1 ? '' : 's'} detected across the diff. Applying will redeploy with those markers in the source files. Continue?`,
      );
      if (!ok) return;
    }
    setApplying(true);
    setApplyResult(null);
    setApplyPhase(0); // Sending
    try {
      const res = await fetch('/api/sync/apply', { method: 'POST' });
      const data = (await res.json()) as { ok?: boolean; deployVersion?: string; status?: string };
      if (data.ok) {
        setApplyPhase(1); // Queued
        setApplyResult(`Queued · ${data.deployVersion ?? 'pending'}`);
        // Walk the user through the post-queue phases on a short timer
        // so they get the felt sense of "things are happening" before
        // the panel collapses. agent-deploy.yml takes it from here for
        // real — these phases are display-only.
        window.setTimeout(() => setApplyPhase(2), 600);
        window.setTimeout(() => setApplyPhase(3), 1300);
        window.setTimeout(() => {
          onApplied();
          setApplyPhase(-2);
        }, 2200);
      } else {
        setApplyPhase(-1); // Error
        setApplyResult('Apply failed. Try again.');
      }
    } catch {
      setApplyPhase(-1);
      setApplyResult('Apply failed. Check your connection.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="sync-panel__diff" role="dialog" aria-label="Dry-run diff">
      <header>
        <span className="ot-label">
          Dry-run · {files.length} {files.length === 1 ? 'file' : 'files'} will change
        </span>
        {totalConflicts > 0 && (
          <span
            className="sync-panel__conflict-chip"
            title="One or more files contain unresolved merge markers. Review the highlighted lines before applying."
          >
            ⚠ {totalConflicts} conflict marker{totalConflicts === 1 ? '' : 's'}
          </span>
        )}
        {(totalAdded > 0 || totalRemoved > 0) && (
          <span className="sync-panel__diff-stats ot-micro">
            <span className="sync-file__add">+{totalAdded}</span>{' '}
            <span className="sync-file__del">−{totalRemoved}</span>
          </span>
        )}
        <div className="sync-panel__view-toggle" role="tablist">
          <button
            type="button"
            role="tab"
            className={`sync-panel__view-opt${view === 'unified' ? ' sync-panel__view-opt--active' : ''}`}
            onClick={() => setViewMode('unified')}
            aria-pressed={view === 'unified'}
          >
            unified
          </button>
          <button
            type="button"
            role="tab"
            className={`sync-panel__view-opt${view === 'split' ? ' sync-panel__view-opt--active' : ''}`}
            onClick={() => setViewMode('split')}
            aria-pressed={view === 'split'}
          >
            split
          </button>
        </div>
        {files.length > 1 && (
          <div className="sync-panel__bulk-toggle">
            <button
              type="button"
              className="sync-panel__bulk-btn"
              onClick={() =>
                setExpandAll((prev) => ({ open: true, bump: prev.bump + 1 }))
              }
              title="Expand every file in the diff"
            >
              Expand all
            </button>
            <button
              type="button"
              className="sync-panel__bulk-btn"
              onClick={() =>
                setExpandAll((prev) => ({ open: false, bump: prev.bump + 1 }))
              }
              title="Collapse every file"
            >
              Collapse all
            </button>
          </div>
        )}
        <button
          type="button"
          className="sync-panel__bulk-btn"
          onClick={() => void copyDiff()}
          title="Copy the full unified diff to the clipboard"
        >
          ⧉ Copy
        </button>
        {/* Find-in-diff input — captures Ctrl/Cmd+F when focus is
            anywhere in the dialog. Filters per-file (zero-match
            files collapse out of the list) and highlights inline
            matches with a yellow tint. The hit-count chip on the
            right gives the user a quick "is my pattern in this
            diff?" answer without scrolling. */}
        <div className="sync-panel__find">
          <span className="sync-panel__find-glyph" aria-hidden>
            ⌕
          </span>
          <input
            ref={findInputRef}
            type="search"
            className="sync-panel__find-input"
            placeholder="Find in diff (Ctrl+F)"
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && findQuery) {
                e.preventDefault();
                e.stopPropagation();
                setFindQuery('');
              }
            }}
            aria-label="Find in diff"
          />
          {findQuery && (
            <>
              <span
                className={`sync-panel__find-count${totalFindHits === 0 ? ' sync-panel__find-count--zero' : ''}`}
                title={
                  totalFindHits === 0
                    ? 'No matches in any file'
                    : `${totalFindHits} match${totalFindHits === 1 ? '' : 'es'} across ${filesAfterFind.length} file${filesAfterFind.length === 1 ? '' : 's'}`
                }
              >
                {totalFindHits}
              </span>
              <button
                type="button"
                className="sync-panel__find-clear"
                onClick={() => {
                  setFindQuery('');
                  findInputRef.current?.focus();
                }}
                title="Clear find (Esc)"
                aria-label="Clear find"
              >
                ×
              </button>
            </>
          )}
        </div>
        <button className="sync-panel__close" onClick={onClose} aria-label="Close diff (Esc)">
          ×
        </button>
      </header>
      <div
        className="sync-panel__files"
        ref={(node) => {
          // Each bump of `expandAll.bump` triggers this callback (since
          // the ref signature is stable but React calls it on render).
          // We sync every <details> in the container to the latest
          // expand-all state. Skipped when `open === null` (initial
          // mount — defer to each <details>'s defaultOpen). Reading
          // `expandAll` inside this callback satisfies the linter's
          // closure-capture concerns without an explicit useEffect.
          if (!node) return;
          if (expandAll.open === null) return;
          const detailsList = node.querySelectorAll<HTMLDetailsElement>('.sync-file');
          for (const det of detailsList) det.open = expandAll.open;
        }}
        data-expand-bump={expandAll.bump}
      >
        {files.length === 0 ? (
          <p className="ot-micro" style={{ padding: '12px 16px', margin: 0 }}>
            No changes detected.
          </p>
        ) : filesAfterFind.length === 0 ? (
          <p className="ot-micro sync-panel__find-empty">
            No matches for "{findQuery}" in any file.
          </p>
        ) : (
          filesAfterFind.map((f, i) => {
            // Re-resolve the file's original index so the per-file
            // match count lines up with the unfiltered findMatches
            // array. files.indexOf is fine here — the array is
            // ≤200 entries and re-rendered only when files change.
            const origIdx = files.indexOf(f);
            const hitCount = findMatches?.[origIdx] ?? 0;
            // When a find query is active, auto-expand files with
            // matches so the user doesn't have to click each one.
            // The expand-all bulk button still overrides this via
            // the ref-callback below.
            const openForFind = findQuery.trim().length > 0 && hitCount > 0;
            return (
            <details
              key={`${f.path}-${i}`}
              className="sync-file"
              open={openForFind || defaultOpen}
            >
              <summary className="sync-file__head">
                <span className="sync-file__path">{f.path}</span>
                <span className="sync-file__stats">
                  {findQuery.trim() && hitCount > 0 && (
                    <span
                      className="sync-find__file-count"
                      title={`${hitCount} match${hitCount === 1 ? '' : 'es'} in this file`}
                    >
                      ⌕ {hitCount}
                    </span>
                  )}
                  {f.conflicts > 0 && (
                    <span
                      className="sync-file__conflict"
                      title={`${f.conflicts} unresolved merge marker${f.conflicts === 1 ? '' : 's'}`}
                    >
                      ⚠ {f.conflicts}
                    </span>
                  )}
                  {f.added > 0 && <span className="sync-file__add">+{f.added}</span>}
                  {f.removed > 0 && <span className="sync-file__del">−{f.removed}</span>}
                </span>
              </summary>
              {view === 'unified' ? (
                <pre>
                  {f.lines.map((line, j) => {
                    const stripped = line.startsWith('+') || line.startsWith('-')
                      ? line.slice(1)
                      : line;
                    const conflict = isConflictMarker(stripped);
                    const cls =
                      line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git')
                        ? 'diff--file'
                        : line.startsWith('+')
                          ? conflict
                            ? 'diff--add diff--conflict'
                            : 'diff--add'
                          : line.startsWith('-')
                            ? conflict
                              ? 'diff--del diff--conflict'
                              : 'diff--del'
                            : line.startsWith('@@')
                              ? 'diff--hunk'
                              : conflict
                                ? 'diff--ctx diff--conflict'
                                : 'diff--ctx';
                    return (
                      <span key={j} className={cls}>
                        {highlightLine(line)}
                      </span>
                    );
                  })}
                </pre>
              ) : (
                <SplitDiff lines={f.lines} />
              )}
            </details>
            );
          })
        )}
      </div>
      {applyPhase >= 0 && (
        <ol className="sync-panel__phases" role="status" aria-live="polite">
          {APPLY_PHASES.map((label, i) => (
            <li
              key={i}
              className={`sync-panel__phase${
                i < applyPhase
                  ? ' sync-panel__phase--done'
                  : i === applyPhase
                    ? ' sync-panel__phase--active'
                    : ''
              }`}
            >
              <span className="sync-panel__phase-glyph" aria-hidden>
                {i < applyPhase ? '✓' : i === applyPhase ? '◐' : '○'}
              </span>
              <span className="sync-panel__phase-label">{label}</span>
            </li>
          ))}
        </ol>
      )}
      {applyPhase === -1 && (
        <p className="sync-panel__phase-err" role="alert">
          ⊘ Apply failed — your local changes were not pushed. Check the
          worker logs and try again.
        </p>
      )}
      <footer>
        <button
          className="ot-btn"
          onClick={() => void apply()}
          disabled={applying || files.length === 0}
        >
          {applying ? 'Applying…' : 'Apply & redeploy'}
        </button>
        <button className="ot-btn ot-btn--ghost" onClick={onClose} disabled={applying}>
          Cancel
        </button>
        {applyResult && <span className="sync-panel__apply-result">{applyResult}</span>}
      </footer>
    </div>
  );
}

// Short relative-time formatter for the "checked Xs ago" indicator.
function syncCheckedAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1_000))}s ago`;
  if (diff < 60 * 60_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

const FALLBACK_STATUS: SyncStatus = {
  upstreamSha: 'e593b06',
  localSha: 'e593b06',
  ahead: 0,
  behind: 0,
  summary: 'You are on the latest upstream version of openthink3.',
  lastChecked: Date.now(),
  commits: [],
  recentPRs: [],
};
