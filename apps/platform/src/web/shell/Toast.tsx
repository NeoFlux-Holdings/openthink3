// Lightweight global toast host. Listens for `openthink:toast` custom
// events from anywhere in the app and shows them stacked bottom-right.
//
// Queue behavior:
//   - Each toast carries a kind-aware lifetime (ok/info: 2.6s, err: 4.6s).
//   - Stack capped at MAX_STACK; oldest toast pops when overflow hits.
//   - Duplicate detection: identical message+kind fired within 600ms
//     collapses into the active toast with a `×N` counter so spammy
//     callers don't fill the column.
//   - Hover pauses the auto-dismiss; mouse-leave resumes from where it
//     left off. Lets the user actually finish reading a long message.
//   - A thin progress bar at the bottom of each pill mirrors the
//     remaining lifetime so the user can see how long they have.

import { useEffect, useRef, useState } from 'react';
import './Toast.css';

export interface ToastPayload {
  id: string;
  message: string;
  kind?: 'ok' | 'err' | 'info';
}

interface ActiveToast extends ToastPayload {
  /** When this toast was first shown — base for the progress bar. */
  enqueuedAt: number;
  /** Total lifetime in ms (kind-dependent). */
  lifetime: number;
  /** ms already elapsed when last paused; reused on resume. */
  elapsed: number;
  /** Timestamp of the in-flight resume (when not paused). 0 = paused. */
  resumedAt: number;
  /** Duplicate-collapse counter; shown as `×N` when >1. */
  count: number;
}

const MAX_STACK = 5;
const DEDUPE_WINDOW_MS = 600;

// Module-level helper so any caller can fire a toast without importing the
// component or threading state through props.
export function showToast(message: string, kind: 'ok' | 'err' | 'info' = 'ok') {
  window.dispatchEvent(
    new CustomEvent<ToastPayload>('openthink:toast', {
      detail: { id: crypto.randomUUID(), message, kind },
    }),
  );
}

function lifetimeFor(kind: ToastPayload['kind']): number {
  return kind === 'err' ? 4600 : 2600;
}

