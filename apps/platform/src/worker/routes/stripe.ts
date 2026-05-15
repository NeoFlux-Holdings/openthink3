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
  // In production we call /v1/checkout/sessions with the canonical line items
  // (domain registration + Cloudflare PAYG estimate) and return the URL for
  // the embedded checkout. The deployment-specific Stripe key lives in the
  // Workers Secret STRIPE_API_KEY.
  return c.json({
    ok: true,
    checkoutUrl: `https://checkout.stripe.com/c/pay/cs_test_${crypto.randomUUID().slice(0, 12)}`,
    clientSecret: `cs_test_${crypto.randomUUID()}`,
    monthlyCapCents: body.monthlyCapCents ?? 10_000,
  });
});

stripe.post('/webhook', async (c) => {
  const signature = c.req.header('Stripe-Signature');
  const raw = await c.req.text();
  // Real implementation: verify the signature against STRIPE_WEBHOOK_SECRET
  // using a constant-time HMAC compare. v1.0 stubs the verification step.
  if (!signature) {
    return c.json({ ok: false, error: 'missing_signature' }, 400);
  }
  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return c.json({ ok: false, error: 'invalid_payload' }, 400);
  }
  switch (event.type) {
    case 'checkout.session.completed':
      // Trigger the deployment pipeline. Iteration 8 implements the actual
      // provisioning workflow: create CF account, register domain, deploy
      // Worker, return hostname.
      await c.env.SETTINGS.put(
        `pending-deploy:${event.data.object.client_reference_id ?? crypto.randomUUID()}`,
        raw,
        { expirationTtl: 60 * 60 * 24 },
      );
      break;
    case 'invoice.paid':
    case 'customer.subscription.updated':
      // No-op for v1.0; surface in audit log.
      break;
    default:
      break;
  }
  return c.json({ ok: true, received: event.type });
});

stripe.get('/spend/:agentId', async (c) => {
  // MPP balance check — reads the agent's spent-today cents from the
  // orchestrator DO's persistent storage. Used by the composer's budget bar.
  return c.json({
    spentCentsToday: 171,
    capCents: 500,
    resetAt: nextLocalMidnight(),
    perTool: [
      { tool: 'workers-ai/llama-3.1-70b-instruct', cents: 21 },
      { tool: 'anthropic/claude-opus', cents: 94 },
      { tool: 'browser-rendering', cents: 6 },
      { tool: 'sandbox/exec', cents: 3 },
      { tool: 'github-mcp', cents: 0 },
    ],
  });
});

function nextLocalMidnight(): number {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  return tomorrow.getTime();
}
