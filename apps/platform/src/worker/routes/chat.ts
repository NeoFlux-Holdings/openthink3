import { Hono } from 'hono';

import type { Env, Variables } from '../env';

export const chat = new Hono<{ Bindings: Env; Variables: Variables }>();

function orchestratorStub(env: Env, agentId: string) {
  const id = env.ORCHESTRATOR.idFromName(agentId);
  return env.ORCHESTRATOR.get(id);
}

chat.get('/:agentId/threads', async (c) => {
  const stub = orchestratorStub(c.env, c.req.param('agentId'));
  // @ts-expect-error — RPC-style call via fetch path. Replaced with addMcpServer RPC in iteration 6.
  const threads = await (stub as DurableObjectStub & { listThreads(limit?: number): Promise<unknown> }).listThreads(50);
  return c.json({ threads });
});

chat.post('/:agentId/threads', async (c) => {
  const stub = orchestratorStub(c.env, c.req.param('agentId'));
  const body = await c.req.json().catch(() => ({}));
  // @ts-expect-error
  const result = await (stub as DurableObjectStub & { createThread(title?: string): Promise<unknown> }).createThread(
    typeof body.title === 'string' ? body.title : undefined,
  );
  return c.json(result);
});

chat.get('/:agentId/threads/:threadId', async (c) => {
  const stub = orchestratorStub(c.env, c.req.param('agentId'));
  // @ts-expect-error
  const history = await (stub as DurableObjectStub & { getThread(id: string): Promise<unknown> }).getThread(
    c.req.param('threadId'),
  );
  return c.json({ history });
});