export function ToastHost() {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  // Per-toast timeout ids so we can cancel + reschedule on pause/resume.
  const timersRef = useRef<Map<string, number>>(new Map());
  // Re-render every 80ms while toasts are visible so the progress bars
  // animate smoothly. We could use requestAnimationFrame but 80ms is
  // enough resolution for a 2.6s timer and far cheaper.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (toasts.length === 0) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 80);
    return () => window.clearInterval(id);
  }, [toasts.length]);

  // Schedule the auto-dismiss for a toast. Uses the remaining lifetime
  // (lifetime - elapsed) so resume picks up where pause left off.
  const arm = (id: string, remaining: number) => {
    const existing = timersRef.current.get(id);
    if (existing) window.clearTimeout(existing);
    const handle = window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(id);
    }, remaining);
    timersRef.current.set(id, handle);
  };

  // Esc-to-dismiss-all — fires only when no other modal is currently
  // taking Esc. We probe the DOM for any `[role="dialog"]` element; if
  // one is mounted (ShortcutsHelp, command palette, artifact viewer,
  // confirm modals) we let Esc reach it so the toast stack doesn't
  // poach the keystroke and accidentally close it. Skipped while the
  // user is typing in an input/textarea so Esc still blurs them.
  useEffect(() => {
    if (toasts.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const editable = (e.target as HTMLElement | null)?.isContentEditable;
      if (tag === 'input' || tag === 'textarea' || editable) return;
      // Any open modal grabs Esc first.
      if (document.querySelector('[role="dialog"]')) return;
      // Drop every visible toast in one keystroke. We don't
      // preventDefault here so other passive handlers (e.g. analytics)
      // still see the event.
      for (const handle of timersRef.current.values()) {
        window.clearTimeout(handle);
      }
      timersRef.current.clear();
      setToasts([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toasts.length]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastPayload>).detail;
      if (!detail) return;
      const now = Date.now();
      setToasts((prev) => {
        // Dedupe: if the most-recent toast has the same kind+message and
        // was enqueued within the dedupe window, bump its counter and
        // reset its timer instead of creating a new pill.
        const tail = prev[prev.length - 1];
        if (
          tail &&
          tail.message === detail.message &&
          (tail.kind ?? 'ok') === (detail.kind ?? 'ok') &&
          now - tail.enqueuedAt < DEDUPE_WINDOW_MS + tail.lifetime
        ) {
          const next = prev.slice(0, -1);
          const refreshed: ActiveToast = {
            ...tail,
            enqueuedAt: now,
            elapsed: 0,
            resumedAt: now,
            count: tail.count + 1,
          };
          arm(refreshed.id, refreshed.lifetime);
          return [...next, refreshed];
        }
        // Fresh toast. Trim the oldest if we'd overflow.
        const incoming: ActiveToast = {
          ...detail,
          enqueuedAt: now,
          lifetime: lifetimeFor(detail.kind),
          elapsed: 0,
          resumedAt: now,
          count: 1,
        };
        const merged = [...prev, incoming];
        while (merged.length > MAX_STACK) {
          const dropped = merged.shift();
          if (dropped) {
            const h = timersRef.current.get(dropped.id);
            if (h) {
              window.clearTimeout(h);
              timersRef.current.delete(dropped.id);
            }
          }
        }
        arm(incoming.id, incoming.lifetime);
        return merged;
      });
    };
    window.addEventListener('openthink:toast', onToast);
    return () => {
      window.removeEventListener('openthink:toast', onToast);
      for (const handle of timersRef.current.values()) {
        window.clearTimeout(handle);
      }
      timersRef.current.clear();
    };
  }, []);

  const dismiss = (id: string) => {
    const h = timersRef.current.get(id);
    if (h) {
      window.clearTimeout(h);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const pause = (id: string) => {
    const h = timersRef.current.get(id);
    if (h) {
      window.clearTimeout(h);
      timersRef.current.delete(id);
    }
    const now = Date.now();
    setToasts((prev) =>
      prev.map((t) =>
        t.id === id && t.resumedAt > 0
          ? { ...t, elapsed: t.elapsed + (now - t.resumedAt), resumedAt: 0 }
          : t,
      ),
    );
  };

  const resume = (id: string) => {
    const now = Date.now();
    setToasts((prev) =>
      prev.map((t) => {
        if (t.id !== id || t.resumedAt > 0) return t;
        const remaining = Math.max(200, t.lifetime - t.elapsed);
        arm(id, remaining);
        return { ...t, resumedAt: now };
      }),
    );
  };

  if (toasts.length === 0) return null;
  const now = Date.now();
  return (
    <div className="ot-toast-host" role="status" aria-live="polite">
      {toasts.map((t, i) => {
        // Live-elapsed includes time accrued during the current resume
        // window (so the bar keeps moving between re-renders).
        const liveElapsed =
          t.elapsed + (t.resumedAt > 0 ? now - t.resumedAt : 0);
        const remainingPct = Math.max(
          0,
          Math.min(100, 100 - (liveElapsed / t.lifetime) * 100),
        );
        return (
          <div
            key={t.id}
            className={`ot-toast ot-toast--${t.kind ?? 'ok'}`}
            style={{ animationDelay: `${i * 30}ms` }}
            onMouseEnter={() => pause(t.id)}
            onMouseLeave={() => resume(t.id)}
            onFocus={() => pause(t.id)}
            onBlur={() => resume(t.id)}
          >
            <button
              type="button"
              className="ot-toast__body"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >
              <span className="ot-toast-glyph" aria-hidden>
                {t.kind === 'err' ? '✕' : t.kind === 'info' ? 'i' : '✓'}
              </span>
              <span className="ot-toast-msg">{t.message}</span>
              {t.count > 1 && (
                <span className="ot-toast-count" aria-label={`Repeated ${t.count} times`}>
                  ×{t.count}
                </span>
              )}
            </button>
            <span
              className="ot-toast__progress"
              aria-hidden
              style={{ width: `${remainingPct}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}
