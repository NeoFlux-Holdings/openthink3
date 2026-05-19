import { useEffect, useState } from 'react';

import { Landing } from './screens/Landing';
import { OnboardingIdentity } from './screens/OnboardingIdentity';
import { OnboardingFork } from './screens/OnboardingFork';
import { OnboardingToken } from './screens/OnboardingToken';
import { OnboardingStripe } from './screens/OnboardingStripe';
import { OnboardingUpgrades } from './screens/OnboardingUpgrades';
import { DeployProgress } from './screens/DeployProgress';
import { Shell } from './shell/Shell';
import { AppShell } from './shell/AppShell';
import { CommandPalette } from './shell/CommandPalette';
import { Library } from './screens/Library';
import { Skills } from './screens/Skills';
import { Learning } from './screens/Learning';
import { Settings } from './screens/Settings';
import { Workspaces } from './screens/Workspaces';
import { ShortcutsHelp } from './shell/ShortcutsHelp';
import { ToastHost } from './shell/Toast';

import './styles/app.css';

type RouteName =
  | 'landing'
  | 'onboarding/identity'
  | 'onboarding/fork'
  | 'onboarding/token'
  | 'onboarding/stripe'
  | 'onboarding/upgrades'
  | 'deploy'
  | 'shell'
  | 'library'
  | 'skills'
  | 'learning'
  | 'settings'
  | 'workspaces';

export interface AppFlowState {
  email: string;
  agentName: string;
  cloudflareToken?: string;
  subdomain?: string;
  customDomain?: string;
  accessEmails: string[];
  deployId?: string;
  // Optional paid upgrades selected during onboarding. Both opt-in — the
  // free path (workers.dev subdomain, no Workers Paid, no domain) is fully
  // functional and remains the default.
  workersPaid?: boolean;
  domainPriceCents?: number;
  workersPaidCheckoutId?: string;
  domainCheckoutId?: string;
  workersPaidCheckoutUrl?: string;
  domainCheckoutUrl?: string;
}

const INITIAL_FLOW: AppFlowState = {
  email: '',
  agentName: '',
  accessEmails: [],
};

function parseRoute(): RouteName {
  // Strip leading `#/` AND any `?…` query so deep-links (`#/shell?thread=…`)
  // route correctly. Query params get re-read by individual screens from
  // `window.location.hash` when they care.
  const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  switch (hash) {
    case 'onboarding/identity':
    case 'onboarding/fork':
    case 'onboarding/token':
    case 'onboarding/stripe':
    case 'onboarding/upgrades':
    case 'deploy':
    case 'shell':
    case 'library':
    case 'skills':
    case 'learning':
    case 'settings':
    case 'workspaces':
      return hash;
    default:
      return 'landing';
  }
}

