import { Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../env';

export const learning = new Hono<{ Bindings: Env; Variables: Variables }>();

// PRD §6 — Learning page surfaces accumulated knowledge and the pending
// suggestions queue the retraining Workflow drops onto. Routes:
//
//   GET  /api/learning/summary    counters for the dashboard tiles
//   GET  /api/learning/pending    raw rows from `pending_suggestions`
//   POST /api/learning/pending/:id/accept  apply the suggestion (forward to
//                                           MemoryAgent or skills registry)
//   POST /api/learning/pending/:id/dismiss reject and mark rejected
//
// The accept flow dispatches by `kind`:
//   memory  →  MemoryAgent.ingest({category, content, importance})
//   skill   →  flips `skills.enabled = 1` (or creates the row when new)
//   rubric  →  no-op for v1 — Judge rubric weights are still fixed.

learning.get('/summary', async (c) => {
  // Production: aggregate from D1. The orchestrator's per-agent DO holds
  // hotter state but this is the global counter.
  try {
    const skills = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS pinned FROM skills`,
    ).first<{ total: number; pinned: number }>();
    const memCount = await c.env.DB.prepare(
      `SELECT category, COUNT(*) AS n FROM memories WHERE importance > 0 GROUP BY category`,
    ).all<{ category: string; n: number }>();
    const pending = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pending_suggestions WHERE status = 'pending'`,
    ).first<{ n: number }>();

    const byCategory: Record<string, number> = {
      user_facts: 0,
      active_work: 0,
      preferences: 0,
      domain_knowledge: 0,
      people: 0,
    };
    let total = 0;
    for (const row of memCount.results ?? []) {
      byCategory[row.category] = row.n;
      total += row.n;
    }
    return c.json({
      skills: { total: skills?.total ?? 0, pinned: skills?.pinned ?? 0 },
      memories: { total, byCategory },
      rubrics: { total: 1, defaultId: 'default' },
      pending: { count: pending?.n ?? 0 },
      source: 'd1',
    });
  } catch (err) {
    console.warn('[learning] summary fallback', err);
    return c.json({
      skills: { total: 4, pinned: 2 },
      memories: { total: 0, byCategory: { user_facts: 0, active_work: 0, preferences: 0, domain_knowledge: 0, people: 0 } },
      rubrics: { total: 1, defaultId: 'default' },
      pending: { count: 0 },
      source: 'stub',
    });
  }
});

learning.get('/pending', async (c) => {
  try {
    const rows = await c.env.DB.prepare(
      `SELECT id, agent_id, kind, trajectory_turn_id, payload, status, created_at
       FROM pending_suggestions
       WHERE status = 'pending'
       ORDER BY created_at DESC
       LIMIT 50`,
    ).all<{
      id: string;
      agent_id: string;
      kind: 'memory' | 'skill' | 'rubric';
      trajectory_turn_id: string | null;
      payload: string;
      status: string;
      created_at: number;
    }>();
    return c.json({
      pending: (rows.results ?? []).map((r) => {
        let payload: unknown = {};
        try {
          payload = JSON.parse(r.payload);
        } catch {
          /* swallow */
        }
        return {
          id: r.id,
          agentId: r.agent_id,
          kind: r.kind,
          turnId: r.trajectory_turn_id,
          payload,
          createdAt: r.created_at,
        };
      }),
      source: 'd1',
    });
  } catch (err) {
    console.warn('[learning] pending fallback', err);
    return c.json({ pending: [], source: 'stub' });
  }
});

// Memories — pulled from D1 for the Learning page's editable list. The
// importance > 0 filter excludes soft-deleted rows (MemoryAgent zeroes
// importance on remove). Returns up to 50 most recently updated.
// Sanitize + normalize a tag string. Mirrors the knowledge route's
// sanitizer so a tag set on one tab survives a round-trip via the
// shared bulk-import shape.
function sanitizeMemoryTag(raw: string): string | null {
  const t = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return t || null;
}

function sanitizeMemoryTagList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const t = sanitizeMemoryTag(typeof raw === 'string' ? raw : String(raw));
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

// Decode the `tags` cell (stored as JSON string or NULL) into a string
// array. Defensive against malformed values so a corrupt row doesn't
// blow up the entire memory list.
function decodeTagsCell(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const cleaned = sanitizeMemoryTagList(parsed);
    return cleaned.length > 0 ? cleaned : undefined;
  } catch {
    return undefined;
  }
}

