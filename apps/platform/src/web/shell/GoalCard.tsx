// GoalCard — inline progress for a /goal workflow run.
//
// Polls /api/goal/<id> every 1.5s while the run is queued/running and shows
// each step's status as it transitions. When the workflow hits an approval
// gate, the card surfaces an "approve / decline" pair; clicking POSTs to
// /api/goal/<id>/approve and the workflow unblocks.
//
// The polling cadence is deliberately conservative — the SSE/WS upgrade for
// long-running workflows lands when we wire Workflow.sendEvent end-to-end.

import { useEffect, useState } from 'react';
import { showToast } from './Toast';
import './GoalCard.css';

interface GoalStep {
  id: string;
  description: string;
  state?: 'pending' | 'running' | 'done' | 'error' | 'awaiting_approval';
  requiresApproval?: boolean;
}

interface GoalSnapshot {
  id: string;
  agentName: string;
  goal: string;
  status:
    | 'queued'
    | 'running'
    | 'awaiting_approval'
    | 'completed'
    | 'aborted'
    | 'cancelled'
    | 'error';
  steps?: GoalStep[];
  awaitingStepId?: string;
  createdAt: number;
  finishedAt?: number;
}

interface Props {
  runId: string;
  onApprove?: (stepId: string) => void;
}

export function GoalCard({ runId }: Props) {
  const [snap, setSnap] = useState<GoalSnapshot | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/goal/${encodeURIComponent(runId)}`);
        const data = (await res.json()) as { ok: boolean; run?: GoalSnapshot };
        if (cancelled) return;
        if (data.ok && data.run) {
          setSnap(data.run);
          const stillRunning =
            data.run.status === 'queued' ||
            data.run.status === 'running' ||
            data.run.status === 'awaiting_approval';
          if (stillRunning) {
            timer = window.setTimeout(poll, 1_500);
          }
        }
      } catch {
        if (!cancelled) timer = window.setTimeout(poll, 4_000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [runId]);

  const approve = async (stepId: string, approved: boolean) => {
    setApproving(stepId);
    try {
      await fetch(`/api/goal/${encodeURIComponent(runId)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepId, approved }),
      });
    } finally {
      setApproving(null);
    }
  };

  const cancel = async () => {
    if (!window.confirm('Cancel this goal? Pending steps will be skipped.')) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/goal/${encodeURIComponent(runId)}/cancel`, {
        method: 'POST',
      });
      if (res.ok) {
        showToast('Goal cancelled', 'ok');
        // Optimistically reflect the terminal state — the next poll will
        // confirm from the canonical KV snapshot.
        setSnap((prev) =>
          prev
            ? {
                ...prev,
                status: 'cancelled',
                steps: prev.steps?.map((s) =>
                  s.state === 'running' || s.state === 'awaiting_approval'
                    ? { ...s, state: 'error' }
                    : s,
                ),
              }
            : prev,
        );
      } else {
        showToast('Cancel failed', 'err');
      }
    } catch {
      showToast('Cancel failed', 'err');
    } finally {
      setCancelling(false);
    }
  };

  const isRunning =
    snap?.status === 'queued' ||
    snap?.status === 'running' ||
    snap?.status === 'awaiting_approval';

  if (!snap) {
    return (
      <aside className="goal-card goal-card--loading" aria-live="polite">
        <header className="goal-card__head">
          <span className="goal-card__pill">/goal · queued</span>
          <span className="goal-card__id ot-micro">{runId.slice(0, 12)}</span>
        </header>
        <p className="goal-card__loading">starting workflow…</p>
      </aside>
    );
  }

  return (
    <aside className={`goal-card goal-card--${snap.status}`} aria-live="polite">
      <header className="goal-card__head">
        <span className="goal-card__pill">
          /goal · {snap.status.replace('_', ' ')}
        </span>
        <span className="goal-card__id ot-micro">{snap.id.slice(0, 16)}</span>
        {isRunning && (
          <button
            type="button"
            className="goal-card__cancel"
            onClick={() => void cancel()}
            disabled={cancelling}
            title="Cancel this goal"
            aria-label="Cancel"
          >
            {cancelling ? '…' : '✕ Cancel'}
          </button>
        )}
      </header>
      <h4 className="goal-card__goal">{snap.goal}</h4>
      <ol className="goal-card__steps">
        {(snap.steps ?? []).map((s) => (
          <li key={s.id} className={`goal-card__step goal-card__step--${s.state ?? 'pending'}`}>
            <span className="goal-card__step-glyph" aria-hidden>
              {s.state === 'done'
                ? '●'
                : s.state === 'running'
                  ? '◐'
                  : s.state === 'error'
                    ? '⊗'
                    : s.state === 'awaiting_approval'
                      ? '⏸'
                      : '○'}
            </span>
            <div className="goal-card__step-body">
              <strong>{s.id}</strong>
              <span className="goal-card__step-desc">{s.description}</span>
              {s.state === 'awaiting_approval' && (
                <div className="goal-card__approval">
                  <button
                    type="button"
                    className="ot-btn"
                    disabled={approving === s.id}
                    onClick={() => void approve(s.id, true)}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="ot-btn ot-btn--ghost"
                    disabled={approving === s.id}
                    onClick={() => void approve(s.id, false)}
                  >
                    Skip
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
        {(!snap.steps || snap.steps.length === 0) && (
          <li className="goal-card__step goal-card__step--pending">
            <span className="goal-card__step-glyph" aria-hidden>○</span>
            <div className="goal-card__step-body">
              <strong>decompose</strong>
              <span className="goal-card__step-desc">
                workflow queued — waiting for the first checkpoint…
              </span>
            </div>
          </li>
        )}
      </ol>
      {snap.status === 'completed' && (
        <footer className="goal-card__done">
          ✓ done in {((snap.finishedAt ?? Date.now()) - snap.createdAt) / 1000}s
        </footer>
      )}
      {snap.status === 'aborted' && (
        <footer className="goal-card__aborted">⊗ aborted</footer>
      )}
      {snap.status === 'cancelled' && (
        <footer className="goal-card__aborted">⊘ cancelled</footer>
      )}
    </aside>
  );
}
