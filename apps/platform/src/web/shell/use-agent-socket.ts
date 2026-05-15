import { useEffect, useRef, useState } from 'react';

import type { ChatMessage } from '@shared/types';

export type AgentSocketState = 'idle' | 'connecting' | 'open' | 'closed' | 'unavailable';

export interface AgentSocket {
  state: AgentSocketState;
  send: (msg: { type: string; [key: string]: unknown }) => void;
  history: ChatMessage[];
  setHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

// useAgentSocket connects to /agents/<agentId>/ws on the same origin (Vite proxies
// to the Worker on :8787 in dev). When the Worker isn't running, the socket
// transitions to 'unavailable' and the caller falls back to a local echo so the
// shell still feels alive during development.
export function useAgentSocket(agentId: string | null): AgentSocket {
  const [state, setState] = useState<AgentSocketState>('idle');
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    setState('connecting');

    const url = new URL(`/agents/${agentId}/ws`, window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

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
      setState('open');
    };
    ws.onclose = () => {
      if (cancelled) return;
      setState((prev) => (prev === 'open' ? 'closed' : 'unavailable'));
      wsRef.current = null;
    };
    ws.onerror = () => {
      if (cancelled) return;
      setState((prev) => (prev === 'open' ? 'closed' : 'unavailable'));
    };
    ws.onmessage = (event) => {
      if (cancelled) return;
      try {
        const payload = JSON.parse(typeof event.data === 'string' ? event.data : '') as {
          type: string;
          message?: ChatMessage;
          history?: ChatMessage[];
        };
        if (payload.type === 'message' && payload.message) {
          setHistory((prev) => upsertMessage(prev, payload.message!));
        } else if (payload.type === 'thread-history' && payload.history) {
          setHistory(payload.history);
        }
      } catch (err) {
        console.warn('[agent-socket] message parse', err);
      }
    };

    return () => {
      cancelled = true;
      ws.close();
      wsRef.current = null;
    };
  }, [agentId]);

  return {
    state,
    history,
    setHistory,
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
