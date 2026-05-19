import { useEffect, useRef, useState } from 'react';

import type { AppFlowState } from '../App';
import type { DeployState, DeployStep } from '@shared/types';
import './DeployProgress.css';

interface Props {
  flow: AppFlowState;
  merge: (patch: Partial<AppFlowState>) => void;
  next: () => void;
}

const STATE_GLYPH: Record<DeployStep['state'], string> = {
  pending: '○',
  running: '◐',
  done: '●',
  error: '⊗',
};

export function DeployProgress({ flow, next }: Props) {
  const [state, setState] = useState<DeployState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [streamKey, setStreamKey] = useState(0);
  // EventSource connection lost / failed — tracks reconnect attempts
  // for the backoff loop. Cleared on next successful frame.
  const [streamError, setStreamError] = useState<{
    reconnectsAttempted: number;
  } | null>(null);
  // Per-step log expansion state. Errored steps auto-expand on first mount
  // (handled in an effect below) so the user sees the failure detail
  // immediately. The Set lives in component state so we don't lose
  // expanded rows when the stream pushes a fresh snapshot.
  const [logsOpen, setLogsOpen] = useState<Set<string>>(new Set());
  const toggleLog = (id: string) =>
    setLogsOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const startRef = useRef<number>(Date.now());
  // Track when each step first entered the `running` state so we can
  // render a live "Xs in flight" timer on the running step (the
  // previous implementation just showed `…`). Server only reports
  // `durationMs` on completion, so this is a client-side timestamp
  // captured the first time we see a step transition into running.
  // Cleared on retry so a re-run starts the clock fresh.
  const stepStartRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!flow.deployId) return;
    const url = `/api/deploy/${flow.deployId}/stream`;
    const es = new EventSource(url);
    let reconnectTimer: number | null = null;

    es.addEventListener('snapshot', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as DeployState;
      setState(data);
      startRef.current = data.startedAt;
      // Clear any pending stream-error notice — a successful frame
      // proves the connection is healthy again.
      setStreamError(null);
    });

    es.addEventListener('step', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { index: number; state: DeployStep };
      setState((prev) =>
        prev
          ? {
              ...prev,
              steps: prev.steps.map((s, i) => (i === data.index ? data.state : s)),
            }
          : prev,
      );
    });

    es.addEventListener('done', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as DeployState;
      setState(data);
      setFinished(true);
      setStreamError(null);
      es.close();
    });

    es.onerror = () => {
      es.close();
      // EventSource doesn't tell us whether the connection was lost
      // mid-frame or never opened — treat both as a recoverable
      // hiccup. Auto-bump streamKey on an exponential backoff so the
      // effect re-mounts the EventSource without user action; surface a
      // banner so the user sees we're working on it and can manually
      // retry sooner if they want.
      if (finished) return; // post-done errors are noise
      setStreamError((prev) => {
        const attempt = (prev?.reconnectsAttempted ?? 0) + 1;
        return { reconnectsAttempted: attempt };
      });
    };

    return () => {
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      es.close();
    };
  }, [flow.deployId, streamKey, finished]);

  // Backoff-driven auto-reconnect — bumps streamKey when a stream error
  // is present. 1s → 2s → 4s → 8s cap so a flaky network self-heals
  // without the user having to babysit it.
  useEffect(() => {
    if (!streamError || finished) return;
    const delay = Math.min(8_000, 1_000 * 2 ** (streamError.reconnectsAttempted - 1));
    const t = window.setTimeout(() => setStreamKey((k) => k + 1), delay);
    return () => window.clearTimeout(t);
  }, [streamError, finished]);

  useEffect(() => {
    if (finished) return;
    const id = window.setInterval(() => setElapsed(Date.now() - startRef.current), 200);
    return () => window.clearInterval(id);
  }, [finished]);

  // Auto-expand any errored step's log pane on first observation so the
  // user sees the failure detail without an extra click.
  useEffect(() => {
    if (!state) return;
    const erroredIds = state.steps
      .filter((s) => s.state === 'error')
      .map((s) => s.id);
    if (erroredIds.length === 0) return;
    setLogsOpen((prev) => {
      const next = new Set(prev);
      for (const id of erroredIds) next.add(id);
      return next;
    });
  }, [state]);

  // First-sighting timestamp capture for any step transitioning to
  // `running`. Mutates a ref (not state) since we only need the
  // value at render time and the 200ms elapsed-counter interval
  // already triggers the necessary re-renders. Skipped on steps
  // we've already timestamped so a snapshot replay doesn't reset
  // the clock.
  useEffect(() => {
    if (!state) return;
    const starts = stepStartRef.current;
    const now = Date.now();
    for (const s of state.steps) {
      if (s.state === 'running' && !(s.id in starts)) {
        starts[s.id] = now;
      }
    }
  }, [state]);

  const hostname = state?.hostname ?? `${flow.agentName}.workers.dev`;
  const elapsedSec = (elapsed / 1000).toFixed(elapsed > 10_000 ? 0 : 1);
  const filledPct = state
    ? (state.steps.filter((s) => s.state === 'done').length / state.steps.length) * 100
    : 0;
  const erroredStep = state?.steps.find((s) => s.state === 'error');

  const retry = async () => {
    if (!flow.deployId || retrying) return;
    setRetrying(true);
    try {
      const res = await fetch(`/api/deploy/${flow.deployId}/retry`, { method: 'POST' });
      const data = (await res.json()) as { ok: boolean; retried?: number };
      if (data.ok) {
        // Bumping streamKey re-mounts the EventSource so we get a fresh
        // stream from the new (pending) state the worker just wrote.
        setStreamKey((k) => k + 1);
        startRef.current = Date.now();
        setElapsed(0);
        setFinished(false);
        // Reset per-step timestamps so the retry's running step gets
        // a fresh clock instead of inheriting the previous attempt's
        // start time.
        stepStartRef.current = {};
      }
    } catch {
      /* surface via the existing error state */
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="deploy">
      <header className="deploy__topbar">
        <div className="ot-container ot-topbar-inner">
          <a href="#" className="ot-brand">
            <span className="ot-brand-dot" /> OpenThink
          </a>
          <span className="ot-micro">{finished ? `live · ${hostname}` : `deploying · ${flow.agentName}`}</span>
        </div>
      </header>

      <main className="deploy__main">
        {!finished ? (
          <div className="deploy__card" aria-live="polite">
            <span className="deploy__eyebrow">In flight</span>
            <h2 className="deploy__title">
              Deploying <em>{flow.agentName}</em>
            </h2>
            {streamError && (
              <div className="deploy__stream-err" role="status">
                <span className="deploy__stream-err-glyph" aria-hidden>↻</span>
                <div className="deploy__stream-err-body">
                  <strong>Live stream interrupted</strong>
                  <p className="ot-micro">
                    Reconnecting (attempt {streamError.reconnectsAttempted})…
                    the deploy is still running on the worker — we'll
                    pick up the latest state automatically.
                  </p>
                </div>
                <button
                  type="button"
                  className="ot-btn ot-btn--ghost"
                  onClick={() => setStreamKey((k) => k + 1)}
                >
                  Reconnect now
                </button>
              </div>
            )}
            <div className="deploy__timeline">
              <div className="deploy__rail" style={{ '--filled': `${filledPct}%` } as React.CSSProperties}>
                <div className="deploy__rail-fill" />
              </div>
              <ol className="deploy__steps">
                {state?.steps.map((s) => {
                  const hasLog = (s.log && s.log.length > 0) || !!s.error;
                  const open = logsOpen.has(s.id);
                  // Live elapsed counter for the currently-running step.
                  // Reads the captured start timestamp from the ref;
                  // the 200ms `elapsed` setInterval drives the re-
                  // render so the displayed number ticks without
                  // needing its own subscription. Falls back to the
                  // wall-clock since the deploy started if we somehow
                  // missed the running transition (snapshot delivered
                  // mid-run after a tab reload).
                  const stepStart = stepStartRef.current[s.id];
                  const liveMs =
                    s.state === 'running'
                      ? stepStart
                        ? Date.now() - stepStart
                        : elapsed
                      : 0;
                  const liveSec =
                    liveMs > 0 ? (liveMs / 1000).toFixed(liveMs > 10_000 ? 0 : 1) : '0';
                  return (
                    <li
                      key={s.id}
                      className={`deploy__step deploy__step--${s.state}${open ? ' deploy__step--open' : ''}`}
                    >
                      <button
                        type="button"
                        className="deploy__step-row"
                        onClick={() => hasLog && toggleLog(s.id)}
                        disabled={!hasLog}
                        title={hasLog ? (open ? 'Hide logs' : 'Show logs') : ''}
                        aria-expanded={open}
                      >
                        <span className="deploy__glyph" aria-hidden>
                          {STATE_GLYPH[s.state]}
                        </span>
                        <span className="deploy__label">{s.label}</span>
                        <span className="deploy__dur">
                          {s.state === 'done' && s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : ''}
                          {s.state === 'running' && (
                            <span
                              className="deploy__dur-live"
                              title="Time elapsed since this step started"
                            >
                              {liveSec}s
                            </span>
                          )}
                          {s.state === 'error' && s.durationMs
                            ? `${(s.durationMs / 1000).toFixed(1)}s`
                            : ''}
                        </span>
                        {hasLog && (
                          <span className="deploy__step-chevron" aria-hidden>
                            {open ? '▾' : '▸'}
                          </span>
                        )}
                      </button>
                      {open && hasLog && (
                        <div className="deploy__step-log-wrap">
                          <pre className="deploy__step-log">
                            {s.error
                              ? `error: ${s.error}\n\n`
                              : ''}
                            {(s.log ?? []).join('\n')}
                          </pre>
                          {/* Copy this step's log block to the
                              clipboard so the user can paste it into a
                              bug report without having to manually
                              select multi-line preformatted text. */}
                          <button
                            type="button"
                            className="deploy__step-log-copy"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              const text = `${s.label}${s.error ? ` (error)` : ''}\n${s.error ? `error: ${s.error}\n\n` : ''}${(s.log ?? []).join('\n')}`;
                              void navigator.clipboard
                                ?.writeText(text)
                                .catch(() => undefined);
                            }}
                            title="Copy this step's log to clipboard"
                            aria-label="Copy log"
                          >
                            ⧉ Copy
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
            {erroredStep && (
              <div className="deploy__error" role="alert">
                <div className="deploy__error-head">
                  <span className="deploy__error-glyph" aria-hidden>⊗</span>
                  <strong>{erroredStep.label} failed</strong>
                </div>
                {erroredStep.error && (
                  <p className="deploy__error-msg">{erroredStep.error}</p>
                )}
                <div className="deploy__error-actions">
                  <button
                    type="button"
                    className="ot-btn"
                    onClick={() => void retry()}
                    disabled={retrying}
                  >
                    {retrying ? 'Retrying…' : `Retry from ${erroredStep.label} ↻`}
                  </button>
                  <a
                    className="ot-btn ot-btn--ghost"
                    href="#/onboarding/identity"
                  >
                    Start over
                  </a>
                </div>
              </div>
            )}
            <div className="deploy__footer">
              <span>Live logs ▾</span>
              <div className="deploy__footer-meta">
                {state && state.steps.some((s) => (s.log && s.log.length > 0) || s.error) && (
                  <button
                    type="button"
                    className="deploy__bundle-dl"
                    onClick={() => {
                      if (!state) return;
                      // Concatenate every step's log + error in
                      // canonical order so the bundle reads as a
                      // diagnostic timeline. Saved with a stamped
                      // filename so multiple retries don't clobber
                      // each other in the user's downloads folder.
                      const sections = state.steps.map((s) => {
                        const head = `=== ${s.label} (${s.state}${
                          s.durationMs ? `, ${(s.durationMs / 1000).toFixed(1)}s` : ''
                        }) ===`;
                        const body = s.error
                          ? `error: ${s.error}\n\n${(s.log ?? []).join('\n')}`
                          : (s.log ?? []).join('\n');
                        return `${head}\n${body || '(no output)'}`;
                      });
                      const text = [
                        `OpenThink deploy log — ${flow.agentName}`,
                        `deployId: ${flow.deployId ?? '(unknown)'}`,
                        `startedAt: ${new Date(state.startedAt).toISOString()}`,
                        `elapsedMs: ${elapsed}`,
                        '',
                        ...sections,
                      ].join('\n');
                      const blob = new Blob([text], {
                        type: 'text/plain;charset=utf-8',
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      const stamp = new Date()
                        .toISOString()
                        .slice(0, 16)
                        .replace(/[:T]/g, '-');
                      a.href = url;
                      a.download = `deploy-${flow.agentName || 'agent'}-${stamp}.log`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      window.setTimeout(() => URL.revokeObjectURL(url), 500);
                    }}
                    title="Download every step's logs as a single text file (for bug reports)"
                  >
                    ↓ Bundle
                  </button>
                )}
                <span>
                  <strong className="deploy__elapsed">{elapsedSec}s</strong> elapsed
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="deploy__card deploy__card--done">
            <span className="deploy__success-eyebrow">Ready</span>
            <h2 className="deploy__title">
              Your agent is <em>live.</em>
            </h2>
            <div className="deploy__hostname">
              <code>{hostname}</code>
              <button
                className="deploy__copy"
                onClick={() => navigator.clipboard.writeText(hostname).catch(() => undefined)}
                aria-label="Copy hostname"
              >
                copy
              </button>
            </div>
            {flow.customDomain && hostname === flow.customDomain && (
              <div className="deploy__dns-hint">
                <span className="deploy__dns-hint-glyph" aria-hidden>ⓘ</span>
                <div>
                  <strong>Custom domain may take a few minutes to propagate.</strong>
                  <p className="ot-micro">
                    DNS records were just registered with Cloudflare. The
                    `.workers.dev` fallback (
                    <code>
                      {flow.subdomain
                        ? `${flow.agentName}.${flow.subdomain}.workers.dev`
                        : `${flow.agentName}.workers.dev`}
                    </code>
                    ) is live now if you want to chat right away.
                  </p>
                </div>
              </div>
            )}
            <button className="ot-btn deploy__success-cta" onClick={next}>
              Say hi to your agent →
            </button>
            <div className="deploy__try">
              <h4>What to try first</h4>
              <ul>
                <li>"Plan my week"</li>
                <li>"Research the agent ecosystem in 2026"</li>
                <li>"Build me a personal homepage"</li>
              </ul>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