export function App() {
  const [route, setRoute] = useState<RouteName>(parseRoute);
  const [flow, setFlow] = useState<AppFlowState>(INITIAL_FLOW);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Bootstrap active workspace on first paint. We only seed `flow.agentName`
  // when the user hasn't completed onboarding yet — preserving the explicit
  // choice when they did go through identity/fork/token.
  useEffect(() => {
    void fetch('/api/workspaces')
      .then((r) => r.json())
      .then((data: {
        workspaces?: Array<{ id: string; name: string; agentName: string }>;
        activeId?: string | null;
      }) => {
        if (!data.workspaces) return;
        const active = data.workspaces.find((w) => w.id === data.activeId) ?? data.workspaces[0];
        if (active) {
          setFlow((prev) =>
            prev.agentName
              ? prev
              : { ...prev, agentName: active.agentName },
          );
        }
      })
      .catch(() => undefined);
  }, []);

  // Global ⌘K / Ctrl+K shortcut. The browser's own Ctrl+K (URL bar focus)
  // gets preempted because we call preventDefault — that's the standard
  // command-palette UX and matches the PRD §9 spec.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isPaletteShortcut = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isPaletteShortcut) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      // Also open palette when the user types '/' from outside an input.
      if (e.key === '/' && !paletteOpen) {
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') {
          e.preventDefault();
          setPaletteOpen(true);
        }
      }
      // `?` opens the shortcuts cheat sheet. Same input-elision rule as
      // above so users typing in the composer can write actual question
      // marks. Shift+/ matches `?` on US keyboards.
      if (e.key === '?' && !shortcutsOpen) {
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
        const editable = (e.target as HTMLElement | null)?.isContentEditable;
        if (tag !== 'input' && tag !== 'textarea' && !editable) {
          e.preventDefault();
          setShortcutsOpen(true);
        }
      }
      // ⌘+Shift+N / Ctrl+Shift+N → new thread. Works from anywhere in
      // the app: if we're on /shell already, dispatch the existing
      // `openthink:new-thread` event so the Shell creates the thread
      // in-place. Otherwise hash-navigate to `#/shell?newThread=1` and
      // let Shell's bootstrap effect handle it on mount. This matches
      // Slack / Notion / Linear conventions.
      const isNewThread =
        (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'n';
      if (isNewThread) {
        e.preventDefault();
        // Close the palette + shortcut help so the user lands clean.
        setPaletteOpen(false);
        setShortcutsOpen(false);
        const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0];
        if (hash === 'shell') {
          window.dispatchEvent(new CustomEvent('openthink:new-thread'));
        } else {
          window.location.hash = '#/shell?newThread=1';
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, shortcutsOpen]);

  // Listen for sidebar-search clicks (the sidebar input dispatches this
  // custom event so we don't have to thread the open() callback down).
  useEffect(() => {
    const onOpen = () => setPaletteOpen(true);
    window.addEventListener('openthink:open-palette', onOpen);
    return () => window.removeEventListener('openthink:open-palette', onOpen);
  }, []);

  // Same pattern for the shortcuts cheat sheet — the Shell composer
  // hint fires this event so the modal opens without prop-drilling.
  useEffect(() => {
    const onOpen = () => setShortcutsOpen(true);
    window.addEventListener('openthink:open-shortcuts', onOpen);
    return () => window.removeEventListener('openthink:open-shortcuts', onOpen);
  }, []);

  const goto = (next: RouteName) => {
    window.location.hash = `/${next}`;
  };

  const merge = (patch: Partial<AppFlowState>) => setFlow((prev) => ({ ...prev, ...patch }));

  const renderRoute = () => {
    switch (route) {
      case 'onboarding/identity':
        return <OnboardingIdentity flow={flow} merge={merge} next={() => goto('onboarding/fork')} />;
      case 'onboarding/fork':
        return (
          <OnboardingFork
            flow={flow}
            onPickToken={() => goto('onboarding/token')}
            onPickStripe={() => goto('onboarding/stripe')}
            back={() => goto('onboarding/identity')}
          />
        );
      case 'onboarding/token':
        return (
          <OnboardingToken
            flow={flow}
            merge={merge}
            next={() => goto('onboarding/upgrades')}
            back={() => goto('onboarding/fork')}
          />
        );
      case 'onboarding/stripe':
        return (
          <OnboardingStripe
            flow={flow}
            merge={merge}
            next={() => goto('onboarding/upgrades')}
            back={() => goto('onboarding/fork')}
          />
        );
      case 'onboarding/upgrades':
        return (
          <OnboardingUpgrades
            flow={flow}
            merge={merge}
            next={() => goto('deploy')}
            back={() => goto(flow.cloudflareToken ? 'onboarding/token' : 'onboarding/stripe')}
          />
        );
      case 'deploy':
        return <DeployProgress flow={flow} merge={merge} next={() => goto('shell')} />;
      case 'shell':
        return <Shell flow={flow} />;
      case 'library':
        return (
          <AppShell flow={flow} active="library">
            <Library agentName={flow.agentName || 'your agent'} onOpen={() => goto('shell')} />
          </AppShell>
        );
      case 'skills':
        return (
          <AppShell flow={flow} active="skills">
            <Skills agentName={flow.agentName || 'your agent'} />
          </AppShell>
        );
      case 'learning':
        return (
          <AppShell flow={flow} active="learning">
            <Learning agentName={flow.agentName || 'your agent'} />
          </AppShell>
        );
      case 'settings':
        return (
          <AppShell flow={flow} active="settings">
            <Settings agentName={flow.agentName || 'your agent'} email={flow.email || 'you@example.com'} />
          </AppShell>
        );
      case 'workspaces':
        return (
          <AppShell flow={flow} active="settings">
            <Workspaces
              onActivate={(ws) => {
                merge({ agentName: ws.agentName });
                goto('shell');
              }}
            />
          </AppShell>
        );
      case 'landing':
      default:
        return <Landing onStart={() => goto('onboarding/identity')} />;
    }
  };

  return (
    <>
      {renderRoute()}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        agentName={flow.agentName}
      />
      <ShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ToastHost />
    </>
  );
}
