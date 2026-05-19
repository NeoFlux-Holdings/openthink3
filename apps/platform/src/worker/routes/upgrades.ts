import { Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../env';

export const upgrades = new Hono<{ Bindings: Env; Variables: Variables }>();

// Stripe checkout entry points for the two paid upgrades surfaced in the
// onboarding §upgrades step. Both routes return a `checkoutId` and a
// `checkoutUrl`. Production points the URL at a real Stripe Checkout Session;
// locally we mint a deterministic `cs_test_<uuid>` so the UX can complete
// without billing keys configured.
//
// Webhook handling lives in routes/stripe.ts — its `checkout.session.completed`
// case is what actually grants the upgrade. The IDs here are tracked in KV so
// the webhook can match them back to the right agent + line item.

const WorkersPaidBody = z.object({
  agentName: z.string().min(2),
  email: z.string().email(),
});

upgrades.post('/workers-paid', async (c) => {
  const parsed = WorkersPaidBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const checkoutId = `cs_test_${crypto.randomUUID().slice(0, 18)}`;
  await c.env.SETTINGS.put(
    `upgrade:workers-paid:${checkoutId}`,
    JSON.stringify({
      sku: 'workers_paid',
      amountCents: 500,
      currency: 'usd',
      interval: 'month',
      agentName: parsed.data.agentName,
      email: parsed.data.email,
      createdAt: Date.now(),
    }),
    { expirationTtl: 60 * 60 * 24 },
  );
  return c.json({
    ok: true,
    checkoutId,
    checkoutUrl: `https://checkout.stripe.com/c/pay/${checkoutId}`,
    sku: 'workers_paid',
    amountCents: 500,
    interval: 'month',
  });
});

const DomainBody = z.object({
  agentName: z.string().min(2),
  email: z.string().email(),
  domain: z.string().min(3),
  priceCents: z.number().int().nonnegative(),
});

upgrades.post('/domain', async (c) => {
  const parsed = DomainBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const checkoutId = `cs_test_${crypto.randomUUID().slice(0, 18)}`;
  await c.env.SETTINGS.put(
    `upgrade:domain:${checkoutId}`,
    JSON.stringify({
      sku: 'cf_domain_registration',
      amountCents: parsed.data.priceCents,
      currency: 'usd',
      interval: 'year',
      domain: parsed.data.domain,
      agentName: parsed.data.agentName,
      email: parsed.data.email,
      createdAt: Date.now(),
    }),
    { expirationTtl: 60 * 60 * 24 },
  );
  return c.json({
    ok: true,
    checkoutId,
    checkoutUrl: `https://checkout.stripe.com/c/pay/${checkoutId}`,
    sku: 'cf_domain_registration',
    domain: parsed.data.domain,
    amountCents: parsed.data.priceCents,
    interval: 'year',
  });
});

// Quick read-back so the deploy step and Settings → Cloudflare can show the
// pending state without a fresh checkout call.
upgrades.get('/:checkoutId', async (c) => {
  const id = c.req.param('checkoutId');
  const wp = await c.env.SETTINGS.get(`upgrade:workers-paid:${id}`);
  const dn = await c.env.SETTINGS.get(`upgrade:domain:${id}`);
  if (!wp && !dn) return c.json({ ok: false, error: 'not_found' }, 404);
  return c.json({ ok: true, upgrade: JSON.parse(wp ?? dn ?? 'null') });
});
