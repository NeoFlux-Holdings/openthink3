import { Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../env';

export const settings = new Hono<{ Bindings: Env; Variables: Variables }>();

// Behavior tab "try this prompt" — runs a single off-thread Workers AI
// turn with the user-provided system prompt + a sample message, so the
// user can sanity-check tone/format before committing the prompt to
// settings. Doesn't write to D1 trajectories, doesn't go through the
// orchestrator DO — pure preview. Capped at the same 3.5s timeout the
// orchestrator uses so verify-suite frame budgets aren't affected.
const PreviewBody = z.object({
  systemPrompt: z.string().min(1).max(8_000),
  message: z.string().min(1).max(2_000),
});

settings.post('/preview', async (c) => {
  const parsed = PreviewBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const { systemPrompt, message } = parsed.data;
  try {
    const result = (await Promise.race([
      c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('ai_timeout')), 3_500),
      ),
    ])) as { response?: string };
    return c.json({ ok: true, reply: result.response ?? '' });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (/ai_timeout/i.test(errMsg)) {
      return c.json({
        ok: true,
        reply:
          "Workers AI didn't respond in time. Try a shorter prompt or check `wrangler dev` logs.",
        timeout: true,
      });
    }
    if (/Invalid access token|Not logged in|9109/i.test(errMsg)) {
      return c.json({
        ok: true,
        reply:
          'Workers AI is reachable but your local wrangler OAuth token has expired. Run `wrangler login` and try again.',
        authExpired: true,
      });
    }
    return c.json(
      { ok: false, error: 'ai_unreachable', detail: errMsg },
      502,
    );
  }
});

settings.get('/:agentId', async (c) => {
  const raw = await c.env.SETTINGS.get(`settings:${c.req.param('agentId')}`);
  return c.json(raw ? JSON.parse(raw) : null);
});

settings.put('/:agentId', async (c) => {
  // Merge into existing settings rather than replacing. The Settings UI
  // PUTs in chunks (Automation sends just `{ approvalMode }`, Behavior
  // sends the behavior block, Knowledge writes through a separate route)
  // so a full replace would clobber whichever block wasn't included in
  // the latest call. The shallow merge preserves every other key.
  const patch = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const key = `settings:${c.req.param('agentId')}`;
  let existing: Record<string, unknown> = {};
  try {
    const raw = await c.env.SETTINGS.get(key);
    if (raw) existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* corrupt blob — replace */
  }
  const merged = { ...existing, ...patch };
  await c.env.SETTINGS.put(key, JSON.stringify(merged));
  return c.json({ ok: true });
});

