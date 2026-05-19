import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { AppFlowState } from '../App';
import type { ChatMessage, ComposerMode } from '@shared/types';
import { AppSidebar } from './AppSidebar';
import { Canvas } from './canvas/Canvas';
import { GoalCard } from './GoalCard';
import { SEED_ARTIFACTS } from './seed-artifacts';
import { PlanCard, type PlanStep } from './train/PlanCard';
import { SaveAsSkillSheet } from './train/SaveAsSkillSheet';
import { useAgentSocket } from './use-agent-socket';
import { showToast } from './Toast';
import './Shell.css';

interface Props {
  flow: AppFlowState;
}

interface ThreadRow {
  id: string;
  title: string;
  updatedAt: number;
  pinned?: boolean;
}

// Working-doc starter templates. Surfaced as chips below the editor when
// the doc is empty so the user can drop into a common shape instead of
// staring at a blank textarea. Bodies are kept short — the doc is hard-
// capped at 8KB on the server and these are starting points, not
// canonical structure.
const WORKING_DOC_TEMPLATES: Array<{
  id: string;
  label: string;
  hint: string;
  body: string;
}> = [
  {
    id: 'meeting',
    label: 'Meeting',
    hint: 'Attendees, agenda, decisions',
    body: '## Meeting\n- Attendees: \n- Agenda: \n- Decisions: \n- Follow-ups: ',
  },
  {
    id: 'research',
    label: 'Research',
    hint: 'Question, sources, working hypothesis',
    body: '## Research kickoff\n- Question: \n- Sources to check: \n- Hypothesis: \n- Open threads: ',
  },
  {
    id: 'project',
    label: 'Project',
    hint: 'Goal, milestones, risks',
    body: '## Project plan\n- Goal: \n- Milestones:\n  - \n- Risks: \n- Owner: ',
  },
  {
    id: 'standup',
    label: 'Standup',
    hint: 'Yesterday, today, blockers',
    body: '## Standup\n- Yesterday: \n- Today: \n- Blockers: ',
  },
];

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
  const [goalRuns, setGoalRuns] = useState<Array<{ runId: string; goal: string; threadId: string }>>([]);
  const [workingDoc, setWorkingDoc] = useState<string>('');
  const [workingDocEditing, setWorkingDocEditing] = useState(false);
  // Per-thread collapse preference. Kept in `Map<threadId, boolean>` so each
  // thread's last toggle persists when you tab between threads in a single
  // session. Default is expanded (false = not collapsed).
  const [workingDocCollapsed, setWorkingDocCollapsed] = useState<Record<string, boolean>>({});
  // Pasted/dropped attachments waiting to be sent with the next message.
  // Held client-side as data URLs so the user can preview them; on send we
  // append a textual reference (`[image attached: name (size)]`) to the
  // prompt so the agent at least knows an image was offered. Full
  // multimodal-content piping is a separate lift.
  const [attachments, setAttachments] = useState<Array<{
    id: string;
    name: string;
    type: string;
    size: number;
    dataUrl: string;
  }>>([]);
  // In-thread search — open via the search button or Ctrl/⌘+F. Stores the
  // active query and a 0-based cursor that walks the match list with the
  // ↑/↓ keys or the prev/next buttons. Matches are computed inline from
  // `messages` so they always stay current as the WS streams new turns.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchCursor, setSearchCursor] = useState(0);
  // Composer autocomplete state. `kind` is null when nothing's active.
  // The trigger detection runs from the textarea's onChange handler so we
  // always have a fresh selection position.
  const [suggest, setSuggest] = useState<{
    kind: 'slash' | 'mention';
    query: string;
    tokenStart: number;
    cursor: number;
  } | null>(null);
  const [skillsForMention, setSkillsForMention] = useState<Array<{ id: string; name: string; description: string }>>([]);
  // Canvas-pane width override. null means "use the default 1.4fr ratio
  // from CSS". When the user drags the resizer, this becomes a pixel
  // value clamped to [320, windowWidth - 220 - 360 (min feed)]. Persists
  // to localStorage so the choice survives reloads. A double-click on
  // the resizer resets to null.
  const [canvasPx, setCanvasPx] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem('openthink:canvasPx');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 200 ? n : null;
  });
  const [expandedToolCallId, setExpandedToolCallId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [codeMode, setCodeMode] = useState<'always' | 'smart' | 'off'>('smart');
  const socket = useAgentSocket(flow.agentName || 'guest');

  // Create a new thread on demand — both via the sidebar's "+ New task"
  // button and via the `#/shell?newThread=1` hash form (used when the user
  // clicks New task from a subpage). The Orchestrator's `INSERT OR IGNORE`
  // path means we just synthesize a UUID locally; the first WS `send` with
  // this threadId will materialize the row in DO SQLite.
  useEffect(() => {
    const newThread = () => {
      const id = crypto.randomUUID();
      const row = { id, title: 'New thread', updatedAt: Date.now() };
      setThreads((prev) => [row, ...prev.filter((t) => t.id !== id)]);
      setActiveThread(id);
      setMessages([
        {
          id: 'm-new-' + id,
          threadId: id,
          role: 'assistant',
          content: `New thread. Ask anything — ${flow.agentName || 'your agent'} is listening.`,
          createdAt: Date.now(),
        },
      ]);
    };
    window.addEventListener('openthink:new-thread', newThread);
    // ?newThread=1 in the hash triggers the same path once on mount.
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    if (params.get('newThread') === '1') {
      newThread();
      // Strip the param so subsequent re-renders don't loop.
      const cleanHash = window.location.hash.split('?')[0];
      window.history.replaceState(null, '', window.location.pathname + cleanHash);
    }
    return () => window.removeEventListener('openthink:new-thread', newThread);
  }, [flow.agentName]);

  // Hydrate from #/shell?thread=<id> when the user lands via a command
  // palette deep-link. Pulls the thread's tail of messages from the DO so
  // the chat opens already populated, then subscribes via the WS bridge for
  // anything new.
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    const deepLinkThread = params.get('thread');
    if (!deepLinkThread) return;
    void fetch(
      `/api/threads/${encodeURIComponent(flow.agentName || 'guest')}/${encodeURIComponent(deepLinkThread)}`,
    )
      .then((r) => r.json())
      .then((data: { ok: boolean; thread?: { id: string; title: string; updatedAt: number }; messages?: ChatMessage[] }) => {
        if (!data.ok || !data.thread) return;
        setThreads((prev) => {
          const exists = prev.some((t) => t.id === data.thread!.id);
          return exists ? prev : [...prev, data.thread!];
        });
        setActiveThread(data.thread.id);
        if (Array.isArray(data.messages)) setMessages(data.messages);
      })
      .catch(() => undefined);
  }, [flow.agentName]);

  useEffect(() => {
    let cancelled = false;
    // Hydrate the sidebar from the real Orchestrator DO. If there's no
    // history yet we fall back to the Welcome stub so the empty state still
    // reads naturally.
    void fetch(`/api/threads/${encodeURIComponent(flow.agentName || 'guest')}?limit=25`)
      .then((r) => r.json())
      .then((data: { threads?: Array<{ id: string; title: string; updatedAt: number }> }) => {
        if (cancelled) return;
        const rows = data.threads ?? [];
        if (rows.length > 0) {
          setThreads(rows);
          // Only set the active thread if the deep-link effect hasn't
          // already chosen one. We can detect that by checking activeThread
          // at the moment of run; the param-deep-link effect runs first
          // because it doesn't depend on the fetch.
          setActiveThread((cur) => cur ?? rows[0]!.id);
          return;
        }
        const welcomeId = 'welcome';
        setThreads([{ id: welcomeId, title: 'Welcome', updatedAt: Date.now() }]);
        setActiveThread((cur) => cur ?? welcomeId);
        setMessages([
          {
            id: 'm-welcome',
            threadId: welcomeId,
            role: 'assistant',
            content: `Hi. I'm ${flow.agentName || 'your agent'}. I live on your Cloudflare. What should we do?`,
            createdAt: Date.now(),
          },
        ]);
      })
      .catch(() => {
        if (cancelled) return;
        // Worker unreachable — keep the Welcome stub.
        const welcomeId = 'welcome';
        setThreads([{ id: welcomeId, title: 'Welcome', updatedAt: Date.now() }]);
        setActiveThread((cur) => cur ?? welcomeId);
        setMessages([
          {
            id: 'm-welcome',
            threadId: welcomeId,
            role: 'assistant',
            content: `Hi. I'm ${flow.agentName || 'your agent'}. I live on your Cloudflare. What should we do?`,
            createdAt: Date.now(),
          },
        ]);
      });
    return () => {
      cancelled = true;
    };
  }, [flow.agentName]);

  useEffect(() => {
    if (socket.state !== 'open' || !activeThread) return;
    socket.send({ type: 'subscribe-thread', threadId: activeThread });
    return () => {
      // The next subscribe-thread implicitly replaces this; an explicit
      // unsubscribe handles the edge where the user navigates away
      // entirely. The orchestrator no-ops on stale unsubscribes.
      socket.send({ type: 'unsubscribe-thread' });
    };
  }, [socket.state, activeThread, socket]);

  // Fold cross-tab thread mutations into the local sidebar list. The
  // orchestrator broadcasts `thread-renamed` / `thread-archived` on every
  // mutation; the socket hook also synthesizes a `bumped` event from each
  // incoming `message` frame so a new turn anywhere in the agent hops
  // that thread back to the top of the sidebar. Each event carries a `ts`
  // so identical mutations still invalidate this effect.
  const lastThreadEventTs = socket.threadEvent?.ts ?? 0;
  useEffect(() => {
    const evt = socket.threadEvent;
    if (!evt) return;
    if (evt.kind === 'renamed' && evt.title) {
      setThreads((prev) =>
        prev.map((t) =>
          t.id === evt.id ? { ...t, title: evt.title as string, updatedAt: evt.ts } : t,
        ),
      );
    } else if (evt.kind === 'archived') {
      if (evt.archived) {
        setThreads((prev) => prev.filter((t) => t.id !== evt.id));
        if (activeThread === evt.id) {
          setActiveThread((cur) => {
            if (cur !== evt.id) return cur;
            const next = threads.find((t) => t.id !== evt.id);
            return next ? next.id : null;
          });
        }
      } else {
        // Restore — we don't have full metadata in the WS frame, so re-pull
        // the canonical list from the DO. Cheap (in-process SQLite + JSON).
        void fetch(`/api/threads/${encodeURIComponent(flow.agentName || 'guest')}`)
          .then((r) => r.json())
          .then((data: { threads?: ThreadRow[] }) => {
            if (data.threads) setThreads(data.threads);
          })
          .catch(() => undefined);
      }
    } else if (evt.kind === 'bumped') {
      setThreads((prev) => {
        const idx = prev.findIndex((t) => t.id === evt.id);
        if (idx < 0) {
          // We saw a message for a thread we don't have yet — likely a
          // brand-new thread created on another tab. Pull the canonical
          // list so the new row surfaces in this tab's sidebar.
          void fetch(`/api/threads/${encodeURIComponent(flow.agentName || 'guest')}`)
            .then((r) => r.json())
            .then((data: { threads?: ThreadRow[] }) => {
              if (data.threads) setThreads(data.threads);
            })
            .catch(() => undefined);
          return prev;
        }
        const next = prev.slice();
        const bumped = { ...next[idx]!, updatedAt: evt.ts };
        next.splice(idx, 1);
        next.unshift(bumped);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastThreadEventTs]);

  // Working Doc lifecycle. On every thread switch, pull the persisted doc
  // from the orchestrator's SQLite. Save lazily on blur in the textarea
  // (see the editor below). Welcome thread gets a transient doc only.
  useEffect(() => {
    if (!activeThread || activeThread === 'welcome' || activeThread.startsWith('m-new-')) {
      setWorkingDoc('');
      return;
    }
    let cancelled = false;
    void fetch(
      `/api/threads/${encodeURIComponent(flow.agentName || 'guest')}/${encodeURIComponent(activeThread)}/working-doc`,
    )
      .then((r) => r.json())
      .then((data: { ok: boolean; body?: string }) => {
        if (cancelled) return;
        setWorkingDoc(data.ok && typeof data.body === 'string' ? data.body : '');
      })
      .catch(() => {
        if (!cancelled) setWorkingDoc('');
      });
    return () => {
      cancelled = true;
    };
  }, [activeThread, flow.agentName]);

  // Autosave status — drives the "saving…" / "saved Xs ago" pill in
  // the working-doc header. `savedAt` is the last successful POST
  // timestamp; `saving` is true while a POST is in flight. `dirty`
  // means there are local edits that haven't yet been POSTed (we
  // gate the save behind a 350ms debounce inside the editor).
  const [workingDocSaving, setWorkingDocSaving] = useState(false);
  const [workingDocSavedAt, setWorkingDocSavedAt] = useState<number | null>(null);
  const [workingDocError, setWorkingDocError] = useState(false);
  // Tick the savedAt-relative label every 15s so it doesn't stall at
  // "just now" once the network has settled.
  const [, setWorkingDocTick] = useState(0);
  useEffect(() => {
    if (!workingDocSavedAt) return;
    const id = window.setInterval(() => setWorkingDocTick((t) => t + 1), 15_000);
    return () => window.clearInterval(id);
  }, [workingDocSavedAt]);

  const persistWorkingDoc = (next: string) => {
    if (!activeThread || activeThread === 'welcome') return;
    setWorkingDocSaving(true);
    setWorkingDocError(false);
    void fetch(
      `/api/threads/${encodeURIComponent(flow.agentName || 'guest')}/${encodeURIComponent(activeThread)}/working-doc`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: next }),
      },
    )
      .then((r) => {
        if (r.ok) setWorkingDocSavedAt(Date.now());
        else setWorkingDocError(true);
      })
      .catch(() => setWorkingDocError(true))
      .finally(() => setWorkingDocSaving(false));
  };

  // On socket open, pull the persisted approval mode from KV and tell the
  // orchestrator. The DO persists it for future sessions, so this is just a
  // sync nudge — Settings → Automation writes to the same KV key.
  useEffect(() => {
    if (socket.state !== 'open') return;
    void fetch(`/api/settings/${encodeURIComponent(flow.agentName || 'default')}`)
      .then((r) => r.json())
      .then((data: { approvalMode?: string; codeMode?: string } | null) => {
        if (data && typeof data.approvalMode === 'string') {
          socket.send({ type: 'set-approval-mode', mode: data.approvalMode });
        }
        if (data && typeof data.codeMode === 'string') {
          socket.send({ type: 'set-code-mode', value: data.codeMode });
          if (data.codeMode === 'always' || data.codeMode === 'smart' || data.codeMode === 'off') {
            setCodeMode(data.codeMode);
          }
        }
      })
      .catch(() => undefined);
  }, [socket.state, socket, flow.agentName]);

  // Skills list for the `@skill:` mention picker. Pulled lazily on first
  // mention trigger and cached for the rest of the session.
  useEffect(() => {
    if (!suggest || suggest.kind !== 'mention' || skillsForMention.length > 0) return;
    void fetch('/api/skills')
      .then((r) => r.json())
      .then((data: { skills?: Array<{ id: string; name: string; description: string }> }) => {
        if (data.skills) setSkillsForMention(data.skills);
      })
      .catch(() => undefined);
  }, [suggest, skillsForMention.length]);

  // Ctrl/⌘+F intercept — opens our in-thread search bar. We deliberately
  // preempt the browser's native find because in-thread search lets us scope
  // to *this* conversation (not the whole DOM) and gives us match-count +
  // navigation that native can't. Esc closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const editable =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === 'Escape' && searchOpen && !editable) {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen]);

  // Suggestion list for the composer autocomplete — derived from the
  // current `suggest` trigger. Slash commands are static; mentions pull
  // from threads + skills (when loaded).
  const composerSuggestions = useMemo<Array<{ insert: string; label: string; hint: string }>>(() => {
    if (!suggest) return [];
    if (suggest.kind === 'slash') {
      const q = suggest.query.toLowerCase();
      const all = [
        { insert: '/goal ', label: '/goal', hint: 'Kick off a long-running goal' },
        { insert: '/help', label: '/help', hint: 'Show keyboard shortcuts' },
      ];
      return q ? all.filter((c) => c.label.slice(1).startsWith(q)) : all;
    }
    // Mention: blend threads + skills, max 8 total. Threads first since
    // they're more session-specific.
    const q = suggest.query.toLowerCase();
    const out: Array<{ insert: string; label: string; hint: string }> = [];
    for (const t of threads) {
      if (out.length >= 4) break;
      if (q && !t.title.toLowerCase().includes(q)) continue;
      out.push({
        insert: `@thread:${t.title.replace(/\s+/g, '_')} `,
        label: t.title,
        hint: 'thread',
      });
    }
    for (const s of skillsForMention) {
      if (out.length >= 8) break;
      if (q && !s.name.toLowerCase().includes(q)) continue;
      out.push({
        insert: `@skill:${s.name} `,
        label: s.name,
        hint: s.description.slice(0, 60),
      });
    }
    return out;
  }, [suggest, threads, skillsForMention]);

  // Clamp the autocomplete cursor when the list shrinks.
  useEffect(() => {
    if (!suggest) return;
    if (suggest.cursor >= composerSuggestions.length && composerSuggestions.length > 0) {
      setSuggest((cur) => (cur ? { ...cur, cursor: 0 } : cur));
    }
  }, [composerSuggestions.length, suggest]);

  // Local typings for the Web Speech API since lib.dom doesn't always
  // ship them (Firefox lacks the implementation; some TS lib targets
  // omit the interfaces). We only touch the surface area we actually
  // use — onresult/onend/onerror/start/stop + a results-iterator.
  interface SpeechRecognitionEventLike {
    results: ArrayLike<{ 0?: { transcript?: string } }>;
  }
  interface SpeechRecognitionInstance {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
    onend: (() => void) | null;
    onerror: (() => void) | null;
    start: () => void;
    stop: () => void;
  }

  // Voice dictation — best-effort Web Speech API integration. Native
  // support is patchy (Chrome/Edge yes, Firefox no, Safari iOS yes,
  // Safari macOS partial), so we feature-detect and grey the button
  // out when unavailable. The recognizer streams interim results into
  // `pending` so the user sees their words land as they speak;
  // pressing Send commits whatever's in the field as a chat message.
  const SpeechRecognitionCtor = useMemo<
    (new () => SpeechRecognitionInstance) | null
  >(() => {
    if (typeof window === 'undefined') return null;
    const w = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  }, []);
  const voiceSupported = !!SpeechRecognitionCtor;
  const [voiceListening, setVoiceListening] = useState(false);
  const voiceRecogRef = useRef<SpeechRecognitionInstance | null>(null);
  // Snapshot of `pending` at the moment recognition started — interim
  // results get appended on top of this so partial transcripts don't
  // clobber earlier typed content.
  const voiceBaseRef = useRef<string>('');
  const toggleVoice = () => {
    if (!voiceSupported || !SpeechRecognitionCtor) return;
    if (voiceListening) {
      voiceRecogRef.current?.stop();
      return;
    }
    try {
      const r = new SpeechRecognitionCtor();
      r.continuous = false;
      r.interimResults = true;
      r.lang = navigator.language || 'en-US';
      voiceBaseRef.current = pending;
      r.onresult = (ev: SpeechRecognitionEventLike) => {
        let transcript = '';
        for (let i = 0; i < ev.results.length; i++) {
          transcript += ev.results[i]?.[0]?.transcript ?? '';
        }
        const base = voiceBaseRef.current;
        const joiner = base && !base.endsWith(' ') ? ' ' : '';
        setPending(base + joiner + transcript);
      };
      r.onend = () => {
        setVoiceListening(false);
        voiceRecogRef.current = null;
      };
      r.onerror = () => {
        setVoiceListening(false);
        voiceRecogRef.current = null;
      };
      r.start();
      voiceRecogRef.current = r;
      setVoiceListening(true);
    } catch {
      // Some browsers throw if the user hasn't granted mic permission
      // yet — we let the failure quietly drop the listening state.
      setVoiceListening(false);
    }
  };
  useEffect(() => {
    return () => {
      voiceRecogRef.current?.stop();
    };
  }, []);

  // Auto-grow textarea: keep the composer one line tall when empty,
  // expand as the user types, cap at a max so the chat feed isn't
  // squeezed off-screen. Reset to `auto` first so scrollHeight reflects
  // the *content* height, not the prior render's clamped height.
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const ta = composerRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const max = 240; // about 12 lines at 1.5x line-height
    ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
    ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
  }, [pending]);

  // Slash-command preview chip — surfaces above the textarea when the
  // user has fully typed a recognized command (`/goal `, `/help`) and
  // is now writing the body. The autocomplete dropdown handles the
  // *while-typing* phase; this chip handles the *after-typing* phase so
  // the user keeps visual confirmation of what's about to be sent.
  // Returns null when the input doesn't start with a known command.
  const slashPreview = useMemo<{ name: string; hint: string } | null>(() => {
    const trimmed = pending.trimStart();
    if (!trimmed.startsWith('/')) return null;
    const m = trimmed.match(/^\/([a-zA-Z][a-zA-Z0-9-]*)/);
    if (!m) return null;
    const name = (m[1] ?? '').toLowerCase();
    const known: Record<string, string> = {
      goal: 'Kick off a long-running goal — runs in the background',
      help: 'Show keyboard shortcuts',
    };
    const hint = known[name];
    if (!hint) return null;
    return { name: `/${name}`, hint };
  }, [pending]);

  // Match list — derived from `messages` against the trimmed query. Empty
  // query yields zero matches (and we hide the count UI). The match
  // objects carry the message id + the start/end char range so the renderer
  // can highlight just the matched substring rather than the whole message.
  const searchMatches = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return [] as Array<{ messageId: string; index: number; length: number }>;
    const out: Array<{ messageId: string; index: number; length: number }> = [];
    for (const m of messages) {
      const body = m.content.toLowerCase();
      let from = 0;
      while (true) {
        const at = body.indexOf(q, from);
        if (at < 0) break;
        out.push({ messageId: m.id, index: at, length: q.length });
        from = at + q.length;
      }
    }
    return out;
  }, [searchQ, messages]);

  // Clamp cursor whenever the match list shrinks (e.g. query lengthens).
  useEffect(() => {
    if (searchCursor >= searchMatches.length && searchMatches.length > 0) {
      setSearchCursor(0);
    }
  }, [searchMatches.length, searchCursor]);

  // Scroll the active match into view. Use a stable id (message id + match
  // index inside the message) so multiple matches in the same message each
  // get their own anchor.
  useEffect(() => {
    if (!searchOpen || searchMatches.length === 0) return;
    const m = searchMatches[searchCursor];
    if (!m) return;
    const id = `shell-msg-${m.messageId}`;
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [searchCursor, searchOpen, searchMatches]);

  // Merge new WS messages into the active thread's feed only. The broadcast
  // is cross-thread (the `message` frame has no top-level `threadId`, so
  // the orchestrator's scope filter doesn't restrict it) which is fine for
  // sidebar bumps but would otherwise leak thread B's messages into tab A
  // viewing thread A.
  useEffect(() => {
    if (socket.history.length === 0 || !activeThread) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const merged = [...prev];
      for (const m of socket.history) {
        if (seen.has(m.id)) continue;
        if (m.threadId !== activeThread) continue;
        merged.push(m);
      }
      return merged;
    });
  }, [socket.history, activeThread]);

  // Export the active thread's transcript as a markdown file. Pulls the
  // full tail from the orchestrator (capped at 200 turns) so the export
  // includes everything that's been scrolled off in the feed too, then
  // formats each message as `## <role> · <relative time>` with the body
  // below. The user gets a Blob download named after the thread slug.
  const exportThread = () => {
    if (!activeThread) return;
    const agent = flow.agentName || 'guest';
    const title =
      threads.find((t) => t.id === activeThread)?.title ?? 'Conversation';
    void fetch(
      `/api/threads/${encodeURIComponent(agent)}/${encodeURIComponent(activeThread)}?tail=200`,
    )
      .then((r) => r.json())
      .then((data: { ok?: boolean; messages?: ChatMessage[] }) => {
        const msgs = data.messages ?? messages.filter((m) => m.threadId === activeThread);
        const slug =
          title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || 'thread';
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        const header = [
          `# ${title}`,
          '',
          `_${agent} · thread ${activeThread} · exported ${new Date().toLocaleString()}_`,
          '',
          '---',
          '',
        ].join('\n');
        const body = msgs
          .map((m) => {
            const who = m.role === 'user' ? 'You' : agent;
            const when = new Date(m.createdAt).toISOString();
            return `## ${who} · ${when}\n\n${m.content}\n`;
          })
          .join('\n');
        const md = header + body;
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `thread-${slug}-${stamp}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 500);
        showToast(`Exported ${msgs.length} message${msgs.length === 1 ? '' : 's'}`, 'ok');
      })
      .catch(() => showToast('Export failed', 'err'));
  };

  const send = () => {
    if ((!pending.trim() && attachments.length === 0) || !activeThread) return;
    // `/help` is a client-only slash — open the shortcuts panel via the
    // same `?` keydown the App listens for, then clear the composer.
    if (pending.trim() === '/help') {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '?', shiftKey: true }),
      );
      setPending('');
      return;
    }
    // Compose the user content with any pasted attachments. They aren't
    // bytes-on-the-wire yet (multimodal model wiring is separate), but the
    // textual mention at least gives the agent useful context that an
    // image was offered. The image bytes stay client-side until we add a
    // proper attachments endpoint.
    let userContent = pending.trim();
    if (attachments.length > 0) {
      const refs = attachments
        .map((a) => `[image attached: ${a.name} (${formatBytes(a.size)}, ${a.type})]`)
        .join('\n');
      userContent = userContent ? `${userContent}\n\n${refs}` : refs;
    }
    setPending('');
    setAttachments([]);

    // `/goal …` slash command — branch off into the long-running workflow
    // path. The user gets an inline GoalCard that polls /api/goal/<id> until
    // the workflow lands, with approval gates surfaced when a step needs OK.
    if (userContent.toLowerCase().startsWith('/goal ')) {
      const goalText = userContent.slice(6).trim();
      if (goalText.length >= 4) {
        // Echo the user message into the thread so the transcript still
        // reads naturally, then kick the workflow.
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            threadId: activeThread,
            role: 'user',
            content: userContent,
            createdAt: Date.now(),
          },
        ]);
        void fetch('/api/goal/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal: goalText, agentName: flow.agentName || 'guest' }),
        })
          .then((r) => r.json())
          .then((data: { ok: boolean; runId?: string; error?: string }) => {
            if (data.ok && data.runId && activeThread) {
              setGoalRuns((prev) => [
                ...prev,
                { runId: data.runId!, goal: goalText, threadId: activeThread },
              ]);
            } else {
              setMessages((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  threadId: activeThread,
                  role: 'assistant',
                  content: `Couldn't start the goal workflow: ${data.error ?? 'unknown error'}.`,
                  createdAt: Date.now(),
                },
              ]);
            }
          })
          .catch((err) => {
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                threadId: activeThread,
                role: 'assistant',
                content: `Goal workflow failed to start: ${err instanceof Error ? err.message : String(err)}.`,
                createdAt: Date.now(),
              },
            ]);
          });
        return;
      }
    }

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

  const onResizerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    // Anchor: current canvas pane width in px. Read from the live DOM so
    // we don't have to know whether it's still on the default 1.4fr or
    // an earlier override.
    const pane = document.querySelector('.shell__canvas-pane') as HTMLElement | null;
    const startW = pane?.offsetWidth ?? 600;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const dx = startX - ev.clientX; // drag left ⇒ canvas grows
      const width = startW + dx;
      const minCanvas = 320;
      const maxCanvas = Math.max(minCanvas, window.innerWidth - 220 - 360 - 8);
      const next = Math.max(minCanvas, Math.min(maxCanvas, width));
      setCanvasPx(next);
    };
    const onUp = (ev: PointerEvent) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  };

  // Persist canvas width on every change. Skipping the initial null so we
  // don't clobber a fresh choice during the first render.
  useEffect(() => {
    if (canvasPx === null) {
      window.localStorage.removeItem('openthink:canvasPx');
    } else {
      window.localStorage.setItem('openthink:canvasPx', String(canvasPx));
    }
  }, [canvasPx]);

  return (
    <div
      className={`shell shell--pane-${mobilePane}${canvasPx !== null ? ' shell--canvas-sized' : ''}`}
      style={canvasPx !== null ? ({ '--canvas-w': `${canvasPx}px` } as React.CSSProperties) : undefined}
    >
      <AppSidebar
        flow={flow}
        active="shell"
        threads={threads}
        activeThread={activeThread}
        onSelectThread={setActiveThread}
        onArchiveThread={(id) => {
          // Optimistic remove; if the user archived the active thread, jump
          // to the first remaining one.
          setThreads((prev) => prev.filter((t) => t.id !== id));
          if (activeThread === id) {
            setActiveThread((prev) => {
              const next = threads.find((t) => t.id !== id);
              return next?.id ?? null;
            });
          }
          void fetch(
            `/api/threads/${encodeURIComponent(flow.agentName || 'guest')}/${encodeURIComponent(id)}/archive`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ archived: true }),
            },
          ).catch(() => undefined);
        }}
        onRestoreThread={(id) => {
          // POST archived:false and re-pull the active list so the row
          // moves back into the Recent section.
          void fetch(
            `/api/threads/${encodeURIComponent(flow.agentName || 'guest')}/${encodeURIComponent(id)}/archive`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ archived: false }),
            },
          )
            .then(() =>
              fetch(`/api/threads/${encodeURIComponent(flow.agentName || 'guest')}?limit=25`),
            )
            .then((r) => r?.json())
            .then((data: { threads?: Array<{ id: string; title: string; updatedAt: number; pinned?: boolean }> }) => {
              if (data?.threads) setThreads(data.threads);
            })
            .catch(() => undefined);
        }}
        onPinThread={(id, pinned) => {
          // Optimistic update + re-sort: pinned threads always float to
          // the top of their archived/active group. The orchestrator
          // also emits a `thread-pinned` WS frame; the Shell currently
          // doesn't fold that (rename/archive/bump are enough for cross-
          // tab), so the optimistic update is the user-visible source
          // of truth and the next listThreads refresh confirms.
          setThreads((prev) => {
            const next = prev.map((t) => (t.id === id ? { ...t, pinned } : t));
            return next.sort((a, b) => {
              if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
              return b.updatedAt - a.updatedAt;
            });
          });
          void fetch(
            `/api/threads/${encodeURIComponent(flow.agentName || 'guest')}/${encodeURIComponent(id)}/pin`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pinned }),
            },
          ).catch(() => undefined);
        }}
      />

      <section className="shell__thread-feed">
        <header className="shell__feed-header">
          {renamingTitle ? (
            <input
              className="shell__feed-title shell__feed-title--editing ot-input"
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                const next = titleDraft.trim();
                setRenamingTitle(false);
                if (!activeThread || !next) return;
                setThreads((prev) =>
                  prev.map((t) => (t.id === activeThread ? { ...t, title: next } : t)),
                );
                void fetch(
                  `/api/threads/${encodeURIComponent(flow.agentName || 'guest')}/${encodeURIComponent(activeThread)}/title`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: next }),
                  },
                ).catch(() => undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                  setRenamingTitle(false);
                  setTitleDraft('');
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="shell__feed-title shell__feed-title--button"
              onClick={() => {
                const current =
                  threads.find((t) => t.id === activeThread)?.title ?? 'Conversation';
                setTitleDraft(current);
                setRenamingTitle(true);
              }}
              title="Click to rename"
            >
              {threads.find((t) => t.id === activeThread)?.title ?? 'Conversation'}
            </button>
          )}
          <div className="shell__feed-header-actions">
            <button
              type="button"
              className="shell__feed-header-btn"
              onClick={() => setSearchOpen((v) => !v)}
              title="Search in this thread (Ctrl/⌘+F)"
              aria-label="Search in thread"
              aria-expanded={searchOpen}
            >
              ⌕ search
            </button>
            <button
              type="button"
              className="shell__feed-header-btn"
              onClick={() => exportThread()}
              title="Export this thread as markdown"
              aria-label="Export thread"
              disabled={!activeThread || messages.length === 0}
            >
              ⬇ export
            </button>
            {!workingDoc && !workingDocEditing && (
              <button
                type="button"
                className="shell__feed-header-btn"
                onClick={() => setWorkingDocEditing(true)}
                title="Pin a note the agent should always see"
              >
                + notes
              </button>
            )}
            <span className={`shell__socket shell__socket--${socket.state}`} title={`WS: ${socket.state}`}>
              <span className="shell__socket-dot" />
              {socket.state === 'open' ? 'live' : socket.state === 'unavailable' ? 'local echo' : socket.state}
            </span>
          </div>
        </header>
        {searchOpen && (
          <div className="shell__search-bar" role="search">
            <input
              autoFocus
              className="shell__search-bar-input"
              placeholder="Find in thread…"
              value={searchQ}
              onChange={(e) => {
                setSearchQ(e.target.value);
                setSearchCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchOpen(false);
                  setSearchQ('');
                } else if (e.key === 'Enter' && searchMatches.length > 0) {
                  e.preventDefault();
                  setSearchCursor((c) =>
                    e.shiftKey
                      ? (c - 1 + searchMatches.length) % searchMatches.length
                      : (c + 1) % searchMatches.length,
                  );
                } else if (e.key === 'ArrowDown' && searchMatches.length > 0) {
                  e.preventDefault();
                  setSearchCursor((c) => (c + 1) % searchMatches.length);
                } else if (e.key === 'ArrowUp' && searchMatches.length > 0) {
                  e.preventDefault();
                  setSearchCursor((c) => (c - 1 + searchMatches.length) % searchMatches.length);
                }
              }}
            />
            <span className="shell__search-bar-count">
              {searchQ.trim() === ''
                ? 'type to find'
                : searchMatches.length === 0
                  ? 'no matches'
                  : `${searchCursor + 1} / ${searchMatches.length}`}
            </span>
            <button
              type="button"
              className="shell__search-bar-step"
              aria-label="Previous match"
              disabled={searchMatches.length === 0}
              onClick={() =>
                setSearchCursor((c) =>
                  (c - 1 + searchMatches.length) % searchMatches.length,
                )
              }
            >
              ↑
            </button>
            <button
              type="button"
              className="shell__search-bar-step"
              aria-label="Next match"
              disabled={searchMatches.length === 0}
              onClick={() =>
                setSearchCursor((c) => (c + 1) % searchMatches.length)
              }
            >
              ↓
            </button>
            <button
              type="button"
              className="shell__search-bar-close"
              aria-label="Close search"
              onClick={() => {
                setSearchOpen(false);
                setSearchQ('');
              }}
            >
              ×
            </button>
          </div>
        )}
        <div className="shell__messages" aria-live="polite">
          {(workingDoc || workingDocEditing) && !isEmpty && (() => {
            const isCollapsed = !!workingDocCollapsed[activeThread ?? ''];
            const toggleCollapse = () =>
              setWorkingDocCollapsed((prev) => ({
                ...prev,
                [activeThread ?? '']: !prev[activeThread ?? ''],
              }));
            return (
            <aside
              className={`shell__working-doc${isCollapsed ? ' shell__working-doc--collapsed' : ''}`}
              aria-label="Agent's notes"
            >
              <header className="shell__working-doc-head">
                <button
                  type="button"
                  className="shell__working-doc-collapse"
                  onClick={toggleCollapse}
                  aria-expanded={!isCollapsed}
                  aria-label={isCollapsed ? 'Expand notes' : 'Collapse notes'}
                  title={isCollapsed ? 'Expand' : 'Collapse'}
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
                <span className="shell__working-doc-pill">Agent's notes</span>
                {isCollapsed && workingDoc && (
                  <span className="shell__working-doc-preview">
                    {workingDoc.slice(0, 90)}
                    {workingDoc.length > 90 ? '…' : ''}
                  </span>
                )}
                {!isCollapsed && (
                  <>
                    {(workingDocSaving || workingDocSavedAt || workingDocError) && (
                      <span
                        className={`shell__working-doc-status${workingDocError ? ' shell__working-doc-status--err' : ''}`}
                        title={
                          workingDocError
                            ? 'Save failed — check your connection'
                            : workingDocSavedAt
                              ? `Saved ${new Date(workingDocSavedAt).toLocaleTimeString()}`
                              : 'Saving…'
                        }
                      >
                        {workingDocError
                          ? '⊘ save failed'
                          : workingDocSaving
                            ? '◐ saving…'
                            : workingDocSavedAt
                              ? `✓ saved ${workingDocSavedLabel(workingDocSavedAt)}`
                              : null}
                      </span>
                    )}
                    <button
                      type="button"
                      className="shell__working-doc-toggle"
                      onClick={() => setWorkingDocEditing((v) => !v)}
                    >
                      {workingDocEditing ? 'done' : 'edit'}
                    </button>
                  </>
                )}
              </header>
              {!isCollapsed && (workingDocEditing ? (
                <>
                  <textarea
                    className="shell__working-doc-input"
                    value={workingDoc}
                    onChange={(e) => setWorkingDoc(e.target.value)}
                    onBlur={(e) => persistWorkingDoc(e.target.value)}
                    placeholder="Notes the agent should always keep in mind for this thread…"
                    rows={3}
                    autoFocus
                  />
                  {workingDoc.trim().length === 0 && (
                    <div className="shell__working-doc-templates">
                      <span className="ot-micro">or start from a template:</span>
                      {WORKING_DOC_TEMPLATES.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className="shell__working-doc-template"
                          onClick={() => {
                            setWorkingDoc(t.body);
                            persistWorkingDoc(t.body);
                          }}
                          title={t.hint}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="shell__working-doc-body">{workingDoc}</p>
              ))}
            </aside>
            );
          })()}
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
            messages.map((m) => {
              // Highlight matches for this message; the active match (one
              // of potentially several within this message) renders with
              // a stronger accent so the user knows where they are in the
              // walk. Each match span gets a stable id so the scroll
              // effect above can target it precisely.
              const q = searchOpen ? searchQ.trim() : '';
              const activeMatch = searchOpen && searchMatches.length > 0
                ? searchMatches[searchCursor]
                : null;
              const matchIndexInThisMessage = activeMatch && activeMatch.messageId === m.id
                ? (() => {
                    let idx = 0;
                    for (let i = 0; i < searchCursor; i++) {
                      if (searchMatches[i]!.messageId === m.id) idx++;
                    }
                    return idx;
                  })()
                : -1;
              return (
                <article
                  key={m.id}
                  id={`shell-msg-${m.id}`}
                  className={`shell__msg shell__msg--${m.role}`}
                >
                  <span className="shell__msg-role">{m.role === 'user' ? 'You' : flow.agentName || 'agent'}</span>
                  <div className="shell__msg-body">
                    {renderMessageBody(m.content, q, matchIndexInThisMessage)}
                  </div>
                  <div className="shell__msg-actions">
                    <button
                      type="button"
                      className="shell__msg-action"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(m.content)
                          .then(() => showToast('Copied message', 'ok'))
                          .catch(() => showToast('Copy failed', 'err'));
                      }}
                      title="Copy message"
                      aria-label="Copy message"
                    >
                      ⧉
                    </button>
                  </div>
                </article>
              );
            })}
          {goalRuns
            .filter((g) => g.threadId === activeThread)
            .map((g) => (
              <GoalCard key={g.runId} runId={g.runId} />
            ))}
          {socket.toolEvents.length > 0 && (
            <div className="shell__tool-stack" aria-label="Tool calls">
              <ul className="shell__tools">
                {socket.toolEvents.slice(-4).map((evt) => {
                  const expanded = expandedToolCallId === evt.callId;
                  const canExpand = evt.status === 'done' || evt.status === 'blocked';
                  return (
                    <li
                      key={evt.callId}
                      className={
                        `shell__tool shell__tool--${evt.status}` +
                        (expanded ? ' shell__tool--expanded' : '')
                      }
                      title={evt.reason ?? evt.tool}
                    >
                      <button
                        type="button"
                        className="shell__tool-handle"
                        onClick={() =>
                          canExpand &&
                          setExpandedToolCallId((cur) => (cur === evt.callId ? null : evt.callId))
                        }
                        aria-expanded={expanded}
                        aria-disabled={!canExpand}
                      >
                        <span className="shell__tool-glyph" aria-hidden>
                          {evt.status === 'running'
                            ? '◐'
                            : evt.status === 'done'
                              ? '●'
                              : evt.status === 'blocked'
                                ? '⊘'
                                : '⊗'}
                        </span>
                        <span className="shell__tool-name">{evt.tool}</span>
                        <span className="shell__tool-meta">
                          {evt.status === 'running' && '…'}
                          {evt.status === 'done' &&
                            evt.startedAt &&
                            evt.finishedAt &&
                            `${((evt.finishedAt - evt.startedAt) / 1000).toFixed(1)}s`}
                          {evt.status === 'blocked' && (evt.reason ?? 'blocked')}
                        </span>
                        {canExpand && (
                          <span className="shell__tool-caret" aria-hidden>
                            {expanded ? '▴' : '▾'}
                          </span>
                        )}
                      </button>
                      {expanded && (
                        <div className="shell__tool-result">
                          {renderToolResult(evt.tool, evt.result, evt.reason)}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
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
                // Persist the skill server-side. The SKILL.md body is
                // derived from the trained plan + summary; we synthesize a
                // minimal one here since the train flow doesn't track the
                // full body yet.
                void fetch('/api/skills', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name,
                    description: 'Saved from a trained run via Train mode.',
                    whenToUse: 'when this trigger phrase appears in the conversation',
                    body: `# ${name}\n\nSaved via Train mode on ${new Date().toISOString()}.\n`,
                    tags: ['local', 'trained'],
                  }),
                })
                  .then((r) => r.json())
                  .then((data: { ok: boolean; id?: string }) => {
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: crypto.randomUUID(),
                        threadId: activeThread ?? 'welcome',
                        role: 'assistant',
                        content: data.ok
                          ? `Saved skill "${name}". You can find it under Skills (id: ${data.id ?? '?'}).`
                          : `Couldn't save skill "${name}" — the worker didn't accept it.`,
                        createdAt: Date.now(),
                      },
                    ]);
                  })
                  .catch(() =>
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: crypto.randomUUID(),
                        threadId: activeThread ?? 'welcome',
                        role: 'assistant',
                        content: `Couldn't reach the Worker to save "${name}". Skill is local-only this session.`,
                        createdAt: Date.now(),
                      },
                    ]),
                  );
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
          {!suggest && slashPreview && (
            <div
              className="shell__slash-preview"
              role="status"
              aria-live="polite"
              title="This message will run as a slash command"
            >
              <span className="shell__slash-preview-glyph" aria-hidden>
                →
              </span>
              <span className="shell__slash-preview-name">
                {slashPreview.name}
              </span>
              <span className="shell__slash-preview-hint">
                {slashPreview.hint}
              </span>
            </div>
          )}
          {suggest && composerSuggestions.length > 0 && (
            <div className="shell__suggest" role="listbox">
              <div className="shell__suggest-head">
                {suggest.kind === 'slash' ? 'Slash commands' : 'Mentions'}
              </div>
              {composerSuggestions.map((s, i) => (
                <button
                  key={`${s.label}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === suggest.cursor}
                  className={`shell__suggest-item${i === suggest.cursor ? ' shell__suggest-item--active' : ''}`}
                  onMouseEnter={() =>
                    setSuggest((cur) => (cur ? { ...cur, cursor: i } : cur))
                  }
                  onClick={() => {
                    // Splice the suggestion's `insert` text in over the
                    // active token (from tokenStart to current cursor).
                    setPending((prev) => {
                      const before = prev.slice(0, suggest.tokenStart);
                      // For mentions, replace the @-token; for slashes
                      // replace the leading /token.
                      const insertEnd =
                        suggest.kind === 'mention'
                          ? suggest.tokenStart + suggest.query.length + 1
                          : prev.indexOf(' ', suggest.tokenStart) < 0
                            ? prev.length
                            : prev.indexOf(' ', suggest.tokenStart);
                      const after = prev.slice(insertEnd);
                      return before + s.insert + after.trimStart();
                    });
                    setSuggest(null);
                  }}
                >
                  <span className="shell__suggest-label">{s.label}</span>
                  <span className="shell__suggest-hint">{s.hint}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={composerRef}
            className="shell__composer-input"
            placeholder={`Message ${flow.agentName || 'your agent'}…`}
            value={pending}
            onChange={(e) => {
              const value = e.target.value;
              setPending(value);
              const t = detectTrigger(value, e.target.selectionStart ?? value.length);
              setSuggest(t ? { ...t, cursor: 0 } : null);
            }}
            onKeyDown={(e) => {
              if (suggest && composerSuggestions.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSuggest((cur) =>
                    cur ? { ...cur, cursor: (cur.cursor + 1) % composerSuggestions.length } : cur,
                  );
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSuggest((cur) =>
                    cur
                      ? {
                          ...cur,
                          cursor:
                            (cur.cursor - 1 + composerSuggestions.length) %
                            composerSuggestions.length,
                        }
                      : cur,
                  );
                  return;
                }
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                  e.preventDefault();
                  const picked = composerSuggestions[suggest.cursor];
                  if (!picked) return;
                  setPending((prev) => {
                    const before = prev.slice(0, suggest.tokenStart);
                    const insertEnd =
                      suggest.kind === 'mention'
                        ? suggest.tokenStart + suggest.query.length + 1
                        : prev.indexOf(' ', suggest.tokenStart) < 0
                          ? prev.length
                          : prev.indexOf(' ', suggest.tokenStart);
                    const after = prev.slice(insertEnd);
                    return before + picked.insert + after.trimStart();
                  });
                  setSuggest(null);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setSuggest(null);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            onBlur={() => {
              // Slight delay so click on a suggestion still registers
              // before the popover unmounts.
              window.setTimeout(() => setSuggest(null), 150);
            }}
            onPaste={(e) => {
              // Grab the first image item from the clipboard, if any. Most
              // OSes paste images as `image/png`; we accept any image/*.
              const items = Array.from(e.clipboardData?.items ?? []);
              const imageItem = items.find((it) => it.kind === 'file' && it.type.startsWith('image/'));
              if (!imageItem) return;
              const file = imageItem.getAsFile();
              if (!file) return;
              if (file.size > 5 * 1024 * 1024) {
                // Quietly refuse oversized pastes; show a transient hint
                // in the composer so the user knows why nothing happened.
                setPending((p) => p + (p ? ' ' : '') + '[image too large — 5MB cap]');
                return;
              }
              if (attachments.length >= 3) return;
              e.preventDefault();
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = String(reader.result ?? '');
                setAttachments((prev) => [
                  ...prev,
                  {
                    id: crypto.randomUUID(),
                    name: file.name || `paste-${Date.now()}.png`,
                    type: file.type,
                    size: file.size,
                    dataUrl,
                  },
                ]);
              };
              reader.readAsDataURL(file);
            }}
          />
          {attachments.length > 0 && (
            <div className="shell__attachments" aria-label="Attachments">
              {attachments.map((a) => {
                // Image kinds get the data-URL thumb; everything else
                // (PDF, text, audio, etc.) gets a glyph in the same
                // 36×36 slot so the row stays visually uniform. The
                // thumbnail is now a button — clicking opens the data
                // URL in a new tab so the user can verify what's
                // attached before hitting Send.
                const isImage = a.type.startsWith('image/');
                const glyph =
                  a.type.includes('pdf')
                    ? '📕'
                    : a.type.startsWith('audio/')
                      ? '🎵'
                      : a.type.startsWith('video/')
                        ? '🎬'
                        : a.type.includes('json')
                          ? '◰'
                          : a.type.startsWith('text/')
                            ? '¶'
                            : '📄';
                return (
                  <div
                    key={a.id}
                    className="shell__attachment"
                    title={`${a.name} · ${formatBytes(a.size)} · ${a.type || 'unknown type'}`}
                  >
                    <a
                      className="shell__attachment-thumb-link"
                      href={a.dataUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Preview ${a.name} in a new tab`}
                    >
                      {isImage ? (
                        <img className="shell__attachment-thumb" src={a.dataUrl} alt="" />
                      ) : (
                        <span
                          className="shell__attachment-thumb shell__attachment-thumb--glyph"
                          aria-hidden
                        >
                          {glyph}
                        </span>
                      )}
                    </a>
                    <span className="shell__attachment-meta">
                      <span className="shell__attachment-name">{a.name}</span>
                      <span className="shell__attachment-size">{formatBytes(a.size)}</span>
                    </span>
                    <button
                      type="button"
                      className="shell__attachment-remove"
                      aria-label={`Remove ${a.name}`}
                      onClick={() =>
                        setAttachments((prev) => prev.filter((x) => x.id !== a.id))
                      }
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
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
            <button
              type="button"
              className={`shell__code-mode shell__code-mode--${codeMode}`}
              onClick={() => {
                const next: 'always' | 'smart' | 'off' =
                  codeMode === 'always' ? 'smart' : codeMode === 'smart' ? 'off' : 'always';
                setCodeMode(next);
                socket.send({ type: 'set-code-mode', value: next });
                // Persist alongside the rest of the agent settings so a
                // returning session opens with the same code-mode.
                void fetch(
                  `/api/settings/${encodeURIComponent(flow.agentName || 'default')}`,
                  {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ codeMode: next }),
                  },
                ).catch(() => undefined);
              }}
              title="Click to cycle: Always · Smart · Off"
              aria-label={`Code mode: ${codeMode}`}
            >
              code · {codeMode}
            </button>
            {pending.length > 0 && (() => {
              // Cheap token estimate — 4 chars / token is a reasonable
              // average for English prose with Llama / Claude tokenizers.
              // Used purely as a visual cue; the real worker doesn't
              // gate on this number.
              const chars = pending.length;
              const tokens = Math.max(1, Math.round(chars / 4));
              const tier =
                chars >= 8000 ? 'danger' : chars >= 4000 ? 'warn' : 'ok';
              return (
                <span
                  className={`shell__count shell__count--${tier}`}
                  title={`${chars} characters · ~${tokens} tokens`}
                >
                  {chars.toLocaleString()} ch · ~{tokens.toLocaleString()} tok
                </span>
              );
            })()}
            <button
              type="button"
              className={`shell__voice${voiceListening ? ' shell__voice--listening' : ''}`}
              onClick={toggleVoice}
              aria-label={voiceListening ? 'Stop dictation' : 'Start dictation'}
              aria-pressed={voiceListening}
              title={
                voiceSupported
                  ? voiceListening
                    ? 'Listening — click to stop'
                    : 'Dictate into the composer (Web Speech API)'
                  : 'Voice input not supported in this browser — paste or type instead'
              }
              disabled={!voiceSupported}
            >
              {voiceListening ? '◉' : '🎤'}
            </button>
            <button type="submit" className="ot-btn shell__send" disabled={!pending.trim()}>
              Send
              <span className="shell__send-arrow" aria-hidden>→</span>
            </button>
          </div>
          {/* Composer keyboard hint — sits flush against the meta row,
              dim by default so it doesn't compete with the buttons.
              Clicking the "?" link opens the full shortcut cheat sheet
              so users can discover the rest of the bindings without
              leaving the chat. */}
          <div className="shell__composer-hint ot-micro" aria-hidden="false">
            <span>
              <kbd className="shell__kbd">Enter</kbd> send ·{' '}
              <kbd className="shell__kbd">Shift</kbd>+
              <kbd className="shell__kbd">Enter</kbd> newline ·{' '}
              <kbd className="shell__kbd">/</kbd> palette
            </span>
            <button
              type="button"
              className="shell__composer-hint-more"
              onClick={() => {
                // Custom event so we don't have to thread the modal's
                // open() callback down through props. App.tsx listens
                // for this alongside the global `?` key handler.
                window.dispatchEvent(new CustomEvent('openthink:open-shortcuts'));
              }}
              title="Show all keyboard shortcuts"
            >
              <kbd className="shell__kbd">?</kbd> all shortcuts
            </button>
          </div>
        </form>
      </section>

      <div
        className="shell__resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize canvas pane"
        onPointerDown={onResizerDown}
        onDoubleClick={() => setCanvasPx(null)}
        title="Drag to resize · double-click to reset"
      >
        <span className="shell__resizer-grip" aria-hidden />
      </div>

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

// Detect a composer autocomplete trigger from the current value + cursor.
// `slash` fires when the buffer starts with `/` and the caret is still in
// the first token; `mention` fires when there's an `@` within the last 30
// chars before the cursor and no whitespace has been typed since. Returns
// null when nothing's active so the dropdown stays closed during normal
// typing.
function detectTrigger(
  value: string,
  cursor: number,
): { kind: 'slash' | 'mention'; query: string; tokenStart: number } | null {
  const trimmedStart = value.trimStart();
  const offset = value.length - trimmedStart.length;
  if (trimmedStart.startsWith('/')) {
    const firstSpaceAfter = trimmedStart.indexOf(' ');
    const firstTokenEnd =
      firstSpaceAfter < 0 ? trimmedStart.length : firstSpaceAfter;
    const absoluteEnd = offset + firstTokenEnd;
    if (cursor >= offset && cursor <= absoluteEnd) {
      return { kind: 'slash', query: trimmedStart.slice(1, firstTokenEnd), tokenStart: offset };
    }
  }
  const head = value.slice(0, cursor);
  const at = head.lastIndexOf('@');
  if (at >= 0 && cursor - at <= 30) {
    const token = head.slice(at + 1);
    if (!/\s/.test(token)) {
      return { kind: 'mention', query: token, tokenStart: at };
    }
  }
  return null;
}

// Compact byte formatter for attachment chips. Lives near its callsite
// because the rest of the Shell doesn't need it.
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// Relative-time formatter tuned for the working-doc autosave pill —
// short, mono-friendly, drops to "just now" for sub-minute saves.
function workingDocSavedLabel(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0 || diff < 5_000) return 'just now';
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 60 * 60_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

// Split a message body around a query string, wrapping each match in a
// styled span. `activeMatchIndex` is the 0-based index of the currently-
// active match *within this message* so it can render with the stronger
// accent treatment. Returns an array of strings/spans the JSX renderer
// can consume.
function renderHighlighted(
  body: string,
  query: string,
  activeMatchIndex: number,
): React.ReactNode[] {
  if (!query) return [body];
  const parts: React.ReactNode[] = [];
  const ql = query.toLowerCase();
  const lower = body.toLowerCase();
  let from = 0;
  let matchN = 0;
  while (from < body.length) {
    const at = lower.indexOf(ql, from);
    if (at < 0) {
      parts.push(body.slice(from));
      break;
    }
    if (at > from) parts.push(body.slice(from, at));
    const slice = body.slice(at, at + query.length);
    const isActive = matchN === activeMatchIndex;
    parts.push(
      <mark
        key={`m-${at}`}
        className={`shell__msg-match${isActive ? ' shell__msg-match--active' : ''}`}
      >
        {slice}
      </mark>,
    );
    matchN += 1;
    from = at + query.length;
  }
  return parts;
}

// Render a message body with both `@thread:foo` / `@skill:bar` mention
// pills AND search highlighting. The mention regex is non-overlapping
// per match (word characters + dots + dashes), so we walk the body in
// segments, applying highlight to the non-mention parts. This is
// composable with `renderHighlighted` — mention segments are returned
// as-is, non-mention segments pass through the highlighter.
const MENTION_RE = /@(thread|skill):([\w.\-_]+)/g;
function renderMessageBody(
  body: string,
  query: string,
  activeMatchIndex: number,
): React.ReactNode[] {
  // Fast path: no mention tokens → fall straight through to the highlight
  // pipeline so a non-mention message keeps its existing render shape.
  if (!body.includes('@')) {
    return query ? renderHighlighted(body, query, activeMatchIndex) : [body];
  }
  const out: React.ReactNode[] = [];
  let last = 0;
  // Index into the per-message match list — we still need to thread
  // `activeMatchIndex` through the highlighter for the non-mention chunks.
  let mIndexOffset = 0;
  // Precompute mention positions so we can slice cleanly.
  const matches: Array<{ start: number; end: number; type: string; name: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(body))) {
    matches.push({ start: m.index, end: m.index + m[0].length, type: m[1]!, name: m[2]! });
  }
  if (matches.length === 0) {
    return query ? renderHighlighted(body, query, activeMatchIndex) : [body];
  }
  const countMatchesInSlice = (slice: string): number => {
    if (!query) return 0;
    const ql = query.toLowerCase();
    const lower = slice.toLowerCase();
    let from = 0;
    let n = 0;
    while (true) {
      const at = lower.indexOf(ql, from);
      if (at < 0) break;
      n++;
      from = at + ql.length;
    }
    return n;
  };
  for (const mt of matches) {
    if (mt.start > last) {
      const slice = body.slice(last, mt.start);
      if (query) {
        const inSlice = countMatchesInSlice(slice);
        // For this slice, the active-index relative to it is `activeMatchIndex - mIndexOffset`
        // (negative if the active match is outside this slice — the helper
        // will just render with no `--active` flag on any of them).
        out.push(
          ...renderHighlighted(slice, query, activeMatchIndex - mIndexOffset),
        );
        mIndexOffset += inSlice;
      } else {
        out.push(slice);
      }
    }
    out.push(
      <span
        key={`mention-${mt.start}`}
        className={`shell__mention shell__mention--${mt.type}`}
        title={`${mt.type}: ${mt.name}`}
      >
        @{mt.type}:{mt.name}
      </span>,
    );
    last = mt.end;
  }
  // Trailing slice after the final mention.
  if (last < body.length) {
    const slice = body.slice(last);
    if (query) {
      out.push(...renderHighlighted(slice, query, activeMatchIndex - mIndexOffset));
    } else {
      out.push(slice);
    }
  }
  return out;
}

// Render the expanded tool-call panel. Each tool returns a different shape;
// this dispatches by tool name and falls back to a pretty-printed JSON dump
// when the result doesn't match a known schema.
function renderToolResult(tool: string, result: unknown, reason?: string): React.ReactNode {
  if (reason) {
    return <p className="shell__tool-result-note">Blocked: {reason}</p>;
  }
  // The orchestrator wraps the DO RPC response in `{data: ...}`.
  const payload =
    result && typeof result === 'object' && 'data' in (result as Record<string, unknown>)
      ? ((result as Record<string, unknown>).data as Record<string, unknown> | undefined)
      : (result as Record<string, unknown> | undefined);

  if (!payload) return <p className="shell__tool-result-note">(no result body)</p>;

  if (tool.startsWith('researcher')) {
    const summary = (payload.summary as string) ?? '';
    const url = (payload.url as string) ?? '';
    const bytes = payload.bytes as number | undefined;
    const artifactKey = (payload.artifactKey as string) ?? '';
    return (
      <div className="shell__tool-result-body">
        {url && (
          <p className="shell__tool-result-meta">
            <strong>source:</strong>{' '}
            <a href={url} target="_blank" rel="noreferrer">
              {url}
            </a>
            {bytes !== undefined && <span> · {bytes.toLocaleString()} bytes</span>}
          </p>
        )}
        {summary ? <p>{summary}</p> : <p className="shell__tool-result-note">(empty summary)</p>}
        {artifactKey && (
          <p className="shell__tool-result-meta">
            <strong>saved:</strong>{' '}
            <a href="#/library" className="shell__tool-result-link">
              Library → {artifactKey.split('/').pop()}
            </a>
          </p>
        )}
      </div>
    );
  }
  if (tool.startsWith('coder')) {
    const review = (payload.review ?? payload) as {
      summary?: string;
      issues?: Array<{ severity: string; line?: number; note: string }>;
      suggestions?: string[];
      riskScore?: number;
      language?: string;
    };
    return (
      <div className="shell__tool-result-body">
        {review.summary && <p>{review.summary}</p>}
        {typeof review.riskScore === 'number' && (
          <p className="shell__tool-result-meta">
            <strong>risk:</strong> {(review.riskScore * 100).toFixed(0)}%
            {review.language && ` · ${review.language}`}
          </p>
        )}
        {Array.isArray(review.issues) && review.issues.length > 0 && (
          <>
            <p className="shell__tool-result-meta">
              <strong>issues:</strong>
            </p>
            <ul className="shell__tool-result-list">
              {review.issues.map((i, ix) => (
                <li key={ix}>
                  <span className={`shell__tool-result-sev shell__tool-result-sev--${i.severity}`}>
                    {i.severity}
                  </span>
                  {i.line !== undefined && <span className="ot-micro"> · line {i.line}</span>}
                  : {i.note}
                </li>
              ))}
            </ul>
          </>
        )}
        {Array.isArray(review.suggestions) && review.suggestions.length > 0 && (
          <>
            <p className="shell__tool-result-meta">
              <strong>suggestions:</strong>
            </p>
            <ul className="shell__tool-result-list">
              {review.suggestions.map((s, ix) => (
                <li key={ix}>{s}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  return (
    <pre className="shell__tool-result-raw">{JSON.stringify(payload, null, 2)}</pre>
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
