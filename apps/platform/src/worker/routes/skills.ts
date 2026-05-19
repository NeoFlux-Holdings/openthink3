import { Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../env';
import type { Skill } from '../../shared/types';
import { proposePr } from './sync';
import { compileSkillJsx, renderPlanAsJsx } from '../../shared/smithers';

export const skills = new Hono<{ Bindings: Env; Variables: Variables }>();

// Iteration 1 ships a static catalog of skill stubs so the UI Settings → Skills
// page can render real cards. The live registry (D1 + Vectorize) lands in iteration 6.

const SKILL_CATALOG: Skill[] = [
  {
    id: 'cloudflare-workers',
    name: 'cloudflare-workers',
    description: 'Build and deploy Cloudflare Workers.',
    source: 'cloudflare',
    version: '1.0.0',
    enabled: true,
    whenToUse: 'User mentions Workers, wrangler, edge deployment.',
    tags: ['cloudflare', 'workers'],
    hasWorkflow: false,
  },
  {
    id: 'agents-sdk',
    name: 'agents-sdk',
    description: 'Use the Cloudflare Agents SDK.',
    source: 'cloudflare',
    version: '1.0.0',
    enabled: true,
    whenToUse: 'User mentions Durable Objects, AIChatAgent, McpAgent.',
    tags: ['cloudflare', 'agents'],
    hasWorkflow: false,
  },
  {
    id: 'skill-creator',
    name: 'skill-creator',
    description: 'Create new agent skills.',
    source: 'anthropic',
    version: '1.0.0',
    enabled: false,
    whenToUse: 'User asks to create or edit a skill.',
    tags: ['meta'],
    hasWorkflow: false,
  },
  {
    id: 'frontend-design',
    name: 'frontend-design',
    description: 'Master-level UI/UX implementation.',
    source: 'anthropic',
    version: '1.0.0',
    enabled: false,
    whenToUse: 'User asks for polished UI, interactive flows, or design polish.',
    tags: ['frontend', 'design'],
    hasWorkflow: false,
  },
];

// User-curated skill ordering. Stored as a JSON array of skill IDs in
// KV; any skill in this list bubbles to the top in the order given, and
// the rest follow in their original catalog/D1 order. Lets users pin
// "agents-sdk" above "cloudflare-workers" if that's their workflow.
const SKILL_ORDER_KEY = 'skills:order';

async function readOrder(env: Env): Promise<string[]> {
  try {
    const raw = await env.SETTINGS.get(SKILL_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

skills.get('/', async (c) => {
  // Merge in any locally-authored skills the user has saved via the Train
  // mode "save as skill" flow. They live in D1 + R2 (SKILL.md body) so they
  // survive Worker restarts and can be PR'd back upstream.
  let local: Skill[] = [];
  try {
    const rows = await c.env.DB.prepare(
      `SELECT id, name, source, version, description, when_to_use, tags, enabled,
              has_workflow, r2_skill_md, last_used_at, updated_at
       FROM skills WHERE source = 'local' ORDER BY updated_at DESC LIMIT 100`,
    ).all<{
      id: string;
      name: string;
      source: string;
      version: string;
      description: string | null;
      when_to_use: string | null;
      tags: string | null;
      enabled: number;
      has_workflow: number;
      r2_skill_md: string | null;
      last_used_at: number | null;
      updated_at: number;
    }>();
    local = (rows.results ?? []).map((r): Skill => ({
      id: r.id,
      name: r.name,
      source: 'local',
      version: r.version,
      description: r.description ?? '',
      whenToUse: r.when_to_use ?? '',
      tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
      enabled: r.enabled === 1,
      hasWorkflow: r.has_workflow === 1,
      lastUsed: r.last_used_at ?? undefined,
    }));
  } catch {
    /* table missing — just return the catalog */
  }
  const all = [...SKILL_CATALOG, ...local];
  const order = await readOrder(c.env);
  if (order.length > 0) {
    // Stable-sort by `priority position`: priorityIndex for ranked
    // skills, +Infinity for everything else. ECMAScript Array.sort is
    // stable as of ES2019 so ties (everything-else) preserve their
    // original catalog/D1 order.
    const priority = new Map<string, number>();
    order.forEach((id, i) => priority.set(id, i));
    all.sort((a, b) => {
      const pa = priority.has(a.id) ? priority.get(a.id)! : Number.POSITIVE_INFINITY;
      const pb = priority.has(b.id) ? priority.get(b.id)! : Number.POSITIVE_INFINITY;
      return pa - pb;
    });
  }
  return c.json({ skills: all, order });
});

// GET `/api/skills/:id/body` — read the raw SKILL.md body for a
// local skill so the user can fork it in the authoring panel. For
// catalog skills (where the body lives in the bundled package) we
// don't expose this — those skills are read-only by design. Returns
// 404 when the id isn't a saved local skill.
skills.get('/:id/body', async (c) => {
  const id = c.req.param('id');
  if (!id || id.length > 200) {
    return c.json({ ok: false, error: 'invalid_id' }, 400);
  }
  try {
    const row = await c.env.DB.prepare(
      `SELECT r2_skill_md, name FROM skills WHERE id = ? AND source = 'local'`,
    )
      .bind(id)
      .first<{ r2_skill_md: string | null; name: string }>();
    if (!row) {
      return c.json({ ok: false, error: 'not_found' }, 404);
    }
    if (!row.r2_skill_md) {
      return c.json({ ok: false, error: 'no_blob' }, 404);
    }
    const obj = await c.env.ARTIFACTS.get(row.r2_skill_md);
    if (!obj) {
      return c.json({ ok: false, error: 'r2_missing' }, 404);
    }
    const body = await obj.text();
    return c.json({ ok: true, id, name: row.name, body });
  } catch (err) {
    return c.json(
      { ok: false, error: 'd1_failed', reason: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

// PUT `/api/skills/order` — body: { ids: string[] }. Persists the
// user's preferred ordering. IDs not present in the catalog are kept
// (they may be local skills the catalog doesn't know about), but the
// list is capped at 200 entries so a misbehaving client can't blow up
// the KV value.
skills.put('/order', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { ids?: unknown } | null;
  const raw = Array.isArray(body?.ids) ? (body!.ids as unknown[]) : [];
  const ids = raw
    .filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length < 200)
    .slice(0, 200);
  await c.env.SETTINGS.put(SKILL_ORDER_KEY, JSON.stringify(ids));
  return c.json({ ok: true, count: ids.length });
});

// Uninstall every skill from a given source/pack. Disables catalog
// entries in-memory and deletes local D1 rows + R2 blobs. Returns the
// count actually removed so the UI can confirm. Idempotent — calling
// twice on an already-uninstalled pack is a no-op.
skills.post('/pack/:source/uninstall', async (c) => {
  const source = c.req.param('source');
  if (!source || source.length > 40) {
    return c.json({ ok: false, error: 'invalid_source' }, 400);
  }
  let removed = 0;
  // Disable catalog entries (they're in-memory; toggle to off rather
  // than delete since the catalog list is a static module export).
  for (const s of SKILL_CATALOG) {
    if (s.source === source && s.enabled) {
      s.enabled = false;
      removed += 1;
    }
  }
  // Drop local skills with this source from D1 + R2.
  try {
    const rows = await c.env.DB.prepare(
      `SELECT id, r2_key FROM skills WHERE source = ?`,
    )
      .bind(source)
      .all<{ id: string; r2_key: string }>();
    const localRows = rows.results ?? [];
    if (localRows.length > 0) {
      await Promise.all(
        localRows.map((r) =>
          r.r2_key ? c.env.ARTIFACTS.delete(r.r2_key).catch(() => undefined) : undefined,
        ),
      );
      await c.env.DB.prepare(`DELETE FROM skills WHERE source = ?`)
        .bind(source)
        .run();
      removed += localRows.length;
    }
  } catch {
    /* D1 missing or schema mismatch — catalog-only uninstall still applies */
  }
  return c.json({ ok: true, source, removed });
});

// Test-match a skill against a sample message. Returns whether the
// orchestrator's keyword heuristic would activate the skill on this
// turn + a 0–1 score + the keywords that matched. Useful for users
// authoring or tuning `whenToUse` descriptions without burning a real
// chat turn. Pure-local: no AI call, no D1 write, no audit row.
skills.post('/:id/match', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => null)) as
    | { message?: string }
    | null;
  const message = typeof body?.message === 'string' ? body.message : '';
  if (!message.trim()) {
    return c.json({ ok: false, error: 'empty_message' }, 400);
  }
  // Find the skill in either the static catalog OR D1 local rows.
  let skill: { id: string; name: string; description: string; whenToUse: string | null } | null =
    SKILL_CATALOG.find((s) => s.id === id) ?? null;
  if (!skill) {
    try {
      const row = await c.env.DB.prepare(
        `SELECT id, name, description, when_to_use AS whenToUse FROM skills WHERE id = ?`,
      )
        .bind(id)
        .first<{ id: string; name: string; description: string; whenToUse: string | null }>();
      if (row) skill = row;
    } catch {
      /* D1 absent — return not_found below */
    }
  }
  if (!skill) {
    return c.json({ ok: false, error: 'not_found' }, 404);
  }
  // Token-set Jaccard between the message and the skill's
  // description + when_to_use. Same threshold-style heuristic the
  // orchestrator uses for discover-by-default matching.
  const stop = new Set([
    'a', 'an', 'and', 'the', 'to', 'of', 'in', 'on', 'at', 'is',
    'are', 'for', 'with', 'as', 'i', 'me', 'my', 'we', 'our', 'you',
    'your', 'it', 'this', 'that',
  ]);
  const tokenize = (s: string): Set<string> => {
    return new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 1 && !stop.has(t)),
    );
  };
  const msgTokens = tokenize(message);
  const skillTokens = tokenize(
    `${skill.description} ${skill.whenToUse ?? ''} ${skill.name}`,
  );
  let intersection = 0;
  const matched: string[] = [];
  for (const t of msgTokens) {
    if (skillTokens.has(t)) {
      intersection += 1;
      matched.push(t);
    }
  }
  const union = msgTokens.size + skillTokens.size - intersection;
  const score = union === 0 ? 0 : intersection / union;
  // 0.15 is the same threshold the orchestrator uses for auto-load.
  const wouldActivate = score >= 0.15;
  return c.json({
    ok: true,
    skill: { id: skill.id, name: skill.name },
    score: Math.round(score * 1000) / 1000,
    wouldActivate,
    matched: matched.slice(0, 12),
    threshold: 0.15,
  });
});

skills.post('/:id/toggle', async (c) => {
  const id = c.req.param('id');
  // Local skill? Flip in D1.
  try {
    const updated = await c.env.DB.prepare(
      `UPDATE skills SET enabled = CASE enabled WHEN 1 THEN 0 ELSE 1 END,
                          updated_at = ? WHERE id = ? RETURNING enabled`,
    )
      .bind(Date.now(), id)
      .first<{ enabled: number }>();
    if (updated) return c.json({ ok: true, enabled: updated.enabled === 1 });
  } catch {
    /* fall through to catalog */
  }
  const target = SKILL_CATALOG.find((s) => s.id === id);
  if (!target) return c.json({ error: 'unknown_skill' }, 404);
  target.enabled = !target.enabled;
  return c.json({ ok: true, skill: target });
});

const SaveBody = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(280).optional(),
  whenToUse: z.string().max(280).optional(),
  body: z.string().max(50_000),
  tags: z.array(z.string()).optional(),
  trajectoryTurnId: z.string().optional(),
});

