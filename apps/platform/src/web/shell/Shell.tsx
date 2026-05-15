import { useEffect, useState } from 'react';

import type { AppFlowState } from '../App';
import type { ChatMessage } from '@shared/types';
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
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      threadId: activeThread,
      role: 'user',
      content: pending.trim(),
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setPending('');
    // Echo stub — replaced with WS stream in iteration 3.
    window.setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          threadId: activeThread,
          role: 'assistant',
          content: `(stub) Heard: "${userMsg.content}". I'll route through the orchestrator once the WS bridge lands in iteration 3.`,
          createdAt: Date.now(),
        },
      ]);
    }, 600);
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
              <button type="button" className="shell__mode-opt shell__mode-opt--active">Auto</button>
              <button type="button" className="shell__mode-opt">Plan first</button>
              <button type="button" className="shell__mode-opt">Train</button>
            </div>
            <button type="submit" className="ot-btn" disabled={!pending.trim()}>Send</button>
          </div>
        </form>
      </section>

      <aside className="shell__canvas">
        <header className="shell__canvas-header">
          <span className="shell__canvas-title">Artifacts</span>
          <span className="ot-micro">nothing yet</span>
        </header>
        <div className="shell__canvas-empty">
          <p className="ot-lede" style={{ fontSize: 16 }}>
            Artifacts the agent creates land here. Documents, browser sessions, slides, code — each
            with its own version history and editable view.
          </p>
        </div>
      </aside>
    </div>
  );
}
