import { useEffect, useState } from 'react';
import { OnboardingFrame } from './OnboardingIdentity';
import type { AppFlowState } from '../App';

interface Props {
  flow: AppFlowState;
  onPickToken: () => void;
  onPickStripe: () => void;
  back?: () => void;
}

// Validation rules for an agent name that will become either a
// workers.dev subdomain or a custom worker route. CF requires
// alphanumerics + hyphens, ≤63 chars total, doesn't start/end with a
// hyphen, doesn't begin with a digit. We surface any rule violation
// inline so the user can hop back to Identity and fix it before
// committing to a path.
function validateAgentName(name: string): string | null {
  if (!name) return 'No agent name picked yet.';
  if (name.length > 63) return 'Agent name is over 63 chars (CF max).';
  if (!/^[a-z]/.test(name)) return 'Agent name must start with a letter.';
  if (!/^[a-z0-9-]+$/.test(name)) return 'Only lowercase letters, digits, hyphens.';
  if (name.startsWith('-') || name.endsWith('-')) return 'Can\'t start or end with a hyphen.';
  return null;
}

export function OnboardingFork({ flow, onPickToken, onPickStripe, back }: Props) {
  const nameError = validateAgentName(flow.agentName ?? '');
  // Probe whether the user already has a stashed CF token from a prior
  // session — if so, Path A is the obvious nudge. Cheap GET; we don't
  // surface a hard error if it fails.
  const [hasPriorToken, setHasPriorToken] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // The deploy flow caches a verified token in localStorage so the
    // next session doesn't reprompt. Same key used in OnboardingToken.
    try {
      setHasPriorToken(!!window.localStorage.getItem('openthink:cf-token'));
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <OnboardingFrame
      step={2}
      of={3}
      title="Two paths, both first-class."
      subtitle={`Where would you like ${flow.agentName || 'your agent'} to live?`}
      onBack={back}
    >
      {nameError && (
        <div className="onboarding__validation" role="alert">
          <span className="onboarding__validation-glyph" aria-hidden>⚠</span>
          <div>
            <strong>Agent name needs a fix.</strong>
            <p className="ot-micro">
              {nameError}{' '}
              <a href="#/onboarding/identity">← back to identity</a>
            </p>
          </div>
        </div>
      )}
      {!nameError && flow.agentName && (
        <div className="onboarding__preview" role="status">
          <span className="onboarding__preview-glyph" aria-hidden>✓</span>
          <div>
            <strong>{flow.agentName}</strong>
            <p className="ot-micro">
              Path A → <code>{flow.agentName}.workers.dev</code> · Path B
              → custom domain ({flow.agentName}.<em>yours.com</em>).
            </p>
          </div>
        </div>
      )}
      <div className="onboarding__paths">
        <button
          className="onboarding__path"
          onClick={onPickToken}
          disabled={!!nameError}
        >
          <span className="ot-pill">Path A</span>
          <h3>I have a Cloudflare account</h3>
          <p>Paste a token, pick a subdomain, ship. Free path — workers.dev subdomain available immediately.</p>
          <p className="ot-micro">Best for tinkerers and builders.</p>
          {hasPriorToken && (
            <span className="onboarding__path-hint">
              ✦ token from your last session is cached
            </span>
          )}
        </button>
        <button
          className="onboarding__path"
          onClick={onPickStripe}
          disabled={!!nameError}
        >
          <span className="ot-pill">Path B</span>
          <h3>Start fresh</h3>
          <p>
            We create your Cloudflare account, register a domain, deploy. ~$12/yr for the domain plus
            Cloudflare's pay-as-you-go (mostly free for hobby use).
          </p>
          <p className="ot-micro">Best for newcomers and anyone who just wants it to work.</p>
        </button>
      </div>
      <p className="ot-micro" style={{ textAlign: 'center' }}>
        <a href="#/advanced">Advanced setup →</a> · everything visible, one form.
      </p>
    </OnboardingFrame>
  );
}