skills.post('/', async (c) => {
  // Save a new skill — typically called from the Train mode "save as skill"
  // sheet. Persists SKILL.md to R2, metadata to D1, and writes an audit
  // entry so the user can see it in the Audit log.
  const parsed = SaveBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const id = parsed.data.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || crypto.randomUUID();
  const now = Date.now();
  const r2Key = `skills/local/${id}/SKILL.md`;

  try {
    await c.env.ARTIFACTS.put(r2Key, parsed.data.body, {
      httpMetadata: { contentType: 'text/markdown' },
    });
  } catch (err) {
    return c.json({ ok: false, error: 'r2_failed', reason: errMsg(err) }, 500);
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO skills (id, name, source, version, description, when_to_use, tags,
                           enabled, has_workflow, r2_skill_md, created_at, updated_at)
       VALUES (?, ?, 'local', '1.0.0', ?, ?, ?, 1, 0, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         when_to_use = excluded.when_to_use,
         tags = excluded.tags,
         r2_skill_md = excluded.r2_skill_md,
         updated_at = excluded.updated_at`,
    )
      .bind(
        id,
        parsed.data.name,
        parsed.data.description ?? null,
        parsed.data.whenToUse ?? null,
        parsed.data.tags ? JSON.stringify(parsed.data.tags) : null,
        r2Key,
        now,
        now,
      )
      .run();
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) {
      // Migrations haven't run — R2 has the body, so this is recoverable.
      return c.json({ ok: true, id, r2Key, skipped: 'no_table' });
    }
    return c.json({ ok: false, error: 'd1_failed', reason: errMsg(err) }, 500);
  }

  // Best-effort audit entry.
  try {
    await c.env.DB.prepare(
      `INSERT INTO audit_log (id, agent_id, kind, payload, created_at) VALUES (?, ?, 'skill_save', ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        'local',
        JSON.stringify({ skillId: id, name: parsed.data.name, trajectoryTurnId: parsed.data.trajectoryTurnId }),
        now,
      )
      .run();
  } catch {
    /* swallow */
  }

  // Auto-PR upstream when the user has enabled "Share skills upstream" in
  // Behavior settings. We read the per-agent settings KV (same key the
  // chat/Automation tab uses) so the toggle is canonical and the user can
  // flip it without restarting anything.
  let prUrl: string | undefined;
  try {
    const ownerSettings = await c.env.SETTINGS.get(`settings:default`);
    let shouldShare = false;
    if (ownerSettings) {
      const parsedSettings = JSON.parse(ownerSettings) as { shareSkillsUpstream?: boolean };
      shouldShare = !!parsedSettings.shareSkillsUpstream;
    }
    if (shouldShare && c.env.GITHUB_TOKEN) {
      // Use the shared `proposePr` helper directly so we don't loop through
      // the HTTP boundary (no service binding needed, no circular import).
      const patchPath = `apps/platform/src/skills/local/${id}/SKILL.md`;
      const pr = await proposePr(c.env, {
        title: `skill: ${parsed.data.name}`,
        body:
          `Agent-authored skill saved by an OpenThink user.\n\n` +
          `**When to use:** ${parsed.data.whenToUse ?? '—'}\n\n` +
          `**Description:** ${parsed.data.description ?? '—'}\n`,
        branchSuffix: `skill-${id}`,
        patches: [{ path: patchPath, content: parsed.data.body }],
      });
      if (pr.ok) prUrl = pr.prUrl;
    }
  } catch (err) {
    console.warn('[skills] auto-pr failed', err);
  }

  return c.json({ ok: true, id, r2Key, prUrl });
});

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Smithers JSX endpoints. Round-trip a skill workflow between the JSX
// authoring shape and the JSON plan shape:
//
//   POST /api/skills/compile  body: { source: "<workflow>…</workflow>" }
//     →   { ok: true, workflow: {...} }
//   POST /api/skills/render   body: { steps: [...], name?: "…" }
//     →   { ok: true, jsx: "<workflow>…</workflow>" }
//
// Both run on the worker so a future skill editor can deploy them through
// CI without bundling the compiler into the SPA — and so the orchestrator
// can compile JSX it receives from MCP peers.
skills.post('/compile', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { source?: string };
  if (!body.source) return c.json({ ok: false, error: 'missing_source' }, 400);
  return c.json(compileSkillJsx(body.source));
});

skills.post('/render', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    steps?: Array<{ id: string; title: string; body: string; requiresApproval?: boolean; tool?: string }>;
    name?: string;
  };
  if (!Array.isArray(body.steps)) return c.json({ ok: false, error: 'missing_steps' }, 400);
  return c.json({ ok: true, jsx: renderPlanAsJsx(body.steps, body.name ?? 'this-skill') });
});
