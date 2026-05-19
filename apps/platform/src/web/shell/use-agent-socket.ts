import { useEffect, useRef, useState } from 'react';

import type { ChatMessage } from '@shared/types';

export type AgentSocketState = 'idle' | 'connecting' | 'open' | 'closed' | 'unavailable';

// Tool-call lifecycle events streamed by the orchestrator. The Shell pins
// these under the assistant message that triggered the call so the user can
// see "researcher.research → ⏵ querying" → "✓ summarized 1,840 bytes" as it
// happens, without re-rendering the whole message.
export interface ToolCallEvent {
  callId: string;
  threadId: string;
  tool: string;
  status: 'running' | 'done' | 'error' | 'blocked';
  startedAt: number;
  finishedAt?: number;
  result?: unknown;
  reason?: string;
  remainingCents?: number;
}

// Spend frames let the budget bar live-update without a re-fetch.
export interface SpendUpdate {
  spentCentsToday: number;
  spendCapCents: number;
  dailyResetAt: number;
}

// Thread metadata mutations fan out to every socket (not just the one
// subscribed to the thread) so the sidebar stays in sync across tabs. The
// Shell uses an effect on `threadEvent` to fold them into the local
// `threads` array. Tagged with a `ts` so identical mutations still
// invalidate the effect.
//
// `bumped` is the cheap "this thread just got a new message, hop it to
// the top of the list" signal. We derive it inside this hook from the
// incoming `message` frame rather than asking the orchestrator to send
// a separate one — the orchestrator already does the SQL update, this
// is just letting the UI know.
export interface ThreadEvent {
  kind: 'renamed' | 'archived' | 'bumped';
  id: string;
  title?: string;
  archived?: boolean;
  ts: number;
}

export interface AgentSocket {
  state: AgentSocketState;
  send: (msg: { type: string; [key: string]: unknown }) => void;
  history: ChatMessage[];
  setHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  toolEvents: ToolCallEvent[];
  spend: SpendUpdate | null;
  threadEvent: ThreadEvent | null;
}

