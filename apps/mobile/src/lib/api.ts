/* Thin HTTP client for the OpenThink mobile API.
 *
 * Every request goes to the user's own agent (saved in session storage) with
 * an `Authorization: Bearer <token>` header. We don't talk to openthink.com
 * for app data — only to the agent.
 */
import type { Session } from './session';

export interface Approval {
  id: string;
  threadId: string;
  kind: 'tool' | 'send' | 'spend' | 'other';
  title: string;
  body?: string;
  meta?: string;
  costUsd?: number;
  createdAt: number;
}

export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: number;
  live?: boolean;
  pending?: number;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  time: string;
  tools?: { name: string }[];
  reasoned?: { seconds: number; tokens: number; preview: string };
}

export interface Conversation {
  id: string;
  title: string;
  messages: ConversationMessage[];
  artifacts: { id: string; type: string; title: string; size: string }[];
  workingNotes?: { goal: string; found: string; working: string; updatedAt: number };
  live?: boolean;
}

export interface TodayState {
  greeting: string;
  agentName: string;
  liveTask?: {
    threadId: string;
    title: string;
    statusLine: string;
    spent: number;
    elapsed: string;
    toolsUsed: number;
  };
  approvals: Approval[];
  spend: { today: number; cap: number };
  recentThreads: ThreadSummary[];
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(session: Session, path: string, init: RequestInit = {}): Promise<T> {
  const url = `${session.agentUrl}${path}`;
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.token}`);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Fetch the Today screen state (greeting, live task, approvals, spend, recents). */
export const getToday = (s: Session) => request<TodayState>(s, '/api/mobile/today');

/** Threads list. */
export const getThreads = (s: Session, scope: 'all' | 'live' | 'today' | 'week' | 'approvals' = 'all') =>
  request<{ threads: ThreadSummary[] }>(s, `/api/mobile/threads?scope=${scope}`);

/** Conversation detail. */
export const getConversation = (s: Session, id: string) =>
  request<Conversation>(s, `/api/mobile/threads/${encodeURIComponent(id)}`);

/** Approvals list (for the You / Notifications screen). */
export const getApprovals = (s: Session) => request<{ approvals: Approval[] }>(s, '/api/mobile/approvals');

/** Respond to an approval. */
export const respondToApproval = (s: Session, id: string, decision: 'send' | 'skip' | 'edit') =>
  request<{ ok: boolean }>(s, `/api/mobile/approvals/${encodeURIComponent(id)}/respond`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });

/** Library tiles. */
export const getLibrary = (s: Session) =>
  request<{ items: { id: string; title: string; type: string; size: string; age: string }[] }>(
    s,
    '/api/mobile/library',
  );

/** Send a new chat message (kicks the agent into action). */
export const sendMessage = (s: Session, threadId: string | null, text: string) =>
  request<{ threadId: string }>(s, '/api/mobile/threads/send', {
    method: 'POST',
    body: JSON.stringify({ threadId, text }),
  });

/** Register the device's push token with the agent. */
export const registerPushToken = (s: Session, token: string, platform: 'ios' | 'android') =>
  request<{ ok: boolean }>(s, '/api/mobile/push/register', {
    method: 'POST',
    body: JSON.stringify({ token, platform }),
  });

/** Trade a magic-link code (entered by the user from their browser) for a session token. */
export async function exchangeMagicCode(
  agentUrl: string,
  code: string,
  deviceLabel: string,
): Promise<{ token: string; agentName: string }> {
  const url = `${agentUrl}/api/mobile/session/exchange`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code, deviceLabel }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text || res.statusText);
  }
  return (await res.json()) as { token: string; agentName: string };
}

export { ApiError };
