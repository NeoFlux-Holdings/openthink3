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

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

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
/* Today screen state                                                          */
/* -------------------------------------------------------------------------- */
mobile.get('/today', async (c) => {
  const ctx = c.get('mobileToken')!;
  // For v1 we mirror the design fixture verbatim and let the rest of the
  // app catch up. As real data lands in D1 we'll switch this over to a
  // single aggregate query.
  const greeting = greetingForHour(new Date().getHours());
  return c.json({
    greeting,
    agentName: ctx.agentName,
    liveTask: {
      threadId: 'q3',
      title: 'Q3 launch + book 3 customer calls',
      statusLine: 'browsing calendly.com/derek-m · selecting slot',
      spent: 0.04,
      elapsed: '2:31',
      toolsUsed: 5,
    },
    approvals: [
      {
        id: 'a1',
        threadId: 'q3',
        kind: 'send',
        title: 'Send email to Sarah Cohen',
        body: 'Confirming Thursday 2pm. Looking forward to talking through the launch plan.',
        meta: 'sarah@tilt.com · ~$0.001 to send',
        costUsd: 0.001,
        createdAt: Date.now() - 1000 * 60 * 4,
      },
    ],
    spend: { today: 1.71, cap: 5.0 },
    recentThreads: [
      { id: 'q3', title: 'Q3 launch + customer calls', updatedAt: Date.now(), live: true },
      { id: 'redesign', title: 'Compress onboarding to 60s', updatedAt: Date.now() - 1000 * 60 * 60 * 3 },
      { id: 'compete', title: 'Cursor competitive teardown', updatedAt: Date.now() - 1000 * 60 * 60 * 27 },
    ],
  });
});

/* -------------------------------------------------------------------------- */
/* Threads list                                                                */
/* -------------------------------------------------------------------------- */
mobile.get('/threads', async (c) => {
  const _scope = c.req.query('scope') ?? 'all';
  return c.json({
    threads: [
      { id: 'q3', title: 'Q3 launch + customer calls', updatedAt: Date.now(), live: true, pending: 1 },
      { id: 'redesign', title: 'Compress onboarding to 60s', updatedAt: Date.now() - 1000 * 60 * 60 * 3 },
      { id: 'compete', title: 'Cursor competitive teardown', updatedAt: Date.now() - 1000 * 60 * 60 * 27 },
      { id: 'lunch', title: 'Lunch options for Thursday', updatedAt: Date.now() - 1000 * 60 * 60 * 48 },
      { id: 'taxes', title: 'Q2 estimated taxes', updatedAt: Date.now() - 1000 * 60 * 60 * 72 },
    ],
  });
});

mobile.get('/threads/:id', async (c) => {
  const id = c.req.param('id');
  return c.json({
    id,
    title: 'Q3 launch + customer calls',
    live: id === 'q3',
    workingNotes:
      id === 'q3'
        ? {
            goal: 'Q3 launch + book 3 calls next week.',
            found: '8 tier-2 candidates in CRM · 21 free slots Mon–Fri PM.',
            working: 'drafting launch.md v8 · booking Sarah C. + Derek M. via Calendly.',
            updatedAt: Date.now() - 2000,
          }
        : undefined,
    messages: [
      { id: 'm1', role: 'user', text: 'Book 3 customer calls next week from the tier-2 list', time: '9:14' },
      {
        id: 'm2',
        role: 'agent',
        text: "Found 8 candidates in the CRM. I'll start with Sarah Cohen (warm), Derek Mason (cold but high signal), and Priya Vance (Tier 2 archetype). Drafting outreach now.",
        time: '9:15',
        tools: [{ name: 'crm.query' }, { name: 'calendar' }, { name: 'browser' }],
        reasoned: { seconds: 4, tokens: 612, preview: 'Tier-2 customers have the warmest cold-start when the agent shows...' },
      },
    ],
    artifacts: [
      { id: 'a1', type: 'doc', title: 'launch.md', size: '4.2KB' },
      { id: 'a2', type: 'table', title: 'candidates', size: '1.4KB' },
      { id: 'a3', type: 'browser', title: 'calendly.com/derek-m', size: 'live' },
    ],
  });
});

mobile.post('/threads/send', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { threadId?: string | null; text?: string };
  const threadId = body.threadId ?? `t-${nowSec()}`;
  // TODO: forward to the Orchestrator DO. For v1 we just echo back so the
  // mobile composer feels responsive.
  return c.json({ threadId });
});

/* -------------------------------------------------------------------------- */
/* Approvals — real round-trip into the Orchestrator DO                        */
/* -------------------------------------------------------------------------- */

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

interface OrchestratorStub {
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
}

/** Resolve the Orchestrator DO stub for the authed mobile session. */
function orchestratorFor(c: Ctx): OrchestratorStub {
  const ctx = c.get('mobileToken')!;
  const id = c.env.ORCHESTRATOR.idFromName(ctx.agentName);
  return c.env.ORCHESTRATOR.get(id) as unknown as OrchestratorStub;
}

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
/* Library                                                                     */
/* -------------------------------------------------------------------------- */
mobile.get('/library', async (c) => {
  return c.json({
    items: [
      { id: '1', title: 'launch.md', type: 'doc', size: '4.2KB', age: '12m' },
      { id: '2', title: 'candidates', type: 'table', size: '1.4KB', age: '14m' },
      { id: '3', title: 'book-meeting.skill.ts', type: 'code', size: '2.1KB', age: '3h' },
      { id: '4', title: 'wallpaper.png', type: 'image', size: '482KB', age: '11m' },
      { id: '5', title: 'pricing-v2', type: 'webpage', size: '6.8KB', age: '2d' },
      { id: '6', title: 'cost-7d', type: 'chart', size: '0.8KB', age: '4h' },
    ],
  });
});

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

function greetingForHour(hour: number): string {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
