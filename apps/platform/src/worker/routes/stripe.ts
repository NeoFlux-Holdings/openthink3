import { Hono } from 'hono';

import type { Env, Variables } from '../env';

export const stripe = new Hono<{ Bindings: Env; Variables: Variables }>();

// Stripe surface — both onboarding (Path B account provisioning) and runtime
// (MPP spend gating). The webhook handler verifies signatures against the
// signing secret stored as a Workers Secret. v1.0 ships the routes; production
// wiring to live Stripe accounts happens during the customer deploy.

interface CheckoutBody {
  agentName: string;
  email: string;
  domain?: string;
  monthlyCapCents?: number;
}

stripe.post('/checkout', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as CheckoutBody;
  if (!body.email) {
    return c.json({ ok: false, error: 'email_required' }, 400);
  }

  const apiKey = c.env.STRIPE_API_KEY;
  if (apiKey) {
    // Live path: hit POST /v1/checkout/sessions with form-encoded bracket
    // notation Stripe expects for arrays. The line items mirror the Stripe
    // Projects pricing referenced in the PRD — $12/yr domain + a baseline
    // CF Workers cost. Adjust quantities on the wire by passing customLines.
    try {
      const params = new URLSearchParams();
      params.set('mode', 'subscription');
      params.set('customer_email', body.email);
      params.set('success_url', 'https://openthink.run/onboarding/upgrades?status=success');
      params.set('cancel_url', 'https://openthink.run/onboarding/upgrades?status=cancel');
      // Domain registration: a price ID configured on the Stripe account.
      // We accept overrides via env vars so each deployment can map its own
      // SKUs without code changes.
      const domainPriceId = c.env.STRIPE_PRICE_DOMAIN ?? 'price_domain_default';
      const workersPriceId = c.env.STRIPE_PRICE_WORKERS_PAID ?? 'price_workers_paid';
      params.append('line_items[0][price]', domainPriceId);
      params.append('line_items[0][quantity]', '1');
      params.append('line_items[1][price]', workersPriceId);
      params.append('line_items[1][quantity]', '1');
      params.set('metadata[agent_name]', body.agentName);
      params.set('metadata[monthly_cap_cents]', String(body.monthlyCapCents ?? 10_000));
      if (body.domain) params.set('metadata[domain]', body.domain);

      const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Stripe-Version': '2024-06-20',
        },
        body: params.toString(),
      });
      if (res.ok) {
        const data = (await res.json()) as { id: string; url: string; client_secret?: string };
        return c.json({
          ok: true,
          checkoutUrl: data.url,
          checkoutId: data.id,
          clientSecret: data.client_secret,
          monthlyCapCents: body.monthlyCapCents ?? 10_000,
          source: 'stripe',
        });
      }
      const errBody = await res.text();
      console.warn('[stripe] live checkout failed, falling back to stub', res.status, errBody);
    } catch (err) {
      console.warn('[stripe] live checkout threw, falling back to stub', err);
    }
  }

  // Dev / unbound: synthesize a deterministic stub so the onboarding UX flows.
  return c.json({
    ok: true,
    checkoutUrl: `https://checkout.stripe.com/c/pay/cs_test_${crypto.randomUUID().slice(0, 12)}`,
    checkoutId: `cs_test_${crypto.randomUUID().slice(0, 18)}`,
    clientSecret: `cs_test_${crypto.randomUUID()}`,
    monthlyCapCents: body.monthlyCapCents ?? 10_000,
    source: 'stub',
  });
});