// useAgentSocket connects to /agents/<agentId>/ws on the same origin (Vite proxies
// to the Worker on :8787 in dev). When the Worker isn't running, the socket
// transitions to 'unavailable' and the caller falls back to a local echo so the
// shell still feels alive during development.
//
// Reconnect strategy: if a previously-open socket closes (network blip,
// worker hot-reload, DO eviction), retry with exponential backoff capped at
// 30s. Initial failed connects also retry — `unavailable` is reserved for
// "constructor threw immediately" which would loop forever otherwise.
// Closes during user-initiated unmount short-circuit the retry.
//
// Backoff sequence: 500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, ...
function backoffDelay(attempt: number): number {
  return Math.min(30_000, 500 * Math.pow(2, attempt));
}
export function useAgentSocket(agentId: string | null): AgentSocket {
  const [state, setState] = useState<AgentSocketState>('idle');
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [toolEvents, setToolEvents] = useState<ToolCallEvent[]>([]);
  const [spend, setSpend] = useState<SpendUpdate | null>(null);
  const [threadEvent, setThreadEvent] = useState<ThreadEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimer = useRef<number | null>(null);
  const retryAttempt = useRef<number>(0);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;

    const url = new URL(`/agents/${agentId}/ws`, window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

    const connect = () => {
      if (cancelled) return;
      setState('connecting');

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        console.warn('[agent-socket] construct failed', err);
        setState('unavailable');
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        retryAttempt.current = 0;
        setState('open');
      };
      ws.onclose = () => {
        if (cancelled) return;
        wsRef.current = null;
        // Schedule a reconnect — 'closed' surfaces in the UI so the user
        // sees the dropped state, but the timer keeps trying in the
        // background. Cleanup below clears the timer on unmount.
        setState('closed');
        const delay = backoffDelay(retryAttempt.current);
        retryAttempt.current = Math.min(retryAttempt.current + 1, 8);
        retryTimer.current = window.setTimeout(connect, delay);
      };
      ws.onerror = () => {
        // Errors immediately precede a close on most browsers; let the
        // close handler do the reconnect. Avoid stacking two timers.
      };
      ws.onmessage = (event) => {
        if (cancelled) return;
        try {
          const payload = JSON.parse(typeof event.data === 'string' ? event.data : '') as {
            type: string;
            message?: ChatMessage;
            history?: ChatMessage[];
            threadId?: string;
            callId?: string;
            tool?: string;
            result?: unknown;
            reason?: string;
            remainingCents?: number;
            spentCentsToday?: number;
            spendCapCents?: number;
            dailyResetAt?: number;
            id?: string;
            title?: string;
            archived?: boolean;
          };
          if (payload.type === 'message' && payload.message) {
            setHistory((prev) => upsertMessage(prev, payload.message!));
            // Also bump the sidebar — the appended message's `createdAt`
            // is the same value the orchestrator just wrote into
            // `threads.updated_at`, so the local sort will match the DO's.
            setThreadEvent({
              kind: 'bumped',
              id: payload.message.threadId,
              ts: payload.message.createdAt || Date.now(),
            });
          } else if (payload.type === 'thread-history' && payload.history) {
            setHistory(payload.history);
          } else if (
            payload.type === 'tool-start' &&
            payload.callId &&
            payload.threadId &&
            payload.tool
          ) {
            setToolEvents((prev) => [
              ...prev,
              {
                callId: payload.callId!,
                threadId: payload.threadId!,
                tool: payload.tool!,
                status: 'running',
                startedAt: Date.now(),
              },
            ]);
          } else if (payload.type === 'tool-done' && payload.callId) {
            setToolEvents((prev) =>
              prev.map((e) =>
                e.callId === payload.callId
                  ? { ...e, status: 'done', finishedAt: Date.now(), result: payload.result }
                  : e,
              ),
            );
          } else if (payload.type === 'tool-blocked' && payload.callId) {
            setToolEvents((prev) => [
              ...prev,
              {
                callId: payload.callId!,
                threadId: payload.threadId ?? '',
                tool: payload.tool ?? 'unknown',
                status: 'blocked',
                startedAt: Date.now(),
                finishedAt: Date.now(),
                reason: payload.reason,
                remainingCents: payload.remainingCents,
              },
            ]);
            // Surface to components outside the Shell subtree (Settings →
            // Spending in particular wants to show a "cap hit" banner +
            // immediately re-pull the spend rollup).
            window.dispatchEvent(
              new CustomEvent('openthink:tool-blocked', {
                detail: {
                  tool: payload.tool ?? 'unknown',
                  reason: payload.reason ?? 'cap_reached',
                  remainingCents: payload.remainingCents ?? 0,
                },
              }),
            );
          } else if (
            payload.type === 'spend' &&
            typeof payload.spentCentsToday === 'number' &&
            typeof payload.spendCapCents === 'number'
          ) {
            setSpend({
              spentCentsToday: payload.spentCentsToday,
              spendCapCents: payload.spendCapCents,
              dailyResetAt: payload.dailyResetAt ?? 0,
            });
            window.dispatchEvent(
              new CustomEvent('openthink:spend', {
                detail: {
                  spentCentsToday: payload.spentCentsToday,
                  capCents: payload.spendCapCents,
                  dailyResetAt: payload.dailyResetAt ?? 0,
                },
              }),
            );
          } else if (
            payload.type === 'thread-renamed' &&
            typeof payload.id === 'string' &&
            typeof payload.title === 'string'
          ) {
            setThreadEvent({
              kind: 'renamed',
              id: payload.id,
              title: payload.title,
              ts: Date.now(),
            });
          } else if (
            payload.type === 'thread-archived' &&
            typeof payload.id === 'string' &&
            typeof payload.archived === 'boolean'
          ) {
            setThreadEvent({
              kind: 'archived',
              id: payload.id,
              archived: payload.archived,
              ts: Date.now(),
            });
          }
        } catch (err) {
          console.warn('[agent-socket] message parse', err);
        }
      };
    };

    // Kick off the first connect attempt; subsequent ones come from onclose.
    retryAttempt.current = 0;
    connect();

    return () => {
      cancelled = true;
      if (retryTimer.current !== null) {
        window.clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
      const ws = wsRef.current;
      if (ws) {
        // Detach handlers so a closing socket doesn't try to reconnect from
        // this stale closure.
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.onopen = null;
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      }
      wsRef.current = null;
    };
  }, [agentId]);

  return {
    state,
    history,
    setHistory,
    toolEvents,
    spend,
    threadEvent,
    send: (msg) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(msg));
    },
  };
}

function upsertMessage(prev: ChatMessage[], next: ChatMessage): ChatMessage[] {
  const i = prev.findIndex((m) => m.id === next.id);
  if (i >= 0) {
    const out = prev.slice();
    out[i] = next;
    return out;
  }
  return [...prev, next];
}
