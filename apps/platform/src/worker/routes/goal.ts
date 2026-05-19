import { Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../env';

export const goal = new Hono<{ Bindings: Env; Variables: Variables }>();

// PRD §5 — the internal /goal command. A `goal` is a multi-step user
// request that the orchestrator decomposes and farms out to specialists,
// with optional approval gates. Workflows persist progress so the user can
// close the tab, come back later, and resume.
//
//   POST /api/goal/run          start a new goal run
//   GET  /api/goal/<id>          poll snapshot
//   POST /api/goal/<id>/approve  resume a paused approval gate
//
// The workflow body lives in workflows/goal.ts. Here we just expose the
// HTTP shell so the chat surface (and external integrations) can kick one
// off without needing the Workflow API at the call site.

const RunBody = z.object({
  goal: z.string().min(4),
  agentName: z.string().min(2),
  plan: z
    .array(
      z.object({
        id: z.string(),
        description: z.string(),
        requiresApproval: z.boolean().optional(),
      }),
    )
    .optional(),
});

goal.post('/run', async (c) => {
  const parsed = RunBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const id = `goal-${crypto.randomUUID()}`;
  try {
    if (c.env.GOAL_WORKFLOW) {
      await c.env.GOAL_WORKFLOW.create({
        id,
        params: {
          goal: parsed.data.goal,
          agentId: parsed.data.agentName,
          plan: parsed.data.plan,
        },
      });
    }
  } catch (err) {
    return c.json({ ok: false, error: 'workflow_create_failed', reason: errMsg(err) }, 502);
  }
  // Seed a progress record so a poll immediately after .create sees something.
  await c.env.SETTINGS.put(
    `goal:${id}`,
    JSON.stringify({
      id,
      agentName: parsed.data.agentName,
      goal: parsed.data.goal,
      status: 'queued',
      createdAt: Date.now(),
    }),
    { expirationTtl: 60 * 60 * 24 * 7 },
  );
  return c.json({ ok: true, runId: id });
});

goal.get('/:id', async (c) => {
  const raw = await c.env.SETTINGS.get(`goal:${c.req.param('id')}`);
  if (!raw) return c.json({ ok: false, error: 'not_found' }, 404);
  return c.json({ ok: true, run: JSON.parse(raw) });
});

// Cancel an in-flight goal. Marks the KV snapshot `status: 'cancelled'` so
// the next poll surfaces the terminal state, then writes a sentinel under
// `goal-cancel:<id>` so the workflow body picks it up the next time it
// loops (Workflows can't be cancelled mid-step from a worker; the body
// has to opportunistically check). Returns ok regardless of whether the
// run was already terminal — idempotent cancellation.
goal.post('/:id/cancel', async (c) => {
  const id = c.req.param('id');
  const raw = await c.env.SETTINGS.get(`goal:${id}`);
  if (raw) {
    try {
      const snap = JSON.parse(raw) as {
        status?: string;
        steps?: Array<{ id: string; state?: string }>;
      };
      // Only flip non-terminal run states; preserve `completed` / `error` /
      // `aborted` / already-cancelled if final.
      const terminal = new Set(['completed', 'done', 'error', 'aborted', 'cancelled']);
      if (snap.status && !terminal.has(snap.status)) {
        snap.status = 'cancelled';
        // Mark any in-flight step as error too so the UI doesn't keep
        // its spinner spinning forever. Per-step uses `state` not `status`.
        if (Array.isArray(snap.steps)) {
          snap.steps = snap.steps.map((s) =>
            s.state === 'running' || s.state === 'awaiting_approval'
              ? { ...s, state: 'error' }
              : s,
          );
        }
        await c.env.SETTINGS.put(`goal:${id}`, JSON.stringify(snap), {
          expirationTtl: 60 * 60 * 24 * 7,
        });
      }
    } catch {
      /* malformed snapshot — fall through */
    }
  }
  await c.env.SETTINGS.put(
    `goal-cancel:${id}`,
    JSON.stringify({ at: Date.now() }),
    { expirationTtl: 60 * 60 * 24 },
  );
  return c.json({ ok: true });
});

// Resume (re-run) a previously cancelled / errored / aborted goal.
// We can't restart the original Workflow run — Workflows IDs are
// unique and ended runs are immutable — so we create a brand-new
// run with the original goal text + plan. The new run gets its own
// id; the response carries it so the client can navigate / poll.
// The original snapshot stays where it is so the user can still
// inspect what failed before deciding to retry.
goal.post('/:id/resume', async (c) => {
  const id = c.req.param('id');
  const raw = await c.env.SETTINGS.get(`goal:${id}`);
  if (!raw) return c.json({ ok: false, error: 'not_found' }, 404);
  let snap: {
    agentName?: string;
    goal?: string;
    status?: string;
    plan?: Array<{ id: string; description: string; requiresApproval?: boolean }>;
  };
  try {
    snap = JSON.parse(raw);
  } catch {
    return c.json({ ok: false, error: 'corrupt_snapshot' }, 500);
  }
  // Only resume runs that have actually ended in a non-success state.
  // Successful completions don't need a re-run; in-flight runs need
  // /cancel first.
  const resumable = new Set(['cancelled', 'error', 'aborted']);
  if (!snap.status || !resumable.has(snap.status)) {
    return c.json(
      { ok: false, error: 'not_resumable', currentStatus: snap.status ?? 'unknown' },
      409,
    );
  }
  if (!snap.goal || !snap.agentName) {
    return c.json({ ok: false, error: 'missing_params' }, 422);
  }
  const newId = `goal-${crypto.randomUUID()}`;
  try {
    if (c.env.GOAL_WORKFLOW) {
      await c.env.GOAL_WORKFLOW.create({
        id: newId,
        params: {
          goal: snap.goal,
          agentId: snap.agentName,
          plan: snap.plan,
        },
      });
    }
  } catch (err) {
    return c.json({ ok: false, error: 'workflow_create_failed', reason: errMsg(err) }, 502);
  }
  await c.env.SETTINGS.put(
    `goal:${newId}`,
    JSON.stringify({
      id: newId,
      agentName: snap.agentName,
      goal: snap.goal,
      status: 'queued',
      createdAt: Date.now(),
      resumedFrom: id,
    }),
    { expirationTtl: 60 * 60 * 24 * 7 },
  );
  return c.json({ ok: true, runId: newId, resumedFrom: id });
});

goal.post('/:id/approve', async (c) => {
  // The workflow uses step.waitForEvent to gate consequential steps. To
  // unblock from here, production wires this to Workflow.sendEvent — for v1
  // we just record the approval intent in KV; the workflow body picks it up
  // through its own poll.
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { stepId?: string; approved?: boolean };
  if (!body.stepId) {
    return c.json({ ok: false, error: 'stepId_required' }, 400);
  }
  await c.env.SETTINGS.put(
    `goal-approval:${id}:${body.stepId}`,
    JSON.stringify({ approved: !!body.approved, at: Date.now() }),
    { expirationTtl: 60 * 60 * 24 },
  );
  return c.json({ ok: true });
});

// List recent workflow runs across both kinds (goal + retrain). Walks
// the KV `list` API for `goal:` and `retrain:` prefixes, then loads
// each blob to surface status + age. Capped at 25 each so a long-
// lived agent doesn't make the panel scroll forever — the user can
// open the per-id poll endpoint for older runs.
goal.get('/', async (c) => {
  const out: Array<{
    id: string;
    kind: 'goal' | 'retrain';
    status: string;
    createdAt: number;
    summary?: string;
  }> = [];
  const limit = Math.min(50, Math.max(5, Number(c.req.query('limit') ?? 25)));
  try {
    const list = await c.env.SETTINGS.list({ prefix: 'goal:', limit });
    for (const k of list.keys) {
      const raw = await c.env.SETTINGS.get(k.name);
      if (!raw) continue;
      try {
        const v = JSON.parse(raw) as {
          id: string;
          status?: string;
          createdAt?: number;
          goal?: string;
        };
        out.push({
          id: v.id ?? k.name.slice('goal:'.length),
          kind: 'goal',
          status: v.status ?? 'queued',
          createdAt: v.createdAt ?? 0,
          summary: typeof v.goal === 'string' ? v.goal.slice(0, 120) : undefined,
        });
      } catch {
        /* skip corrupt blob */
      }
    }
  } catch {
    /* KV unavailable */
  }
  try {
    const list = await c.env.SETTINGS.list({ prefix: 'retrain:', limit });
    for (const k of list.keys) {
      const raw = await c.env.SETTINGS.get(k.name);
      if (!raw) continue;
      try {
        const v = JSON.parse(raw) as {
          id?: string;
          status?: string;
          createdAt?: number;
          summary?: string;
        };
        out.push({
          id: v.id ?? k.name.slice('retrain:'.length),
          kind: 'retrain',
          status: v.status ?? 'queued',
          createdAt: v.createdAt ?? 0,
          summary: v.summary,
        });
      } catch {
        /* skip corrupt blob */
      }
    }
  } catch {
    /* KV unavailable */
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return c.json({ ok: true, runs: out });
});

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
