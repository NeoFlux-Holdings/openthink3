/* Mobile-companion API routes.
 *
 * Used by the Expo mobile app (apps/mobile) to talk to the user's own
 * agent. Auth model is straightforward: the mobile app holds a long-lived
 * bearer token issued by /api/mobile/session/exchange after the user types
 * a one-time code shown on their browser. Every other endpoint requires
 * the `Authorization: Bearer …` header.
 *
 * The browser-side pairing flow (`/mobile/pair` route in the SPA) is
 * intentionally simple: the user opens that page, taps "Authorize this
 * device", sees a 6-letter code, and types it into the mobile app. The
 * /api/mobile/pair/init route below issues a fresh code and stores it in
 * KV with a 5-minute TTL.
 */
import { Hono, type Context } from 'hono';

import type { Env, Variables } from '../env';

export const mobile = new Hono<{ Bindings: Env; Variables: Variables }>();

interface PairingRecord {
  agentName: string;
  issuedAt: number;
  consumedAt?: number;
}

const CODE_TTL_SECONDS = 300; // 5 minutes
const TOKEN_KEY = (token: string) => `mobile:token:${token}`;
const CODE_KEY = (code: string) => `mobile:pair:${code}`;

function generateCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/* -------------------------------------------------------------------------- */
/* Pairing — start a new device pairing from the browser                       */
/* -------------------------------------------------------------------------- */
mobile.post('/pair/init', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { agentName?: string };
  const agentName = (body.agentName ?? 'agent').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'agent';

  // Generate a short code with a 5-minute TTL. If by random chance we collide
  // with an existing code we just retry a handful of times — the KV space
  // (~30^6 = 729M) is far larger than our collision window.
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = generateCode();
    const existing = await c.env.SETTINGS.get(CODE_KEY(code));
    if (existing) continue;
    const record: PairingRecord = { agentName, issuedAt: Date.now() };
    await c.env.SETTINGS.put(CODE_KEY(code), JSON.stringify(record), {
      expirationTtl: CODE_TTL_SECONDS,
    });
    return c.json({ code, expiresInSec: CODE_TTL_SECONDS });
  }
  return c.json({ error: 'pair_collision' }, 500);
});

/* -------------------------------------------------------------------------- */
/* Exchange — mobile app trades the code for a bearer token                    */
/* -------------------------------------------------------------------------- */
mobile.post('/session/exchange', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { code?: string; deviceLabel?: string };
  const code = (body.code ?? '').trim().toUpperCase();
  if (!code) return c.json({ error: 'missing_code' }, 400);

  const raw = await c.env.SETTINGS.get(CODE_KEY(code));
  if (!raw) return c.json({ error: 'invalid_or_expired' }, 400);
  const record = JSON.parse(raw) as PairingRecord;
  if (record.consumedAt) return c.json({ error: 'already_used' }, 400);

  // Mint a bearer token, store it in KV (no TTL — long-lived) with metadata.
  const token = generateToken();
  const tokenRecord = {
    agentName: record.agentName,
    deviceLabel: body.deviceLabel ?? 'mobile',
    issuedAt: Date.now(),
  };
  await c.env.SETTINGS.put(TOKEN_KEY(token), JSON.stringify(tokenRecord));

  // Mark the code consumed so a second exchange fails fast even before TTL
  // expires. Keep the same TTL to avoid creating a long-lived "used" record.
  await c.env.SETTINGS.put(
    CODE_KEY(code),
    JSON.stringify({ ...record, consumedAt: Date.now() }),
    { expirationTtl: CODE_TTL_SECONDS },
  );

  return c.json({ token, agentName: record.agentName });
});