learning.get('/memories', async (c) => {
  try {
    const rows = await c.env.DB.prepare(
      `SELECT id, category, content, importance, when_to_use, tags, created_at, updated_at
       FROM memories
       WHERE importance > 0
       ORDER BY updated_at DESC
       LIMIT 50`,
    ).all<{
      id: string;
      category: string;
      content: string;
      importance: number;
      when_to_use: string | null;
      tags: string | null;
      created_at: number;
      updated_at: number;
    }>();
    return c.json({
      memories: (rows.results ?? []).map((r) => {
        const tags = decodeTagsCell(r.tags);
        return {
          id: r.id,
          category: r.category,
          content: r.content,
          importance: r.importance,
          whenToUse: r.when_to_use ?? null,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          ...(tags ? { tags } : {}),
        };
      }),
      source: 'd1',
    });
  } catch {
    return c.json({ memories: [], source: 'stub' });
  }
});

const MemoryPatch = z.object({
  content: z.string().min(1).max(2_000).optional(),
  whenToUse: z.string().max(500).nullable().optional(),
  importance: z.number().int().min(0).max(10).optional(),
});

learning.put('/memories/:id', async (c) => {
  const parsed = MemoryPatch.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const id = c.req.param('id');
  const patch = parsed.data;
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (patch.content !== undefined) {
    sets.push('content = ?');
    binds.push(patch.content);
  }
  if (patch.whenToUse !== undefined) {
    sets.push('when_to_use = ?');
    binds.push(patch.whenToUse);
  }
  if (patch.importance !== undefined) {
    sets.push('importance = ?');
    binds.push(patch.importance);
  }
  if (sets.length === 0) {
    return c.json({ ok: false, error: 'no_changes' }, 400);
  }
  sets.push('updated_at = ?');
  binds.push(Date.now());
  binds.push(id);
  try {
    await c.env.DB.prepare(
      `UPDATE memories SET ${sets.join(', ')} WHERE id = ?`,
    )
      .bind(...binds)
      .run();
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: 'd1_write_failed', reason: errMsg(err) }, 500);
  }
});

// PUT /memories/:id/tags — full-replace the tag list for a memory.
// Accepts `{ tags: string[] }`; runs each through `sanitizeMemoryTag`
// so the canonical form survives a paste with spaces/punctuation.
// Stored as a JSON-encoded string in the `tags` cell (NULL when the
// list is empty so SELECTs can short-circuit).
const TagsPatchBody = z.object({
  tags: z.array(z.string().max(48)).max(12),
});

learning.put('/memories/:id/tags', async (c) => {
  const parsed = TagsPatchBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const id = c.req.param('id');
  const cleaned = sanitizeMemoryTagList(parsed.data.tags);
  const cell = cleaned.length > 0 ? JSON.stringify(cleaned) : null;
  try {
    const result = await c.env.DB.prepare(
      `UPDATE memories SET tags = ?, updated_at = ? WHERE id = ? AND importance > 0`,
    )
      .bind(cell, Date.now(), id)
      .run();
    // `result.meta.changes` is 0 when the id missed (soft-deleted or
    // typo). Return 404 so the client can show a nicer error than
    // "Tag save failed" — useful when investigating phantom state.
    const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;
    if (changes === 0) {
      return c.json({ ok: false, error: 'not_found' }, 404);
    }
    return c.json({ ok: true, tags: cleaned });
  } catch (err) {
    return c.json({ ok: false, error: 'd1_write_failed', reason: errMsg(err) }, 500);
  }
});

// Soft-delete — zero importance instead of dropping the row, mirroring
// MemoryAgent.remove. Vector index stays intact in case we want to undo
// in a future iteration.
learning.delete('/memories/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await c.env.DB.prepare(
      `UPDATE memories SET importance = 0, updated_at = ? WHERE id = ?`,
    )
      .bind(Date.now(), id)
      .run();
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: 'd1_write_failed', reason: errMsg(err) }, 500);
  }
});

