/* Top-level router. Replaces the old per-step onboarding routes with a
 * single `/onboarding` that owns its own step state machine, matching the
 * new 3-step design. Other routes are unchanged.
 */
import { useEffect, useState } from 'react';

import { Landing } from './screens/Landing';
import { Onboarding } from './screens/Onboarding';
import { DeployProgress } from './screens/DeployProgress';
import { Shell } from './shell/Shell';
import { AppShell } from './shell/AppShell';
import { CommandPalette } from './shell/CommandPalette';
import { Library } from './screens/Library';
import { Skills } from './screens/Skills';
import { Learning } from './screens/Learning';
import { Settings } from './screens/Settings';
import { Workspaces } from './screens/Workspaces';
import { MobilePair } from './screens/MobilePair';
import { ShortcutsHelp } from './shell/ShortcutsHelp';
import { ToastHost } from './shell/Toast';

import './styles/app.css';

type RouteName =
  | 'landing'
  | 'onboarding'
  | 'deploy'
  | 'shell'
  | 'library'
  | 'skills'
  | 'learning'
  | 'settings'
  | 'workspaces'
  | 'mobile/pair';

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
  // Strip leading `#/` AND any `?…` query so deep-links route correctly.
  // Legacy `onboarding/<step>` URLs all collapse to the new `/onboarding`.
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  if (raw.startsWith('onboarding')) return 'onboarding';
  if (raw.startsWith('mobile/pair')) return 'mobile/pair';
  switch (raw) {
    case 'deploy':
    case 'shell':
    case 'library':
    case 'skills':
    case 'learning':
    case 'settings':
    case 'workspaces':
      return raw;
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
            prev.agentName ? prev : { ...prev, agentName: active.agentName },
          );
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isPaletteShortcut = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isPaletteShortcut) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === '/' && !paletteOpen) {
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') {
          e.preventDefault();
          setPaletteOpen(true);
        }
      }
      if (e.key === '?' && !shortcutsOpen) {
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
        const editable = (e.target as HTMLElement | null)?.isContentEditable;
        if (tag !== 'input' && tag !== 'textarea' && !editable) {
          e.preventDefault();
          setShortcutsOpen(true);
        }
      }
      const isNewThread =
        (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'n';
      if (isNewThread) {
        e.preventDefault();
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

  useEffect(() => {
    const onOpen = () => setPaletteOpen(true);
    window.addEventListener('openthink:open-palette', onOpen);
    return () => window.removeEventListener('openthink:open-palette', onOpen);
  }, []);

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
      case 'onboarding':
        return <Onboarding flow={flow} merge={merge} onDeploy={() => goto('deploy')} />;
      case 'mobile/pair':
        return <MobilePair flow={flow} />;
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
        return <Landing onStart={() => goto('onboarding')} />;
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
