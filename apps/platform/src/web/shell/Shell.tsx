import { useEffect, useMemo, useState } from 'react';

import type { AppFlowState } from '../App';
import type { ChatMessage, ComposerMode } from '@shared/types';
import { Canvas } from './canvas/Canvas';
import { SEED_ARTIFACTS } from './seed-artifacts';
import { PlanCard, type PlanStep } from './train/PlanCard';
import { SaveAsSkillSheet } from './train/SaveAsSkillSheet';
import { useAgentSocket } from './use-agent-socket';
import './Shell.css';

interface Props {
  flow: AppFlowState;
}

interface ThreadRow {
  id: string;
  title: string;
  updatedAt: number;
}

type MobilePane = 'sidebar' | 'chat' | 'canvas';

export function Shell({ flow }: Props) {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState('');
  const [mode, setMode] = useState<ComposerMode>('auto');
  const [plan, setPlan] = useState<PlanStep[] | null>(null);
  const [planAsJsx, setPlanAsJsx] = useState(false);
  const [showSaveSkill, setShowSaveSkill] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>('chat');
  const socket = useAgentSocket(flow.agentName || 'guest');

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

  useEffect(() => {
    if (socket.state !== 'open' || !activeThread) return;
    socket.send({ type: 'subscribe-thread', threadId: activeThread });
  }, [socket.state, activeThread, socket]);

  useEffect(() => {
    if (socket.history.length === 0) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const merged = [...prev];
      for (const m of socket.history) if (!seen.has(m.id)) merged.push(m);
      return merged;
    });
  }, [socket.history]);

  const send = () => {
    if (!pending.trim() || !activeThread) return;
    const userContent = pending.trim();
    setPending('');

    if (socket.state === 'open') {
      // Live path — the orchestrator echoes the user message back as part of
      // its broadcast, so don't optimistic-insert here (causes a duplicate).
      socket.send({ type: 'send', threadId: activeThread, content: userContent, mode });
      if (mode === 'train' || mode === 'plan') {
        setPlan(synthesizePlan(userContent));
      }
      return;
    }

    // Fallback path — worker isn't running, so we echo locally.
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      threadId: activeThread,
      role: 'user',
      content: userContent,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    if (mode === 'train' || mode === 'plan') {
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
          content: `Heard: "${userContent}". The Worker isn't running so I'm echoing locally — run \`pnpm dev:worker\` to route through the Orchestrator DO.`,
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

  const isEmpty = messages.length <= 1;
  const quickPrompts = useMemo(
    () => [
      { glyph: '✦', label: 'Plan my week' },
      { glyph: '✦', label: 'Research a topic' },
      { glyph: '✦', label: 'Build a webpage' },
      { glyph: '✦', label: 'Sort my inbox' },
      { glyph: '✦', label: 'Draft a doc' },
      { glyph: '✦', label: 'Train me on…' },
    ],
    [],
  );

  return (
    <div className={`shell shell--pane-${mobilePane}`}>
      <aside className="shell__sidebar">
        <a href="#" className="ot-brand shell__brand">
          <span className="ot-brand-dot" /> OpenThink
        </a>
        <button className="shell__new">
          <span className="shell__new-plus" aria-hidden>+</span>
          New task
        </button>
        <div className="shell__search">
          <span className="shell__search-glyph" aria-hidden>⌘K</span>
          <input className="shell__search-input" placeholder="Search…" />
        </div>
        <nav className="shell__nav">
          <a className="shell__nav-item shell__nav-item--active" href="#/shell">
            <span className="shell__nav-glyph" aria-hidden>◦</span> Chat
          </a>
          <a className="shell__nav-item" href="#/library">
            <span className="shell__nav-glyph" aria-hidden>◇</span> Library
          </a>
          <a className="shell__nav-item" href="#/learning">
            <span className="shell__nav-glyph" aria-hidden>✦</span> Learning
          </a>
          <a className="shell__nav-item" href="#/skills">
            <span className="shell__nav-glyph" aria-hidden>⊕</span> Skills
          </a>
          <a className="shell__nav-item" href="#/settings">
            <span className="shell__nav-glyph" aria-hidden>⚙</span> Settings
          </a>
        </nav>
        <div className="shell__threads">
          <span className="shell__section">Recent threads</span>
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
          <div className="shell__identity-row">
            <span className="shell__identity-avatar" aria-hidden>
              {(flow.agentName || 'a').slice(0, 1).toUpperCase()}
            </span>
            <div className="shell__identity-meta">
              <span className="shell__identity-name">{flow.agentName || 'agent'}</span>
              <span className="shell__identity-host">
                <span className="shell__identity-pulse" /> live · {flow.subdomain ?? flow.agentName ?? 'workers'}.dev
              </span>
            </div>
          </div>
          <div className="shell__budget">
            <div className="shell__budget-bar">
              <div className="shell__budget-fill" style={{ width: '34%' }} />
            </div>
            <span className="shell__budget-label">$1.71 / $5.00 today</span>
          </div>
        </footer>
      </aside>

      <section className="shell__thread-feed">
        <header className="shell__feed-header">
          <span className="shell__feed-title">
            {threads.find((t) => t.id === activeThread)?.title ?? 'Conversation'}
          </span>
          <span className={`shell__socket shell__socket--${socket.state}`} title={`WS: ${socket.state}`}>
            <span className="shell__socket-dot" />
            {socket.state === 'open' ? 'live' : socket.state === 'unavailable' ? 'local echo' : socket.state}
          </span>
        </header>
        <div className="shell__messages" aria-live="polite">
          {isEmpty && (
            <div className="shell__opener">
              <span className="shell__opener-mark" aria-hidden>✦</span>
              <h2 className="shell__opener-title">
                Hi. I'm <em>{flow.agentName || 'your agent'}</em>.
              </h2>
              <p className="shell__opener-lede">
                I live on your Cloudflare. What should we do?
              </p>
            </div>
          )}
          {!isEmpty &&
            messages.map((m) => (
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
          {isEmpty && (
            <div className="shell__quick-row">
              {quickPrompts.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  className="shell__quick"
                  onClick={() => setPending(q.label)}
                >
                  <span className="shell__quick-glyph" aria-hidden>{q.glyph}</span>
                  {q.label}
                </button>
              ))}
            </div>
          )}
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
            <button type="submit" className="ot-btn shell__send" disabled={!pending.trim()}>
              Send
              <span className="shell__send-arrow" aria-hidden>→</span>
            </button>
          </div>
        </form>
      </section>

      <aside className="shell__canvas-pane">
        <Canvas artifacts={SEED_ARTIFACTS} agentName={flow.agentName || 'your agent'} />
      </aside>

      <nav className="shell__tab-bar" aria-label="Mobile sections">
        {(['sidebar', 'chat', 'canvas'] satisfies MobilePane[]).map((p) => (
          <button
            key={p}
            type="button"
            className={`shell__tab${mobilePane === p ? ' shell__tab--active' : ''}`}
            onClick={() => setMobilePane(p)}
            aria-pressed={mobilePane === p}
          >
            <span className="shell__tab-glyph" aria-hidden>
              {p === 'sidebar' ? '☰' : p === 'chat' ? '✦' : '◇'}
            </span>
            <span className="shell__tab-label">
              {p === 'sidebar' ? 'Menu' : p === 'chat' ? 'Chat' : 'Canvas'}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function synthesizePlan(userInput: string): PlanStep[] {
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
