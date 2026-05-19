import { Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../env';

export const workspaces = new Hono<{ Bindings: Env; Variables: Variables }>();

// PRD §5.5 — "there can be more than one orchestrator at a top level if the
// user chooses — maybe call it a workspace". Each workspace is a named
// Orchestrator DO instance with its own thread history, memories, and
// settings. The owner can switch between them or open multiple in tabs.
//
// v1 keeps this simple: one owner (the local CF account), a KV-backed list,
// and a single `active` selector. Real multi-tenant isolation is implicit
// because each workspace's DOs are addressed by name → distinct instances.

interface Workspace {
  id: string;
  name: string;
  agentName: string;
  description?: string;
  createdAt: number;
  pinned?: boolean;
  // ms timestamp of when the workspace was archived. Undefined for
  // active workspaces. Archived rows are returned only when the caller
  // explicitly asks via `?archived=1`; the default list hides them so
  // a heavy archive doesn't clutter the active workspace picker.
  archivedAt?: number;
}

const OWNER_KEY = 'workspaces:local';
const ACTIVE_KEY = 'workspaces:local:active';

async function readAll(env: Env): Promise<Workspace[]> {
  const raw = await env.SETTINGS.get(OWNER_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Workspace[];
  } catch {
    return [];
  }
}

async function writeAll(env: Env, list: Workspace[]): Promise<void> {
  await env.SETTINGS.put(OWNER_KEY, JSON.stringify(list));
}

workspaces.get('/', async (c) => {
  const list = await readAll(c.env);
  // `?archived=1` flips the lens — return only archived workspaces.
  // Default is "active only" so the picker stays uncluttered. The
  // total archived count rides through on every response so the UI
  // can show a "N archived" toggle without a second roundtrip.
  const wantArchived = c.req.query('archived') === '1';
  const archivedCount = list.filter((w) => typeof w.archivedAt === 'number').length;
  const visible = wantArchived
    ? list.filter((w) => typeof w.archivedAt === 'number')
    : list.filter((w) => typeof w.archivedAt !== 'number');
  const activeId = (await c.env.SETTINGS.get(ACTIVE_KEY)) ?? visible[0]?.id ?? null;
  return c.json({ workspaces: visible, activeId, archivedCount });
});

// Archive (soft-delete) a workspace. Sets `archivedAt`; the workspace
// disappears from the default `GET /` response and shows up only when
// the client asks for `?archived=1`. Idempotent — re-archiving a row
// just bumps the timestamp. The active workspace falls back to the
// next available active one if the user archives their current.
// Bulk-import workspaces from a snapshot. Same shape the GET / response
// uses (`workspaces: Workspace[]`) so an export → import round-trip is
// trivial. Dedup by `(name, agentName)` so re-importing the same
// snapshot is idempotent. Skips entries whose name+agentName already
// exist for this owner. Returns counts.
workspaces.post('/import', async (c) => {
  const ImportBody = z.union([
    z.object({ workspaces: z.array(z.object({}).passthrough()).max(100) }),
    z.array(z.object({}).passthrough()).max(100),
  ]);
  const parsed = ImportBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const inputs = Array.isArray(parsed.data) ? parsed.data : parsed.data.workspaces;
  const list = await readAll(c.env);
  const existing = new Set(
    list.map((w) => `${w.name.toLowerCase()}:::${w.agentName.toLowerCase()}`),
  );
  let added = 0;
  let skipped = 0;
  let invalid = 0;
  for (const raw of inputs) {
    const r = raw as Partial<Workspace>;
    if (
      typeof r.name !== 'string' ||
      typeof r.agentName !== 'string' ||
      !r.name.trim() ||
      !r.agentName.trim()
    ) {
      invalid += 1;
      continue;
    }
    const dedupKey = `${r.name.toLowerCase()}:::${r.agentName.toLowerCase()}`;
    if (existing.has(dedupKey)) {
      skipped += 1;
      continue;
    }
    existing.add(dedupKey);
    const ws: Workspace = {
      id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
      name: r.name.trim().slice(0, 50),
      agentName: r.agentName.trim().slice(0, 60),
      description: typeof r.description === 'string' ? r.description.slice(0, 280) : undefined,
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
      pinned: typeof r.pinned === 'boolean' ? r.pinned : undefined,
      archivedAt: typeof r.archivedAt === 'number' ? r.archivedAt : undefined,
    };
    list.push(ws);
    added += 1;
  }
  if (added > 0) await writeAll(c.env, list);
  return c.json({ ok: true, added, skipped, invalid });
});

workspaces.post('/:id/archive', async (c) => {
  const id = c.req.param('id');
  const list = await readAll(c.env);
  const target = list.find((w) => w.id === id);
  if (!target) {
    return c.json({ ok: false, error: 'not_found' }, 404);
  }
  const next = list.map((w) =>
    w.id === id ? { ...w, archivedAt: Date.now() } : w,
  );
  await writeAll(c.env, next);
  // If the archived row was active, swap to the next non-archived row.
  const active = await c.env.SETTINGS.get(ACTIVE_KEY);
  if (active === id) {
    const fallback = next.find(
      (w) => w.id !== id && typeof w.archivedAt !== 'number',
    );
    if (fallback) {
      await c.env.SETTINGS.put(ACTIVE_KEY, fallback.id);
    } else {
      await c.env.SETTINGS.delete(ACTIVE_KEY);
    }
  }
  return c.json({ ok: true, archived: id });
});

// Restore an archived workspace — clear `archivedAt` and put it back
// into the active list. The order doesn't change; manual sort mode
// users can re-position from there if needed.
workspaces.post('/:id/restore', async (c) => {
  const id = c.req.param('id');
  const list = await readAll(c.env);
  const target = list.find((w) => w.id === id);
  if (!target || typeof target.archivedAt !== 'number') {
    return c.json({ ok: false, error: 'not_archived' }, 404);
  }
  const next = list.map((w) => {
    if (w.id !== id) return w;
    const { archivedAt: _archivedAt, ...rest } = w;
    return rest as Workspace;
  });
  await writeAll(c.env, next);
  return c.json({ ok: true, restored: id });
});

const CreateBody = z.object({
  name: z.string().min(2).max(50),
  agentName: z.string().min(2).max(60).optional(),
  description: z.string().max(280).optional(),
});

workspaces.post('/', async (c) => {
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const list = await readAll(c.env);
  const ws: Workspace = {
    id: crypto.randomUUID(),
    name: parsed.data.name,
    agentName:
      parsed.data.agentName ?? parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    description: parsed.data.description,
    createdAt: Date.now(),
  };
  list.unshift(ws);
  await writeAll(c.env, list);
  // Auto-activate the first workspace someone creates.
  if (list.length === 1) {
    await c.env.SETTINGS.put(ACTIVE_KEY, ws.id);
  }
  return c.json({ ok: true, workspace: ws });
});

workspaces.post('/:id/activate', async (c) => {
  const id = c.req.param('id');
  const list = await readAll(c.env);
  if (!list.some((w) => w.id === id)) {
    return c.json({ ok: false, error: 'not_found' }, 404);
  }
  await c.env.SETTINGS.put(ACTIVE_KEY, id);
  const active = list.find((w) => w.id === id)!;
  return c.json({ ok: true, activeId: id, active });
});

workspaces.post('/:id/pin', async (c) => {
  const id = c.req.param('id');
  const list = await readAll(c.env);
  const next = list.map((w) => (w.id === id ? { ...w, pinned: !w.pinned } : w));
  await writeAll(c.env, next);
  return c.json({ ok: true, workspace: next.find((w) => w.id === id) });
});

// PUT /api/workspaces/order — accepts `{ ids: string[] }` and rewrites
// the workspace list in that order. Same idempotent semantics as the
// knowledge route's reorder: any workspace id not in the supplied list
// is appended at the end in its original order, so a stale client
// snapshot doesn't drop rows. Used by the drag-to-reorder affordance
// in the Workspaces UI; the canonical sort modes (pinned, activity,
// created) still apply on top of the manual order — so 'pinned' will
// still float pinned to the top, 'created' still goes by createdAt,
// and only 'manual' (new sort key) honors this ordering.
const ReorderBody = z.object({
  ids: z.array(z.string()).max(60),
});

workspaces.put('/order', async (c) => {
  const parsed = ReorderBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const list = await readAll(c.env);
  const byId = new Map(list.map((w) => [w.id, w] as const));
  const next: Workspace[] = [];
  for (const id of parsed.data.ids) {
    const w = byId.get(id);
    if (w) {
      next.push(w);
      byId.delete(id);
    }
  }
  // Append unenumerated workspaces in their original order — a fresh
  // workspace created between the client fetch and this PUT won't be
  // dropped.
  for (const remaining of byId.values()) next.push(remaining);
  await writeAll(c.env, next);
  return c.json({ ok: true, count: next.length });
});

workspaces.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const list = await readAll(c.env);
  const next = list.filter((w) => w.id !== id);
  if (next.length === list.length) {
    return c.json({ ok: false, error: 'not_found' }, 404);
  }
  await writeAll(c.env, next);
  // If we deleted the active one, fall back to the first remaining workspace.
  const active = await c.env.SETTINGS.get(ACTIVE_KEY);
  if (active === id) {
    if (next[0]) {
      await c.env.SETTINGS.put(ACTIVE_KEY, next[0].id);
    } else {
      await c.env.SETTINGS.delete(ACTIVE_KEY);
    }
  }
  return c.json({ ok: true, deleted: id, remaining: next.length });
});
