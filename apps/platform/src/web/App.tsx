import { useEffect, useState } from 'react';

import { Landing } from './screens/Landing';
import { OnboardingIdentity } from './screens/OnboardingIdentity';
import { OnboardingFork } from './screens/OnboardingFork';
import { OnboardingToken } from './screens/OnboardingToken';
import { OnboardingStripe } from './screens/OnboardingStripe';
import { DeployProgress } from './screens/DeployProgress';
import { Shell } from './shell/Shell';

import './styles/app.css';

type RouteName =
  | 'landing'
  | 'onboarding/identity'
  | 'onboarding/fork'
  | 'onboarding/token'
  | 'onboarding/stripe'
  | 'deploy'
  | 'shell';

export interface AppFlowState {
  email: string;
  agentName: string;
  cloudflareToken?: string;
  subdomain?: string;
  customDomain?: string;
  accessEmails: string[];
  deployId?: string;
}

const INITIAL_FLOW: AppFlowState = {
  email: '',
  agentName: '',
  accessEmails: [],
};

function parseRoute(): RouteName {
  const hash = window.location.hash.replace(/^#\/?/, '');
  switch (hash) {
    case 'onboarding/identity':
    case 'onboarding/fork':
    case 'onboarding/token':
    case 'onboarding/stripe':
    case 'deploy':
    case 'shell':
      return hash;
    default:
      return 'landing';
  }
}

export function App() {
  const [route, setRoute] = useState<RouteName>(parseRoute);
  const [flow, setFlow] = useState<AppFlowState>(INITIAL_FLOW);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const goto = (next: RouteName) => {
    window.location.hash = `/${next}`;
  };

  const merge = (patch: Partial<AppFlowState>) => setFlow((prev) => ({ ...prev, ...patch }));

  switch (route) {
    case 'onboarding/identity':
      return <OnboardingIdentity flow={flow} merge={merge} next={() => goto('onboarding/fork')} />;
    case 'onboarding/fork':
      return (
        <OnboardingFork
          flow={flow}
          onPickToken={() => goto('onboarding/token')}
          onPickStripe={() => goto('onboarding/stripe')}
        />
      );
    case 'onboarding/token':
      return <OnboardingToken flow={flow} merge={merge} next={() => goto('deploy')} />;
    case 'onboarding/stripe':
      return <OnboardingStripe flow={flow} merge={merge} next={() => goto('deploy')} />;
    case 'deploy':
      return <DeployProgress flow={flow} merge={merge} next={() => goto('shell')} />;
    case 'shell':
      return <Shell flow={flow} />;
    case 'landing':
    default:
      return <Landing onStart={() => goto('onboarding/identity')} />;
  }
}