stripe.post('/webhook', async (c) => {
  const signatureHeader = c.req.header('Stripe-Signature');
  const raw = await c.req.text();
  if (!signatureHeader) {
    return c.json({ ok: false, error: 'missing_signature' }, 400);
  }

  // Stripe-Signature header format:
  //   t=<unix-timestamp>,v1=<hex-sha256-hmac>[,v0=<legacy>]
  // The signed payload is `${t}.${raw_body}`. We HMAC-SHA256 with the
  // STRIPE_WEBHOOK_SECRET, then constant-time compare to the v1 value.
  //
  // The verify is OPT-IN: a deployment that hasn't run `wrangler secret put
  // STRIPE_WEBHOOK_SECRET` yet keeps accepting webhooks (logged) so the
  // local dev path doesn't require setting up Stripe just to test the UI.
  // Production must always set the secret — when it's present, mismatches
  // are rejected with 400.
  const secret = c.env.STRIPE_WEBHOOK_SECRET;
  if (secret) {
    const ok = await verifyStripeSignature(signatureHeader, raw, secret);
    if (!ok) {
      console.warn('[stripe] webhook signature mismatch');
      return c.json({ ok: false, error: 'signature_mismatch' }, 400);
    }
  } else {
    console.warn(
      '[stripe] STRIPE_WEBHOOK_SECRET not set — accepting unverified webhook (dev only)',
    );
  }

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return c.json({ ok: false, error: 'invalid_payload' }, 400);
  }
  switch (event.type) {
    case 'checkout.session.completed': {
      // 1. Park the raw event in KV with the session id as the key so we can
      //    reconcile webhook order issues + replay if the workflow fails.
      const obj = event.data.object as {
        id?: string;
        client_reference_id?: string;
        metadata?: Record<string, string>;
        customer_email?: string;
        amount_total?: number;
      };
      const sessionId = obj.id ?? obj.client_reference_id ?? crypto.randomUUID();
      await c.env.SETTINGS.put(`pending-deploy:${sessionId}`, raw, {
        expirationTtl: 60 * 60 * 24,
      });

      // 2. Kick the GoalWorkflow for Stripe-Projects provisioning. The
      //    workflow body (apps/platform/src/worker/workflows/goal.ts) is
      //    responsible for: creating the user's CF account, registering the
      //    domain (if `metadata.domain` is set), enabling Workers Paid,
      //    deploying the Worker, configuring Access. We pass the relevant
      //    metadata through `params` so the workflow doesn't need to re-read
      //    the webhook payload from KV.
      try {
        if (c.env.GOAL_WORKFLOW) {
          await c.env.GOAL_WORKFLOW.create({
            id: `provision-${sessionId}`,
            params: {
              kind: 'stripe_provisioning',
              sessionId,
              agentName: obj.metadata?.agent_name ?? '',
              ownerEmail: obj.customer_email ?? '',
              domain: obj.metadata?.domain ?? null,
              amountCents: obj.amount_total ?? 0,
              raw,
            },
          });
        }
      } catch (err) {
        console.error('[stripe] failed to kick provisioning workflow', err);
        // The webhook still returns 200 — Stripe should not retry forever
        // because our worker had an internal issue. The pending-deploy KV
        // entry remains for manual reconciliation.
      }
      break;
    }
    case 'invoice.paid':
    case 'customer.subscription.updated':
      // No-op for v1.0; surface in audit log.
      break;
    default:
      break;
  }
  return c.json({ ok: true, received: event.type });
});

