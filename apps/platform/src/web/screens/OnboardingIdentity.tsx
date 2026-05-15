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
              ↻ regenerate
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
}: {
  step: number;
  of: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="onboarding">
      <header className="ot-topbar">
        <div className="ot-container ot-topbar-inner">
          <a href="#" className="ot-brand">
            <span className="ot-brand-dot" /> OpenThink
          </a>
          <span className="ot-micro">
            step {step} of {of}
          </span>
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