// Tear-down endpoint for a single agent. Wipes:
//   * D1 rows in every agent_id-scoped table (memories, skills,
//     audit_log, trajectories, pending_suggestions, knowledge if
//     present)
//   * KV blobs in agent-scoped namespaces:
//       settings:<id>, access:<id>, knowledge:<id>, provision:<id>,
//       and goal:<*>/retrain:<*> entries whose agentName matches
//   * R2 objects under artifacts/<id>/
// Does NOT touch Cloudflare-level resources (the Worker itself, the
// DO classes, the user's account) — those stay the user's call via
// wrangler. Returns a per-stage tally so the UI can confirm what
// actually got deleted.
settings.delete('/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  if (!agentId || agentId.length > 80) {
    return c.json({ ok: false, error: 'invalid_agent_id' }, 400);
  }
  // Explicit shape so the post-increment access compiles cleanly
  // (Record<string, number> would make every read `| undefined`).
  const removed: {
    settings: number;
    access: number;
    knowledge: number;
    memories: number;
    skills: number;
    audit: number;
    trajectories: number;
    pending: number;
    workflows: number;
    artifacts: number;
  } = {
    settings: 0,
    access: 0,
    knowledge: 0,
    memories: 0,
    skills: 0,
    audit: 0,
    trajectories: 0,
    pending: 0,
    workflows: 0,
    artifacts: 0,
  };

  // 1. D1 rows. Each table guarded — schemas may legitimately not
  // exist in fresh installs, and a missing table shouldn't abort
  // the rest of the wipe.
  const d1Tables = [
    { table: 'memories', col: 'agent_id', key: 'memories' as const },
    { table: 'skills', col: 'agent_id', key: 'skills' as const },
    { table: 'audit_log', col: 'agent_id', key: 'audit' as const },
    { table: 'trajectories', col: 'agent_id', key: 'trajectories' as const },
    { table: 'pending_suggestions', col: 'agent_id', key: 'pending' as const },
  ];
  for (const { table, col, key } of d1Tables) {
    try {
      const result = await c.env.DB.prepare(
        `DELETE FROM ${table} WHERE ${col} = ?`,
      )
        .bind(agentId)
        .run();
      removed[key] =
        (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
    } catch {
      /* table missing or schema mismatch — skip */
    }
  }

  // 2. KV — direct keys + list-by-prefix for the workflow runs that
  // tagged this agent. Each delete is fire-and-forget; we don't want
  // a single key failure to abort the whole tear-down.
  const directKeys = [
    `settings:${agentId}`,
    `access:${agentId}`,
    `knowledge:${agentId}`,
    `provision:${agentId}`,
    `sync:${agentId}:local-sha`,
    `sync:${agentId}:status-cache`,
  ];
  for (const k of directKeys) {
    try {
      const raw = await c.env.SETTINGS.get(k);
      if (raw !== null) {
        await c.env.SETTINGS.delete(k);
        if (k.startsWith('settings:')) removed.settings += 1;
        else if (k.startsWith('access:')) removed.access += 1;
        else if (k.startsWith('knowledge:')) removed.knowledge += 1;
      }
    } catch {
      /* key gone or KV unavailable */
    }
  }
  // Workflow runs (goal:* + retrain:*) — list with cap then delete
  // the ones whose stored agentName matches.
  for (const prefix of ['goal:', 'retrain:'] as const) {
    try {
      const list = await c.env.SETTINGS.list({ prefix, limit: 200 });
      for (const k of list.keys) {
        const raw = await c.env.SETTINGS.get(k.name);
        if (!raw) continue;
        try {
          const v = JSON.parse(raw) as { agentName?: string; agentId?: string };
          if (v.agentName === agentId || v.agentId === agentId) {
            await c.env.SETTINGS.delete(k.name);
            removed.workflows += 1;
          }
        } catch {
          /* skip corrupt blob */
        }
      }
    } catch {
      /* prefix list failed */
    }
  }

  // 3. R2 — drop every object under artifacts/<id>/. The R2 list
  // API caps at 1000 keys per page so we paginate via the cursor.
  try {
    let cursor: string | undefined;
    do {
      const listed = await c.env.ARTIFACTS.list({
        prefix: `artifacts/${agentId}/`,
        cursor,
        limit: 1000,
      });
      if (listed.objects.length === 0) break;
      await Promise.all(
        listed.objects.map((o) => c.env.ARTIFACTS.delete(o.key).catch(() => undefined)),
      );
      removed.artifacts += listed.objects.length;
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  } catch {
    /* R2 unavailable; tally stays at 0 */
  }

  // 4. Write a final danger audit row under the `__system__`
  // agent_id so the user has a record even after every other row
  // tagged with this agent's id got wiped. Best-effort — a missing
  // audit_log table is fine.
  try {
    await c.env.DB.prepare(
      `INSERT INTO audit_log (id, agent_id, kind, payload, created_at) VALUES (?, ?, 'danger', ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        '__system__',
        JSON.stringify({ action: 'agent_deleted', agentId, removed }),
        Date.now(),
      )
      .run();
  } catch {
    /* audit unavailable; the per-stage tally in the response is still authoritative */
  }
  return c.json({ ok: true, agentId, removed });
});
