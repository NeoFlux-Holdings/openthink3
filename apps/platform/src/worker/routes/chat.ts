import { Hono } from 'hono';
import type { DurableObjectStub } from '@cloudflare/workers-types';

import type { Env, Variables } from '../env';
import type { ChatMessage } from '../../shared/types';

// Local RPC shape — mirrors the Orchestrator's public methods. The DO stub call sites
// cast to this so we get end-to-end typing without leaning on internal Worker SDK types.
interface OrchestratorRpc extends DurableObjectStub {
  listThreads(limit?: number): Promise<Array<{ id: string; title: string; updatedAt: number }>>;
  createThread(title?: string): Promise<{ id: string }>;
  getThread(threadId: string): Promise<ChatMessage[]>;
}

export const chat = new Hono<{ Bindings: Env; Variables: Variables }>();

function orchestratorStub(env: Env, agentId: string): OrchestratorRpc {
  const id = env.ORCHESTRATOR.idFromName(agentId);
  return env.ORCHESTRATOR.get(id) as unknown as OrchestratorRpc;
}

chat.get('/:agentId/threads', async (c) => {
  const stub = orchestratorStub(c.env, c.req.param('agentId'));
  const threads = await stub.listThreads(50);
  return c.json({ threads });
});

chat.post('/:agentId/threads', async (c) => {
  const stub = orchestratorStub(c.env, c.req.param('agentId'));
  const body = (await c.req.json().catch(() => ({}))) as { title?: string };
  const result = await stub.createThread(body.title);
  return c.json(result);
});

chat.get('/:agentId/threads/:threadId', async (c) => {
  const stub = orchestratorStub(c.env, c.req.param('agentId'));
  const history = await stub.getThread(c.req.param('threadId'));
  return c.json({ history });
});