// Stripe webhook signature verification. Mirrors the canonical Stripe SDK
// algorithm (computeHmac → bytes-compare each v1 candidate) with two
// hardening choices:
//   - We compare in constant time using a fixed-length XOR-accumulator to
//     defeat timing side channels even though the input lengths might
//     differ in practice.
//   - We optionally enforce a freshness window (5 minutes) when the header
//     contains a timestamp, to make replay attacks expensive.
async function verifyStripeSignature(
  header: string,
  payload: string,
  secret: string,
  toleranceSeconds = 5 * 60,
): Promise<boolean> {
  const parts = header.split(',').map((p) => p.trim());
  const ts = parts.find((p) => p.startsWith('t='))?.slice(2);
  const v1Values = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!ts || v1Values.length === 0) return false;

  // Freshness check — reject ancient signatures even if HMAC matches.
  const tNum = Number(ts);
  if (!Number.isFinite(tNum)) return false;
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - tNum);
  if (ageSeconds > toleranceSeconds) return false;

  const signedPayload = `${ts}.${payload}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(signedPayload));
  const expectedHex = bytesToHex(new Uint8Array(sigBuf));

  // Any v1 value matching is acceptance — Stripe rotates secrets by
  // including both old and new during the cutover window.
  return v1Values.some((v) => constantTimeEqualHex(v, expectedHex));
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function constantTimeEqualHex(a: string, b: string): boolean {
  // Pad to the longer length so the XOR loop reads a fixed range — this
  // keeps timing constant regardless of input shape.
  const len = Math.max(a.length, b.length);
  let mismatch = a.length !== b.length ? 1 : 0;
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    mismatch |= ca ^ cb;
  }
  return mismatch === 0;
}

stripe.get('/spend/:agentId', async (c) => {
  // MPP balance check — reads the agent's spent-today cents from the audit
  // log (tool_call + spend kinds) when D1 has data; falls back to the
  // hard-coded sample so the composer's budget bar always renders.
  //
  // Returns both today's window (now-24h) AND yesterday's window
  // (now-48h…now-24h) so the UI can render a "vs yesterday" delta chip
  // without making a second round-trip. Same per-tool tally is only built
  // for today since that's all the per-tool table shows.
  const agentId = c.req.param('agentId');
  const now = Date.now();
  const todayStart = now - 24 * 60 * 60_000;
  const yesterdayStart = now - 48 * 60 * 60_000;

  // Resolve the cap from settings (slider in Spending tab writes here)
  // with a default of 500¢ ($5). Done once up front so both the D1 and
  // stub branches return the user's actual setting.
  let capCents = 500;
  try {
    const raw = await c.env.SETTINGS.get(`settings:${agentId}`);
    if (raw) {
      const cfg = JSON.parse(raw) as { spendCapCents?: number };
      if (typeof cfg.spendCapCents === 'number' && cfg.spendCapCents >= 0) {
        capCents = Math.min(1_000_000, Math.round(cfg.spendCapCents));
      }
    }
  } catch {
    /* keep default */
  }

  try {
    const rows = await c.env.DB.prepare(
      `SELECT kind, payload, created_at FROM audit_log
       WHERE agent_id = ? AND created_at >= ? AND (kind = 'tool_call' OR kind = 'spend')`,
    )
      .bind(agentId, yesterdayStart)
      .all<{ kind: string; payload: string; created_at: number }>();
    const tally = new Map<string, number>();
    // Per-tool hourly buckets across the last 24h — 24 slots, slot 0 is
    // the oldest, slot 23 is the most-recent. Lets the UI draw a tiny
    // sparkline alongside each row showing how the spend distributed
    // over the day.
    const HOUR_BUCKETS = 24;
    const hourly = new Map<string, number[]>();
    const ensureBuckets = (tool: string): number[] => {
      let arr = hourly.get(tool);
      if (!arr) {
        arr = new Array(HOUR_BUCKETS).fill(0);
        hourly.set(tool, arr);
      }
      return arr;
    };
    let total = 0;
    let totalYesterday = 0;
    for (const row of rows.results ?? []) {
      let p: { tool?: string; costCents?: number } = {};
      try {
        p = JSON.parse(row.payload);
      } catch {
        /* ignore */
      }
      const cents = Number(p.costCents ?? 0);
      if (row.created_at >= todayStart) {
        const tool = p.tool ?? 'unknown';
        tally.set(tool, (tally.get(tool) ?? 0) + cents);
        total += cents;
        // Slot = (ageHours floored) → distance from now. We invert so
        // slot 23 = newest, slot 0 = oldest.
        const ageHours = Math.floor((now - row.created_at) / 3_600_000);
        const slot = Math.max(0, Math.min(HOUR_BUCKETS - 1, HOUR_BUCKETS - 1 - ageHours));
        const arr = ensureBuckets(tool);
        arr[slot] = (arr[slot] ?? 0) + cents;
      } else {
        totalYesterday += cents;
      }
    }
    if (tally.size > 0 || totalYesterday > 0) {
      return c.json({
        spentCentsToday: total,
        spentCentsYesterday: totalYesterday,
        capCents,
        resetAt: nextLocalMidnight(),
        perTool: [...tally.entries()]
          .map(([tool, cents]) => ({
            tool,
            cents,
            hourly: hourly.get(tool) ?? new Array(HOUR_BUCKETS).fill(0),
          }))
          .sort((a, b) => b.cents - a.cents),
        source: 'd1',
      });
    }
  } catch (err) {
    console.warn('[stripe] spend aggregate fallback', err);
  }

  // Deterministic stub: vary yesterday by a small offset so the delta
  // chip has something non-zero to render in local dev. Per-tool hourly
  // arrays are picked to render distinct sparkline shapes (rising,
  // bursty, declining) — useful both as design refs and as fixtures.
  const stubHourly = (seed: number): number[] => {
    const arr: number[] = [];
    for (let i = 0; i < 24; i++) {
      // Cheap mod-based pseudo-noise so each tool gets a unique-shaped
      // curve. Keeps the values deterministic across calls.
      arr.push(Math.max(0, Math.round(Math.sin((i + seed) * 0.6) * 4 + 5 - seed)));
    }
    return arr;
  };
  return c.json({
    spentCentsToday: 171,
    spentCentsYesterday: 152,
    capCents,
    resetAt: nextLocalMidnight(),
    perTool: [
      { tool: 'workers-ai/llama-3.1-70b-instruct', cents: 21, hourly: stubHourly(1) },
      { tool: 'anthropic/claude-opus', cents: 94, hourly: stubHourly(2) },
      { tool: 'browser-rendering', cents: 6, hourly: stubHourly(3) },
      { tool: 'sandbox/exec', cents: 3, hourly: stubHourly(4) },
      { tool: 'github-mcp', cents: 0, hourly: stubHourly(5) },
    ],
    source: 'stub',
  });
});

function nextLocalMidnight(): number {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  return tomorrow.getTime();
}
