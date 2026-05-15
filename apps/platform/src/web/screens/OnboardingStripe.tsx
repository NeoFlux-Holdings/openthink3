import { useState } from 'react';

import { OnboardingFrame } from './OnboardingIdentity';
import type { AppFlowState } from '../App';

interface Props {
  flow: AppFlowState;
  merge: (patch: Partial<AppFlowState>) => void;
  next: () => void;
}

// v1.0 stub: the real Stripe Projects integration goes through embedded checkout
// + automatic CF account creation. For iteration 1 we surface the cost summary and
// kick to the deploy stub so the full flow renders end-to-end.
export function OnboardingStripe({ flow, merge, next }: Props) {
  const [domain, setDomain] = useState(`${flow.agentName}.com`);
  const [tld, setTld] = useState('com');

  const start = async () => {
    merge({ customDomain: domain });
    const res = await fetch('/api/deploy/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName: flow.agentName,
        email: flow.email,
        accessEmails: [],
      }),
    });
    const data = (await res.json()) as { ok: boolean; deployId?: string };
    if (data.ok && data.deployId) {
      merge({ deployId: data.deployId });
      next();
    }
  };

  return (
    <OnboardingFrame step={3} of={3} title="Pick a domain, fund the agent." subtitle="We'll create your Cloudflare account, register the domain, and deploy.">
      <div className="onboarding__split onboarding__split-card">
        <div className="onboarding__form">
          <div className="onboarding__field">
            <label className="ot-label">Domain</label>
            <div className="onboarding__name-row">
              <input
                className="ot-input"
                value={domain.split('.')[0]}
                onChange={(e) => setDomain(`${e.target.value}.${tld}`)}
              />
              <select
                className="ot-input"
                style={{ maxWidth: 110 }}
                value={tld}
                onChange={(e) => {
                  setTld(e.target.value);
                  setDomain(`${domain.split('.')[0]}.${e.target.value}`);
                }}
              >
                <option value="com">.com</option>
                <option value="ai">.ai</option>
                <option value="dev">.dev</option>
                <option value="xyz">.xyz</option>
              </select>
            </div>
            <p className="ot-micro">Live availability check on blur · v1.1.</p>
          </div>

          <div className="onboarding__field">
            <label className="ot-label">Spending cap</label>
            <input className="ot-input" value="$100 / month per provider" readOnly />
            <p className="ot-micro">Hard floor across every approval mode. Adjustable later.</p>
          </div>

          <div className="onboarding__field">
            <label className="ot-label">Total today</label>
            <div
              className="ot-card ot-card--soft"
              style={{ padding: 16, display: 'grid', gap: 4, fontSize: 14 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Domain — 1yr {tld}</span>
                <span>$12.00</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Cloudflare workers</span>
                <span>$0.00 today</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontWeight: 600,
                  marginTop: 6,
                  borderTop: '1px solid var(--ot-rule)',
                  paddingTop: 6,
                }}
              >
                <span>Charged now</span>
                <span>$12.00</span>
              </div>
            </div>
          </div>

          <div className="onboarding__actions">
            <button className="ot-btn" onClick={start}>
              Pay & deploy →
            </button>
          </div>
        </div>

        <aside className="onboarding__token-preview" aria-label="What we'll do">
          <h4>What we'll do</h4>
          <div className="onboarding__token-step">
            <span className="onboarding__token-step-num">1</span>
            <div className="onboarding__token-step-body">
              <strong>Take your payment</strong>
              <br />
              Stripe checkout — embedded. We never see card details.
            </div>
          </div>
          <div className="onboarding__token-step">
            <span className="onboarding__token-step-num">2</span>
            <div className="onboarding__token-step-body">
              <strong>Register the domain</strong>
              <br />
              <code>{domain}</code> — auto-renewed, gated by your spend cap.
            </div>
          </div>
          <div className="onboarding__token-step">
            <span className="onboarding__token-step-num">3</span>
            <div className="onboarding__token-step-body">
              <strong>Create your Cloudflare account</strong>
              <br />
              Stripe is your identity; we provision CF behind it.
            </div>
          </div>
          <div className="onboarding__token-step">
            <span className="onboarding__token-step-num">4</span>
            <div className="onboarding__token-step-body">
              <strong>Deploy your agent</strong>
              <br />
              Worker, DOs, storage, Access — all set up for you.
            </div>
          </div>
          <p className="ot-micro">
            You can swap to a self-hosted Cloudflare token at any time from Settings → Cloudflare.
          </p>
        </aside>
      </div>
      <button className="onboarding__back" onClick={() => (window.location.hash = '#/onboarding/fork')}>
        ← back
      </button>
    </OnboardingFrame>
  );
}
