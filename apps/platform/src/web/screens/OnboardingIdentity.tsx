import { useCallback, useEffect, useState } from 'react';

import type { AppFlowState } from '../App';
import './Onboarding.css';

interface Props {
  flow: AppFlowState;
  merge: (patch: Partial<AppFlowState>) => void;
  next: () => void;
}

export function OnboardingIdentity({ flow, merge, next }: Props) {
  const [email, setEmail] = useState(flow.email);
  const [agentName, setAgentName] = useState(flow.agentName);
  const [loadingName, setLoadingName] = useState(false);
  // Eager-bubble email + agentName up to the parent's `flow` on every
  // edit so a hash-navigate to Fork (or back/forward) doesn't drop a
  // half-typed value. The Fork screen already validates `flow.agentName`
  // → if we waited for Continue to merge, the user could back out and
  // lose their work.
  useEffect(() => {
    if (email) merge({ email });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);
  useEffect(() => {
    if (agentName) merge({ agentName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentName]);
  // Warm-reload detection: if the user already has one or more workspaces
  // (i.e. they completed onboarding once before), surface a "resume to
  // chat" banner at the top so a stale `#/onboarding/identity` bookmark
  // doesn't force them to re-walk the wizard. We don't auto-redirect —
  // some users genuinely want to set up a *second* agent, so they keep
  // the option to start fresh.
  const [resumeTarget, setResumeTarget] = useState<{
    name: string;
    agentName: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/workspaces')
      .then((r) => r.json())
      .then((data: {
        workspaces?: Array<{ id: string; name: string; agentName: string }>;
        activeId?: string | null;
      }) => {
        if (cancelled || !data.workspaces || data.workspaces.length === 0) return;
        const active =
          data.workspaces.find((w) => w.id === data.activeId) ?? data.workspaces[0];
        if (active) setResumeTarget({ name: active.name, agentName: active.agentName });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const regenerate = useCallback(async () => {
    setLoadingName(true);
    try {
      const res = await fetch('/api/onboarding/suggest-name');
      const data = (await res.json()) as { name: string };
      setAgentName(data.name);
    } catch {
      setAgentName(suggestionFallback());
    } finally {
      setLoadingName(false);
    }
  }, []);

  useEffect(() => {
    if (!agentName) void regenerate();
  }, [agentName, regenerate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    merge({ email, agentName });
    next();
  };

  const isValid = /.+@.+\..+/.test(email);

  return (
    <OnboardingFrame step={1} of={3} title="Let's get you an agent." subtitle="Two fields. We pick the rest.">
      {resumeTarget && (
        <div className="onboarding__resume" role="status">
          <div className="onboarding__resume-body">
            <span className="onboarding__resume-glyph" aria-hidden>↩</span>
            <div>
              <strong>{resumeTarget.name}</strong> is already deployed.
              <p className="ot-micro">
                You set this up earlier as <code>{resumeTarget.agentName}</code>.
                Skip ahead to chat, or stay here to spin up a second agent.
              </p>
            </div>
          </div>
          <div className="onboarding__resume-actions">
            <button
              type="button"
              className="ot-btn"
              onClick={() => {
                merge({ agentName: resumeTarget.agentName });
                window.location.hash = '#/shell';
              }}
            >
              → Resume to chat
            </button>
            <button
              type="button"
              className="ot-btn ot-btn--ghost"
              onClick={() => setResumeTarget(null)}
            >
              Start fresh
            </button>
          </div>
        </div>
      )}
      <form onSubmit={handleSubmit} className="onboarding__form">
        <div className="onboarding__field">
          <label className="ot-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="ot-input"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <p className="ot-micro">Gates access to your deployed agent via Cloudflare Access.</p>
        </div>

        <div className="onboarding__field">
          <label className="ot-label" htmlFor="agent-name">
            Agent name <span className="onboarding__optional">optional</span>
          </label>
          <div className="onboarding__name-row">
            <input
              id="agent-name"
              className="ot-input"
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value.toLowerCase())}
              placeholder="drift-wombat"
            />
            <button
              type="button"
              className="onboarding__regenerate"
              onClick={regenerate}
              disabled={loadingName}
              aria-label="Suggest another name"
            >
              regenerate
            </button>
          </div>
          <p className="ot-micro">We picked one for you. Change it if you'd like.</p>
        </div>

        <div className="onboarding__actions">
          <button type="submit" className="ot-btn" disabled={!isValid}>
            Continue →
          </button>
        </div>
      </form>
    </OnboardingFrame>
  );
}

function suggestionFallback(): string {
  const adj = ['drift', 'copper', 'soft', 'velvet', 'amber'];
  const noun = ['wombat', 'onion', 'kestrel', 'comet', 'mole'];
  const a = adj[Math.floor(Math.random() * adj.length)];
  const n = noun[Math.floor(Math.random() * noun.length)];
  return `${a}-${n}`;
}

export function OnboardingFrame({
  step,
  of,
  title,
  subtitle,
  children,
  onBack,
}: {
  step: number;
  of: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  // Optional escape hatch — when provided, renders a "← Back" link in
  // the topbar AND wires Escape to call it. Lets each onboarding step
  // declare its own back target without each component duplicating the
  // key listener.
  onBack?: () => void;
}) {
  const pct = (step / of) * 100;
  // Esc → back, when the parent offered one. We attach at the window
  // level (rather than the card) so the user can be focused anywhere —
  // a text input, a button, the body — and still escape out. Skipped
  // when the input is already focused on a textarea (multi-line Esc
  // typically means "blur", not "go back").
  useEffect(() => {
    if (!onBack) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA') return;
      e.preventDefault();
      onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);
  return (
    <div className="onboarding">
      <header className="onboarding__topbar">
        <div className="ot-container onboarding__topbar-inner">
          <a href="#" className="ot-brand">
            <span className="ot-brand-dot" /> OpenThink
          </a>
          {onBack && (
            <button
              type="button"
              className="onboarding__back"
              onClick={onBack}
              aria-label="Back to previous step"
              title="Back (Esc)"
            >
              ← Back
            </button>
          )}
          <div className="onboarding__progress" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={of}>
            <span className="onboarding__progress-label">
              <span className="onboarding__progress-num">{String(step).padStart(2, '0')}</span>
              <span className="onboarding__progress-divider">/</span>
              <span>{String(of).padStart(2, '0')}</span>
            </span>
            <div className="onboarding__progress-track">
              <div className="onboarding__progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      </header>
      <main className="onboarding__main">
        <div className="onboarding__card">
          <h2 className="onboarding__title">{title}</h2>
          {subtitle && <p className="onboarding__subtitle">{subtitle}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}