/* -------------------------------------------------------------------------- */
/* Token guard — every other mobile route gets it via the middleware           */
/* -------------------------------------------------------------------------- */
mobile.use('*', async (c, next) => {
  // Pairing routes above bypass the guard — they need to run unauthenticated.
  const path = new URL(c.req.url).pathname;
  if (
    path.endsWith('/api/mobile/pair/init') ||
    path.endsWith('/api/mobile/session/exchange')
  ) {
    return next();
  }
  const auth = c.req.header('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match) return c.json({ error: 'missing_token' }, 401);
  const token = match[1]!;
  const raw = await c.env.SETTINGS.get(TOKEN_KEY(token));
  if (!raw) return c.json({ error: 'invalid_token' }, 401);
  c.set('mobileToken', { token, ...(JSON.parse(raw) as { agentName: string; deviceLabel: string; issuedAt: number }) });
  await next();
});

/* -------------------------------------------------------------------------- */
/* Legacy routes (now real) — Today + Threads + Conversation + Send.           */
/* The orchestrator helpers below are bound to the authed agent's DO. The      */
/* fixtures previously here are gone; if the orchestrator is unreachable we    */
/* return a 502 instead of made-up data so the UI surfaces an offline state.   */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Approvals — real round-trip into the Orchestrator DO                        */
/* -------------------------------------------------------------------------- */

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

interface OrchestratorStub {
  // Approvals (Tier-1 backend, shipped previously).
  listPendingApprovals(): Promise<Array<Record<string, unknown>>>;
  respondToApproval(
    id: string,
    decision: 'approve' | 'deny' | 'edit',
  ): Promise<{ ok: boolean; reason?: string }>;
  requestApproval(req: {
    id?: string;
    threadId: string;
    kind: 'tool' | 'send' | 'spend' | 'other';
    title: string;
    body?: string;
    meta?: string;
    costCents?: number;
    context?: Record<string, unknown>;
  }): Promise<'approve' | 'deny' | 'edit'>;
  // Mobile aggregators — single round-trip per screen.
  mobileToday(): Promise<unknown>;
  mobileThreads(scope: 'all' | 'live' | 'today' | 'week' | 'approvals'): Promise<unknown>;
  mobileConversation(threadId: string): Promise<unknown>;
  mobileSend(threadId: string | null, text: string): Promise<{ threadId: string; messageId: string }>;
}

/** Resolve the Orchestrator DO stub for the authed mobile session. */
function orchestratorFor(c: Ctx): OrchestratorStub {
  const ctx = c.get('mobileToken')!;
  const id = c.env.ORCHESTRATOR.idFromName(ctx.agentName);
  return c.env.ORCHESTRATOR.get(id) as unknown as OrchestratorStub;
}

/* ---------- Today / Threads / Conversation / Send (real) ---------- */

mobile.get('/today', async (c) => {
  try {
    const stub = orchestratorFor(c);
    return c.json(await stub.mobileToday());
  } catch (err) {
    console.warn('[mobile] /today failed', err);
    return c.json({ error: 'orchestrator_unreachable' }, 502);
  }
});

mobile.get('/threads', async (c) => {
  const scope = (c.req.query('scope') ?? 'all') as
    | 'all'
    | 'live'
    | 'today'
    | 'week'
    | 'approvals';
  try {
    const stub = orchestratorFor(c);
    return c.json(await stub.mobileThreads(scope));
  } catch (err) {
    console.warn('[mobile] /threads failed', err);
    return c.json({ error: 'orchestrator_unreachable' }, 502);
  }
});

mobile.get('/threads/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const stub = orchestratorFor(c);
    return c.json(await stub.mobileConversation(id));
  } catch (err) {
    console.warn('[mobile] /threads/:id failed', err);
    return c.json({ error: 'orchestrator_unreachable' }, 502);
  }
});

mobile.post('/threads/send', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    threadId?: string | null;
    text?: string;
  };
  const text = (body.text ?? '').trim();
  if (!text) return c.json({ error: 'missing_text' }, 400);
  try {
    const stub = orchestratorFor(c);
    return c.json(await stub.mobileSend(body.threadId ?? null, text));
  } catch (err) {
    console.warn('[mobile] /threads/send failed', err);
    return c.json({ error: 'orchestrator_unreachable' }, 502);
  }
});

mobile.get('/approvals', async (c) => {
  try {
    const stub = orchestratorFor(c);
    const list = await stub.listPendingApprovals();
    // Map server-side cost_cents → mobile-friendly costUsd at the wire edge.
    const approvals = list.map((r) => {
      const out: Record<string, unknown> = {
        id: r.id,
        threadId: r.threadId,
        kind: r.kind ?? 'other',
        title: r.title,
        body: r.body,
        meta: r.meta,
        createdAt: r.createdAt,
      };
      if (typeof r.costCents === 'number') out.costUsd = (r.costCents as number) / 100;
      return out;
    });
    return c.json({ approvals });
  } catch (err) {
    console.warn('[mobile] /approvals failed', err);
    return c.json({ approvals: [] });
  }
});

mobile.post('/approvals/:id/respond', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing_id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as {
    decision?: 'approve' | 'deny' | 'edit' | 'send' | 'skip';
  };
  // Mobile UX uses Send/Skip; normalize to wire vocabulary. 'edit' passes through.
  const raw = body.decision;
  const decision: 'approve' | 'deny' | 'edit' | null =
    raw === 'approve' || raw === 'send' ? 'approve'
    : raw === 'deny' || raw === 'skip' ? 'deny'
    : raw === 'edit' ? 'edit'
    : null;
  if (!decision) return c.json({ error: 'invalid_decision' }, 400);
  try {
    const stub = orchestratorFor(c);
    const res = await stub.respondToApproval(id, decision);
    return c.json(res);
  } catch (err) {
    console.warn('[mobile] /approvals/respond failed', err);
    return c.json({ ok: false, error: 'orchestrator_unreachable' }, 502);
  }
});

