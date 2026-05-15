import { useEffect, useState } from 'react';

import type { AppFlowState } from '../App';
import type { ChatMessage, ComposerMode } from '@shared/types';
import { Canvas } from './canvas/Canvas';
import { SEED_ARTIFACTS } from './seed-artifacts';
import { PlanCard, type PlanStep } from './train/PlanCard';
import { SaveAsSkillSheet } from './train/SaveAsSkillSheet';
import './Shell.css';

interface Props {
  flow: AppFlowState;
}

interface ThreadRow {
  id: string;
  title: string;
  updatedAt: number;
}

export function Shell({ flow }: Props) {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState('');
  const [mode, setMode] = useState<ComposerMode>('auto');
  const [plan, setPlan] = useState<PlanStep[] | null>(null);
  const [planAsJsx, setPlanAsJsx] = useState(false);
  const [showSaveSkill, setShowSaveSkill] = useState(false);
  const [showCanvas, setShowCanvas] = useState(true);

  // Iteration 1 keeps this as a static welcome thread so the shell is visible.
  // The WS connection to the Orchestrator DO lands in iteration 3 alongside the composer.
  useEffect(() => {
    const welcomeId = 'welcome';
    setThreads([{ id: welcomeId, title: 'Welcome', updatedAt: Date.now() }]);
    setActiveThread(welcomeId);
    setMessages([
      {
        id: 'm-welcome',
        threadId: welcomeId,
        role: 'assistant',
        content: `Hi. I'm ${flow.agentName || 'your agent'}. I live on your Cloudflare. What should we do?`,
        createdAt: Date.now(),
      },
    ]);
  }, [flow.agentName]);

  const send = () => {
    if (!pending.trim() || !activeThread) return;
    const userContent = pending.trim();
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      threadId: activeThread,
      role: 'user',
      content: userContent,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setPending('');

    if (mode === 'train' || mode === 'plan') {
      // Compose a synthetic plan to surface the Train-mode card. The real
      // orchestrator-emitted plan replaces this when the WS bridge lands.
      setPlan(synthesizePlan(userContent));
      return;
    }

    window.setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          threadId: activeThread,
          role: 'assistant',
          content: `Heard: "${userContent}". I'll route this through the orchestrator once the WS bridge lands. For now, switch the composer to Train to see the plan card.`,
          createdAt: Date.now(),
        },
      ]);
    }, 600);
  };

  const approvePlan = () => {
    setPlan(null);
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        threadId: activeThread ?? 'welcome',
        role: 'assistant',
        content: 'Plan approved — executing top-to-bottom. (Stubbed in iteration 4; real exec follows the WS bridge.)',
        createdAt: Date.now(),
      },
    ]);
    window.setTimeout(() => setShowSaveSkill(true), 800);
  };

  return (
    <div className="shell">
      <aside className="shell__sidebar">
        <a href="#" className="ot-brand shell__brand">
          <span className="ot-brand-dot" /> OpenThink
        </a>
        <button className="shell__new">+ New Task</button>
        <nav className="shell__nav">
          <a className="shell__nav-item shell__nav-item--active" href="#/shell">Chat</a>
          <a className="shell__nav-item" href="#/library">Library</a>
          <a className="shell__nav-item" href="#/learning">Learning</a>
          <a className="shell__nav-item" href="#/skills">Skills</a>
          <a className="shell__nav-item" href="#/settings">Settings</a>
        </nav>
        <div className="shell__threads">
          <span className="shell__section">Recent</span>
          {threads.map((t) => (
            <button
              key={t.id}
              className={
                'shell__thread' + (t.id === activeThread ? ' shell__thread--active' : '')
              }
              onClick={() => setActiveThread(t.id)}
            >
              {t.title}
            </button>
          ))}
        </div>
        <footer className="shell__identity">
          <span className="shell__identity-dot" />
          <span>{flow.agentName || 'agent'}</span>
        </footer>
      </aside>

      <section className="shell__thread-feed">
        <header className="shell__feed-header">
          <span className="shell__feed-title">
            {threads.find((t) => t.id === activeThread)?.title ?? 'Conversation'}
          </span>
          <span className="ot-micro">{flow.email}</span>
        </header>
        <div className="shell__messages" aria-live="polite">
          {messages.map((m) => (
            <article key={m.id} className={`shell__msg shell__msg--${m.role}`}>
              <span className="shell__msg-role">{m.role === 'user' ? 'You' : flow.agentName || 'agent'}</span>
              <div className="shell__msg-body">{m.content}</div>
            </article>
          ))}
          {plan && (
            <PlanCard
              steps={plan}
              showAsJsx={planAsJsx}
              onApproveAll={approvePlan}
              onStepByStep={approvePlan}
              onCancel={() => setPlan(null)}
              onEdit={(id, patch) =>
                setPlan((prev) => prev?.map((s) => (s.id === id ? { ...s, ...patch } : s)) ?? null)
              }
              onDelete={(id) => setPlan((prev) => prev?.filter((s) => s.id !== id) ?? null)}
              onReorder={(orderedIds) =>
                setPlan((prev) => {
                  if (!prev) return null;
                  const byId = new Map(prev.map((s) => [s.id, s]));
                  return orderedIds.map((id) => byId.get(id)!).filter(Boolean);
                })
              }
              onAddStep={() =>
                setPlan((prev) => [
                  ...(prev ?? []),
                  {
                    id: crypto.randomUUID(),
                    title: 'New step',
                    body: 'Describe what this step does.',
                  },
                ])
              }
              onToggleJsx={() => setPlanAsJsx((p) => !p)}
            />
          )}
          {showSaveSkill && (
            <SaveAsSkillSheet
              defaultName="morning-inbox-triage"
              defaultSummary="Every morning, classify and draft replies to client emails."
              diffText={SAMPLE_DIFF}
              onSave={(name) => {
                setShowSaveSkill(false);
                setMessages((prev) => [
                  ...prev,
                  {
                    id: crypto.randomUUID(),
                    threadId: activeThread ?? 'welcome',
                    role: 'assistant',
                    content: `Saved skill "${name}". You can find it under Skills.`,
                    createdAt: Date.now(),
                  },
                ]);
              }}
              onDismiss={() => setShowSaveSkill(false)}
            />
          )}
        </div>
        <form
          className="shell__composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            className="shell__composer-input"
            placeholder={`Message ${flow.agentName || 'your agent'}…`}
            value={pending}
            onChange={(e) => setPending(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="shell__composer-meta">
            <div className="shell__mode" role="tablist">
              {(['auto', 'plan', 'train'] satisfies ComposerMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`shell__mode-opt${mode === m ? ' shell__mode-opt--active' : ''}`}
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                >
                  {m === 'auto' ? 'Auto' : m === 'plan' ? 'Plan first' : 'Train'}
                </button>
              ))}
            </div>
            <button type="submit" className="ot-btn" disabled={!pending.trim()}>Send</button>
          </div>
        </form>
      </section>

      {showCanvas && (
        <aside className="shell__canvas-pane">
          <Canvas artifacts={SEED_ARTIFACTS} agentName={flow.agentName || 'your agent'} />
        </aside>
      )}
    </div>
  );
}

