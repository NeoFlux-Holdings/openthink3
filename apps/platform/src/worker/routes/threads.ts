import { Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../env';
import type { ChatMessage } from '../../shared/types';

export const threads = new Hono<{ Bindings: Env; Variables: Variables }>();

// PRD §9 — the command palette needs a real source-of-truth for the thread
// list, not the seed dataset baked into the SPA. Each Orchestrator DO holds
// its own thread/message history in DO SQLite; this route asks the DO over
// fetch (which works without an explicit RPC contract because the DO's
// `handleRpc` path mirrors what we use for the specialist agents).

interface OrchestratorRpc {
  listThreads(
    limit?: number,
    opts?: { archived?: boolean },
  ): Promise<Array<{ id: string; title: string; updatedAt: number; pinned?: boolean }>>;
  renameThread(threadId: string, title: string): Promise<{ ok: boolean }>;
  archiveThread(threadId: string, archived: boolean): Promise<{ ok: boolean }>;
  pinThread(threadId: string, pinned: boolean): Promise<{ ok: boolean }>;
  getWorkingDoc(threadId: string): Promise<{ body: string; updatedAt: number | null }>;
  setWorkingDoc(threadId: string, body: string): Promise<{ ok: boolean }>;
  getThreadHead(
    threadId: string,
    tail?: number,
  ): Promise<{
    thread: { id: string; title: string; updatedAt: number } | null;
    messages: ChatMessage[];
  }>;
}

function orchestratorStub(env: Env, agentId: string): OrchestratorRpc {
  const id = env.ORCHESTRATOR.idFromName(agentId);
  return env.ORCHESTRATOR.get(id) as unknown as OrchestratorRpc;
}

threads.get('/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? '25')));
  const archived = c.req.query('archived') === '1';

  try {
    const list = await orchestratorStub(c.env, agentId).listThreads(limit, { archived });
    return c.json({ threads: list, source: 'do' });
  } catch (err) {
    console.warn('[threads] DO call failed, returning stub', err);
    const now = Date.now();
    return c.json({
      threads: [
        { id: 'welcome', title: 'Welcome', updatedAt: now },
        { id: 'morning-inbox', title: 'Morning inbox triage', updatedAt: now - 60 * 60_000 },
        { id: 'prd-review', title: 'PRD review', updatedAt: now - 4 * 60 * 60_000 },
      ],
      source: 'stub',
    });
  }
});

threads.get('/:agentId/:threadId', async (c) => {
  const agentId = c.req.param('agentId');
  const threadId = c.req.param('threadId');
  const tail = Math.min(200, Math.max(1, Number(c.req.query('tail') ?? '50')));
  try {
    const head = await orchestratorStub(c.env, agentId).getThreadHead(threadId, tail);
    if (!head.thread) return c.json({ ok: false, error: 'not_found' }, 404);
    return c.json({ ok: true, thread: head.thread, messages: head.messages, source: 'do' });
  } catch (err) {
    return c.json({ ok: false, error: 'do_failed', reason: errMsg(err) }, 502);
  }
});

const RenameBody = z.object({ title: z.string().min(1).max(80) });

threads.post('/:agentId/:threadId/title', async (c) => {
  const parsed = RenameBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const agentId = c.req.param('agentId');
  const threadId = c.req.param('threadId');
  try {
    const result = await orchestratorStub(c.env, agentId).renameThread(threadId, parsed.data.title);
    return c.json(result);
  } catch (err) {
    return c.json({ ok: false, error: 'do_failed', reason: errMsg(err) }, 502);
  }
});

threads.get('/:agentId/:threadId/working-doc', async (c) => {
  const agentId = c.req.param('agentId');
  const threadId = c.req.param('threadId');
  try {
    const result = await orchestratorStub(c.env, agentId).getWorkingDoc(threadId);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return c.json({ ok: false, error: 'do_failed', reason: errMsg(err) }, 502);
  }
});

const WorkingDocBody = z.object({ body: z.string().max(8_000) });

threads.post('/:agentId/:threadId/working-doc', async (c) => {
  const parsed = WorkingDocBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const agentId = c.req.param('agentId');
  const threadId = c.req.param('threadId');
  try {
    const result = await orchestratorStub(c.env, agentId).setWorkingDoc(threadId, parsed.data.body);
    return c.json(result);
  } catch (err) {
    return c.json({ ok: false, error: 'do_failed', reason: errMsg(err) }, 502);
  }
});

const PinBody = z.object({ pinned: z.boolean() });

threads.post('/:agentId/:threadId/pin', async (c) => {
  const parsed = PinBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const agentId = c.req.param('agentId');
  const threadId = c.req.param('threadId');
  try {
    const result = await orchestratorStub(c.env, agentId).pinThread(
      threadId,
      parsed.data.pinned,
    );
    return c.json(result);
  } catch (err) {
    return c.json({ ok: false, error: 'do_failed', reason: errMsg(err) }, 502);
  }
});

const ArchiveBody = z.object({ archived: z.boolean() });

threads.post('/:agentId/:threadId/archive', async (c) => {
  const parsed = ArchiveBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const agentId = c.req.param('agentId');
  const threadId = c.req.param('threadId');
  try {
    const result = await orchestratorStub(c.env, agentId).archiveThread(
      threadId,
      parsed.data.archived,
    );
    return c.json(result);
  } catch (err) {
    return c.json({ ok: false, error: 'do_failed', reason: errMsg(err) }, 502);
  }
});

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