/**
 * Dev-mode fixture: queue a pending approval for the current agent so we can
 * exercise the round-trip without an agent path that emits one yet. Gated on
 * the OPENTHINK_VERSION still being the dev placeholder; production builds
 * stamp a different version so this returns 404 there.
 */
mobile.post('/approvals/test', async (c) => {
  if (c.env.OPENTHINK_VERSION !== '0.1.0') {
    return c.json({ error: 'not_found' }, 404);
  }
  const ctx = c.get('mobileToken')!;
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    threadId?: string;
  };
  try {
    const stub = orchestratorFor(c);
    // Fire-and-forget — the awaited promise resolves only when a user responds.
    // We don't want the HTTP request to block, so we just kick it off and
    // return the approval id (which the caller / verify can look up later).
    const id = crypto.randomUUID();
    void stub.requestApproval({
      id,
      threadId: body.threadId ?? 'test',
      kind: 'send',
      title: body.title ?? 'Test approval',
      body: 'Generated by /api/mobile/approvals/test — respond via the mobile app or the respond endpoint.',
      meta: `dev fixture · agent ${ctx.agentName}`,
      costCents: 1,
      context: { source: 'dev-fixture' },
    });
    return c.json({ ok: true, id });
  } catch (err) {
    console.warn('[mobile] /approvals/test failed', err);
    return c.json({ ok: false }, 502);
  }
});

/* -------------------------------------------------------------------------- */
/* Library — read directly from R2 under artifacts/<agentName>/.               */
/* The Orchestrator drops artifacts there as it runs (see the research path);  */
/* listing R2 keeps us decoupled from any per-message bookkeeping that may     */
/* lag behind. Keys are shaped `artifacts/<agent>/<kind>/<id>.<ext>`.          */
/* -------------------------------------------------------------------------- */
mobile.get('/library', async (c) => {
  const ctx = c.get('mobileToken')!;
  try {
    const prefix = `artifacts/${ctx.agentName}/`;
    const list = await c.env.ARTIFACTS.list({ prefix, limit: 50 });
    const items = list.objects
      // Newest first so the most recent artifact sits at the top of
      // the grid like the design specifies.
      .sort((a, b) => (b.uploaded?.getTime() ?? 0) - (a.uploaded?.getTime() ?? 0))
      .map((obj) => {
        const filename = obj.key.slice(prefix.length);
        const [kindFolder, fileWithExt] = filename.split('/', 2);
        const name = fileWithExt ?? kindFolder ?? 'artifact';
        const ext = (name.split('.').pop() ?? '').toLowerCase();
        const type =
          ext === 'md' || ext === 'txt' ? 'doc'
          : ext === 'csv' || ext === 'tsv' || ext === 'json' ? 'table'
          : ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'svg' ? 'image'
          : ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'py' ? 'code'
          : ext === 'html' || ext === 'htm' ? 'webpage'
          : 'doc';
        return {
          id: obj.key,
          title: obj.customMetadata?.title ?? name,
          type,
          size: formatBytes(obj.size),
          age: obj.uploaded ? formatAge(obj.uploaded.getTime()) : '',
        };
      });
    return c.json({ items });
  } catch (err) {
    console.warn('[mobile] /library failed', err);
    return c.json({ items: [], error: 'r2_unreachable' }, 200);
  }
});

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function formatAge(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 24 * 3_600_000) return `${Math.round(diff / 3_600_000)}h`;
  return `${Math.round(diff / (24 * 3_600_000))}d`;
}

/* -------------------------------------------------------------------------- */
/* Push registration                                                           */
/* -------------------------------------------------------------------------- */
mobile.post('/push/register', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    token?: string;
    platform?: 'ios' | 'android';
  };
  const token = body.token;
  const platform = body.platform;
  if (!token || !platform) return c.json({ error: 'missing_fields' }, 400);
  // Store under a stable key so a re-register replaces the previous token.
  const ctx = c.get('mobileToken')!;
  await c.env.SETTINGS.put(
    `mobile:push:${ctx.token}`,
    JSON.stringify({ token, platform, deviceLabel: ctx.deviceLabel, agentName: ctx.agentName, updatedAt: Date.now() }),
  );
  return c.json({ ok: true });
});

