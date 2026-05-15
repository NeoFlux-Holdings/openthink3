import { OnboardingFrame } from './OnboardingIdentity';
import type { AppFlowState } from '../App';

interface Props {
  flow: AppFlowState;
  onPickToken: () => void;
  onPickStripe: () => void;
}

export function OnboardingFork({ flow, onPickToken, onPickStripe }: Props) {
  return (
    <OnboardingFrame
      step={2}
      of={3}
      title="Two paths, both first-class."
      subtitle={`Where would you like ${flow.agentName || 'your agent'} to live?`}
    >
      <div className="onboarding__paths">
        <button className="onboarding__path" onClick={onPickToken}>
          <span className="ot-pill">Path A</span>
          <h3>I have a Cloudflare account</h3>
          <p>Paste a token, pick a subdomain, ship. Free path — workers.dev subdomain available immediately.</p>
          <p className="ot-micro">Best for tinkerers and builders.</p>
        </button>
        <button className="onboarding__path" onClick={onPickStripe}>
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