// Bulk-restore memories from a snapshot. Accepts the export shape
// `{ memories: [{category, content, importance?, whenToUse?, ...}] }`
// directly OR a bare array. Skips entries whose (category, content)
// pair already exists for this agent so re-importing the same snapshot
// is idempotent. Returns counts: { added, skipped, invalid }.
//
// Doesn't touch the vector index — re-embedding 100+ rows during an
// import would burn the spend cap. The orchestrator's discover-by-
// default loop re-embeds on first read.
const BulkMemoryItem = z.object({
  category: z.string().min(1).max(60),
  content: z.string().min(1).max(2_000),
  importance: z.number().int().min(0).max(10).optional(),
  whenToUse: z.string().max(500).nullable().optional(),
  tags: z.array(z.string().max(48)).max(12).optional(),
  createdAt: z.number().optional(),
});
const BulkMemoryBody = z.union([
  z.object({ memories: z.array(BulkMemoryItem).max(500) }),
  z.array(BulkMemoryItem).max(500),
]);

learning.post('/memories/bulk', async (c) => {
  const parsed = BulkMemoryBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const items = Array.isArray(parsed.data) ? parsed.data : parsed.data.memories;
  if (items.length === 0) {
    return c.json({ ok: true, added: 0, skipped: 0, invalid: 0 });
  }
  // Pull the existing (category, content) set in one query so the
  // per-row insert loop doesn't need a roundtrip per dedupe check.
  let existing = new Set<string>();
  try {
    const rows = await c.env.DB.prepare(
      `SELECT category, content FROM memories WHERE importance > 0 LIMIT 2000`,
    ).all<{ category: string; content: string }>();
    existing = new Set(
      (rows.results ?? []).map((r) => `${r.category}:::${r.content}`),
    );
  } catch {
    /* table missing → existing stays empty; all inserts go through */
  }
  let added = 0;
  let skipped = 0;
  const now = Date.now();
  for (const m of items) {
    const dedupKey = `${m.category}:::${m.content}`;
    if (existing.has(dedupKey)) {
      skipped += 1;
      continue;
    }
    existing.add(dedupKey);
    const id = crypto.randomUUID();
    const importance = m.importance ?? 1;
    const createdAt = m.createdAt ?? now;
    const tagsClean = sanitizeMemoryTagList(m.tags ?? []);
    const tagsCell = tagsClean.length > 0 ? JSON.stringify(tagsClean) : null;
    try {
      await c.env.DB.prepare(
        `INSERT INTO memories (id, category, content, importance, when_to_use, tags, vectorize_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
        .bind(id, m.category, m.content, importance, m.whenToUse ?? null, tagsCell, createdAt, now)
        .run();
      added += 1;
    } catch {
      skipped += 1;
    }
  }
  // Record the restore in the audit trail so the user can see when
  // a bulk import landed + how much it brought in.
  if (added > 0) {
    try {
      await c.env.DB.prepare(
        `INSERT INTO audit_log (id, agent_id, kind, payload, created_at) VALUES (?, ?, 'danger', ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          '__system__',
          JSON.stringify({ action: 'memories_bulk_restore', added, skipped }),
          Date.now(),
        )
        .run();
    } catch {
      /* audit table missing — non-fatal */
    }
  }
  return c.json({
    ok: true,
    added,
    skipped,
    invalid: items.length - added - skipped,
  });
});

// Soft-reset every memory at once. Same importance=0 strategy the
// per-row delete uses so the vector index stays intact (the Memory
// Agent's recall path filters on importance>0) and a future iteration
// could restore. Returns the count of rows touched.
// Soft-clear every memory in a specific category. Same importance=0
// strategy as the global reset — the row stays in D1 + vectorize for
// future restore but is filtered out of recall. Audit row labels the
// category so the danger trail is specific. Returns the count of rows
// touched.
const ClearByCategoryBody = z.object({
  category: z.string().min(1).max(60),
});

learning.post('/memories/clear-category', async (c) => {
  const parsed = ClearByCategoryBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const category = parsed.data.category;
  try {
    const now = Date.now();
    const result = await c.env.DB.prepare(
      `UPDATE memories SET importance = 0, updated_at = ?
       WHERE importance > 0 AND category = ?`,
    )
      .bind(now, category)
      .run();
    const cleared =
      (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (cleared > 0) {
      try {
        await c.env.DB.prepare(
          `INSERT INTO audit_log (id, agent_id, kind, payload, created_at) VALUES (?, ?, 'danger', ?, ?)`,
        )
          .bind(
            crypto.randomUUID(),
            '__system__',
            JSON.stringify({
              action: 'memories_clear_category',
              category,
              cleared,
            }),
            now,
          )
          .run();
      } catch {
        /* audit_log table missing — non-fatal */
      }
    }
    return c.json({ ok: true, cleared, category });
  } catch (err) {
    return c.json({ ok: false, error: 'd1_write_failed', reason: errMsg(err) }, 500);
  }
});

learning.post('/memories/reset', async (c) => {
  try {
    const now = Date.now();
    const result = await c.env.DB.prepare(
      `UPDATE memories SET importance = 0, updated_at = ? WHERE importance > 0`,
    )
      .bind(now)
      .run();
    // D1 returns `meta.changes` for the number of mutated rows.
    const reset =
      (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
    // Drop a `danger` audit row so the user has a paper trail of
    // when memories were wiped (the soft-reset is reversible in
    // principle but only if someone notices it happened). Agent id
    // is best-effort — we don't have it from the route param here
    // since the reset is global, so we tag '__system__'. A future
    // iteration could pass agentName via query/body.
    try {
      await c.env.DB.prepare(
        `INSERT INTO audit_log (id, agent_id, kind, payload, created_at) VALUES (?, ?, 'danger', ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          '__system__',
          JSON.stringify({ action: 'memories_reset', reset }),
          now,
        )
        .run();
    } catch {
      /* audit_log table missing — non-fatal */
    }
    return c.json({ ok: true, reset });
  } catch (err) {
    return c.json({ ok: false, error: 'd1_write_failed', reason: errMsg(err) }, 500);
  }
});

const AcceptBody = z.object({
  agentName: z.string().optional(),
});

learning.post('/pending/:id/accept', async (c) => {
  const id = c.req.param('id');
  const parsed = AcceptBody.safeParse(await c.req.json().catch(() => ({})));
  const agentForRouting = parsed.success ? parsed.data.agentName : undefined;

  let row: {
    id: string;
    agent_id: string;
    kind: string;
    payload: string;
  } | null = null;
  try {
    row = await c.env.DB.prepare(
      `SELECT id, agent_id, kind, payload FROM pending_suggestions WHERE id = ?`,
    )
      .bind(id)
      .first<{ id: string; agent_id: string; kind: string; payload: string }>();
  } catch (err) {
    return c.json({ ok: false, error: 'd1_read_failed', reason: errMsg(err) }, 500);
  }
  if (!row) return c.json({ ok: false, error: 'not_found' }, 404);

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload);
  } catch {
    /* fall through with empty payload */
  }

  // Dispatch by suggestion kind.
  let applied: { ok: boolean; result?: unknown; error?: string } = { ok: false };
  if (row.kind === 'memory') {
    try {
      const targetAgent = agentForRouting ?? row.agent_id;
      const doId = c.env.MEMORY_AGENT.idFromName(targetAgent);
      const stub = c.env.MEMORY_AGENT.get(doId);
      const req = new Request('https://do/internal', {
        method: 'POST',
        body: JSON.stringify({
          method: 'ingest',
          args: {
            category: (payload.category as string) ?? 'domain_knowledge',
            content: (payload.content as string) ?? '',
            importance: (payload.importance as number) ?? 5,
            whenToUse: (payload.whenToUse as string) ?? '',
          },
        }),
      });
      const res = await stub.fetch(req);
      applied = (await res.json()) as { ok: boolean; result?: unknown; error?: string };
    } catch (err) {
      applied = { ok: false, error: errMsg(err) };
    }
  } else if (row.kind === 'skill') {
    try {
      await c.env.DB.prepare(
        `UPDATE skills SET enabled = 1, updated_at = ? WHERE id = ?`,
      )
        .bind(Date.now(), (payload.skillId as string) ?? id)
        .run();
      applied = { ok: true };
    } catch (err) {
      applied = { ok: false, error: errMsg(err) };
    }
  } else if (row.kind === 'rubric') {
    // No-op until we make rubric weights tunable.
    applied = { ok: true };
  } else {
    applied = { ok: false, error: `unknown_kind:${row.kind}` };
  }

  if (applied.ok) {
    try {
      await c.env.DB.prepare(
        `UPDATE pending_suggestions SET status = 'accepted' WHERE id = ?`,
      )
        .bind(id)
        .run();
    } catch {
      /* still report applied */
    }
  }
  return c.json({ ok: applied.ok, applied, kind: row.kind });
});

learning.post('/pending/:id/dismiss', async (c) => {
  const id = c.req.param('id');
  try {
    await c.env.DB.prepare(
      `UPDATE pending_suggestions SET status = 'rejected' WHERE id = ?`,
    )
      .bind(id)
      .run();
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: 'd1_failed', reason: errMsg(err) }, 500);
  }
});

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