function synthesizePlan(userInput: string): PlanStep[] {
  // First-pass plan generator — surfaces a demo plan when the user toggles
  // Train mode. Real planning lands in iteration 7 when the orchestrator
  // emits Smithers JSX.
  const lowered = userInput.toLowerCase();
  if (lowered.includes('inbox') || lowered.includes('email')) {
    return [
      { id: 's1', title: 'Open Gmail inbox via integration', body: 'Fetch unread messages from last 24h.' },
      { id: 's2', title: 'Classify each by sender', body: 'Group: clients, newsletters, transactional, personal.' },
      { id: 's3', title: 'Draft replies for client emails', body: 'Use my voice from past sent threads.', requiresApproval: true },
      { id: 's4', title: 'Archive transactional', body: 'No reply needed — file & label.' },
      { id: 's5', title: 'Summarize newsletters', body: 'One paragraph each, link to original.' },
      { id: 's6', title: 'Send digest to me', body: 'Use Slack DM channel by default.' },
      { id: 's7', title: 'Schedule for 8am daily', body: 'Add to the recurring goals.' },
    ];
  }
  return [
    { id: 's1', title: 'Decompose the goal', body: `Break "${userInput}" into actionable sub-tasks.` },
    { id: 's2', title: 'Gather context', body: 'Pull relevant memories and skills from the registry.' },
    { id: 's3', title: 'Run the sub-tasks', body: 'Dispatch through the orchestrator with retries.', requiresApproval: true },
    { id: 's4', title: 'Compile the result', body: 'Format as an artifact and surface it on the canvas.' },
  ];
}

const SAMPLE_DIFF = `agent.config.json
+ skills:
+   - name: morning-inbox-triage
+     trigger: "morning routine"
+     steps: 7
+     created: 2026-05-15
+     source: trained-run`;
