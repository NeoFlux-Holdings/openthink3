import { Hono } from 'hono';

import type { Env, Variables } from '../env';

export const browserSessions = new Hono<{ Bindings: Env; Variables: Variables }>();

// Per-session WS bridge. The browser DO accepts ws upgrades; we route here
// instead of through the orchestrator so the canvas can pop out a session
// without holding the orchestrator's socket.
browserSessions.get('/:sessionId/ws', async (c) => {
  const upgrade = c.req.header('Upgrade');
  if (upgrade !== 'websocket') {
    return new Response('Expected websocket', { status: 426 });
  }
  const sessionId = c.req.param('sessionId');
  const id = c.env.BROWSER_SESSION.idFromName(sessionId);
  const stub = c.env.BROWSER_SESSION.get(id);
  return stub.fetch(c.req.raw as unknown as Request);
});

browserSessions.post('/:sessionId/action', async (c) => {
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json().catch(() => ({}));
  const id = c.env.BROWSER_SESSION.idFromName(sessionId);
  const stub = c.env.BROWSER_SESSION.get(id) as unknown as {
    invoke(method: string, args: unknown): Promise<unknown>;
  };
  const result = await stub.invoke('action', body);
  return c.json({ ok: true, result });
});

browserSessions.get('/:sessionId/snapshot', async (c) => {
  const sessionId = c.req.param('sessionId');
  const id = c.env.BROWSER_SESSION.idFromName(sessionId);
  const stub = c.env.BROWSER_SESSION.get(id) as unknown as {
    invoke(method: string, args: unknown): Promise<{ r2Key?: string }>;
  };
  const out = await stub.invoke('snapshot', {});
  return c.json({ ok: true, ...out });
});
