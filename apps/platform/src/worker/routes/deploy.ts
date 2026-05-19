import { Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../env';
import type { DeployState, DeployStep } from '../../shared/types';
import { provisionAccess } from './cf-access';

export const deploy = new Hono<{ Bindings: Env; Variables: Variables }>();

// In iteration 1 the deploy endpoint is a deterministic dry-run that drives the UI
// timeline. The real Wrangler-driven provisioner lands in iteration 2 alongside
// the CF token validator (see tools/cf-token).

interface StepTemplate {
  id: string;
  label: string;
}

const BASE_STEPS: ReadonlyArray<StepTemplate> = [
  { id: 'validate-token', label: 'Validating Cloudflare token' },
  { id: 'create-worker', label: 'Creating Worker' },
  { id: 'setup-storage', label: 'Setting up D1, KV, R2' },
  { id: 'provision-dos', label: 'Provisioning Durable Objects' },
  { id: 'configure-access', label: 'Configuring Access' },
];

// Optional steps injected only when the user opted into the upgrade. They
// land BEFORE `deploy-route` so the domain + plan are live the moment the
// hostname goes green.
const WORKERS_PAID_STEP: StepTemplate = {
  id: 'activate-workers-paid',
  label: 'Activating Workers Paid plan',
};
function customDomainStep(domain: string): StepTemplate {
  return { id: 'register-domain', label: `Registering ${domain}` };
}

const TAIL_STEPS: ReadonlyArray<StepTemplate> = [
  { id: 'deploy-route', label: 'Deploying to workers.dev' },
  { id: 'ready', label: 'Ready' },
];

const StartBody = z.object({
  agentName: z.string().min(2),
  email: z.string().email(),
  cloudflareToken: z.string().min(20).optional(),
  subdomain: z.string().regex(/^[a-z0-9-]+$/).optional(),
  accessEmails: z.array(z.string().email()).default([]),
  workersPaid: z.boolean().optional(),
  customDomain: z.string().min(3).optional(),
  workersPaidCheckoutId: z.string().optional(),
  domainCheckoutId: z.string().optional(),
});

deploy.post('/start', async (c) => {
  const parsed = StartBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const stepTemplates: StepTemplate[] = [...BASE_STEPS];
  if (parsed.data.workersPaid) stepTemplates.push(WORKERS_PAID_STEP);
  if (parsed.data.customDomain) stepTemplates.push(customDomainStep(parsed.data.customDomain));
  stepTemplates.push(...TAIL_STEPS);

  const id = crypto.randomUUID();
  const state: DeployState = {
    agentName: parsed.data.agentName,
    startedAt: Date.now(),
    steps: stepTemplates.map((s): DeployStep => ({ id: s.id, label: s.label, state: 'pending' })),
  };
  // Persist the upgrade context alongside the deploy state so the SSE stream
  // can render the right copy + the post-deploy hostname can prefer the
  // custom domain when it's been paid for.
  await c.env.SETTINGS.put(
    `deploy:${id}`,
    JSON.stringify({
      ...state,
      customDomain: parsed.data.customDomain,
      workersPaid: parsed.data.workersPaid,
      workersPaidCheckoutId: parsed.data.workersPaidCheckoutId,
      domainCheckoutId: parsed.data.domainCheckoutId,
      // Carry these forward only for the lifetime of this deploy. The SSE
      // stream uses them once during `configure-access`, then they evaporate
      // with the KV record's 1-hour TTL. We don't persist the token anywhere
      // long-lived — the user keeps a copy, the worker forgets.
      cloudflareToken: parsed.data.cloudflareToken,
      ownerEmail: parsed.data.email,
      accessEmails: parsed.data.accessEmails,
    }),
    { expirationTtl: 60 * 60 },
  );
  return c.json({ ok: true, deployId: id, state });
});

// Per-step timings (ms). Lookup is by step id so the optional Workers Paid /
// custom-domain steps don't shift the cadence of the base steps.
const STEP_TIMINGS: Record<string, number> = {
  'validate-token': 400,
  'create-worker': 2_100,
  'setup-storage': 8_700,
  'provision-dos': 4_200,
  'configure-access': 1_500,
  'activate-workers-paid': 3_200,
  'register-domain': 9_500,
  'deploy-route': 6_000,
  ready: 200,
};

// Server-Sent Events stream for the deploy timeline. Drives the UI without polling.
// The stub flips steps green on a sane cadence so the UI motion + states are real
// even before Wrangler is wired in iteration 2.
deploy.get('/:id/stream', async (c) => {
  const id = c.req.param('id');
  const raw = await c.env.SETTINGS.get(`deploy:${id}`);
  if (!raw) return c.json({ error: 'unknown_deploy' }, 404);
  const initial = JSON.parse(raw) as DeployState & {
    customDomain?: string;
    workersPaid?: boolean;
    workersPaidCheckoutId?: string;
    domainCheckoutId?: string;
    cloudflareToken?: string;
    ownerEmail?: string;
    accessEmails?: string[];
  };
  const customDomain = initial.customDomain;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      send('snapshot', initial);

      const cursor: DeployState = { ...initial, steps: [...initial.steps] };
      for (let i = 0; i < cursor.steps.length; i++) {
        const current = cursor.steps[i];
        if (!current) continue;
        const running: DeployStep = { ...current, state: 'running' };
        cursor.steps[i] = running;
        send('step', { index: i, state: running });

        // Real-work hook for `configure-access`: if the token + owner email
        // are present we provision the Access app + policy inline via the
        // shared helper. We don't block the deploy on a CF API failure —
        // failures land in KV as `source: 'stub'` so Settings → Access shows
        // the error and offers a retry button.
        if (current.id === 'configure-access' && initial.cloudflareToken && initial.ownerEmail) {
          try {
            const hostname = customDomain ?? `${cursor.agentName}.workers.dev`;
            await provisionAccess(c.env, {
              agentName: cursor.agentName,
              hostname,
              ownerEmail: initial.ownerEmail,
              extraEmails: initial.accessEmails ?? [],
              cloudflareToken: initial.cloudflareToken,
            });
          } catch (err) {
            console.warn('[deploy] inline access provision skipped', err);
          }
        }

        const ms = STEP_TIMINGS[current.id] ?? 1_000;
        await new Promise((r) => setTimeout(r, ms));
        const done: DeployStep = { ...running, state: 'done', durationMs: ms };
        cursor.steps[i] = done;
        send('step', { index: i, state: done });
      }
      cursor.finishedAt = Date.now();
      // Hostname preference: paid custom domain > workers.dev subdomain.
      cursor.hostname = customDomain ?? `${cursor.agentName}.workers.dev`;
      send('done', cursor);
      await c.env.SETTINGS.put(`deploy:${id}`, JSON.stringify(cursor), { expirationTtl: 60 * 60 });

      // Promote the agent's settings record so Settings → Cloudflare + the
      // sidebar identity reflect the upgrades (no extra round-trip from
      // the client). KV key matches what /api/settings/<agentName> reads.
      const existingRaw = await c.env.SETTINGS.get(`settings:${cursor.agentName}`);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      await c.env.SETTINGS.put(
        `settings:${cursor.agentName}`,
        JSON.stringify({
          ...existing,
          hostname: cursor.hostname,
          customDomain: customDomain ?? null,
          workersPaid: initial.workersPaid ?? false,
          plan: initial.workersPaid ? 'workers_paid' : 'free',
          deployedAt: cursor.finishedAt,
        }),
      );

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
});

deploy.get('/:id', async (c) => {
  const id = c.req.param('id');
  const raw = await c.env.SETTINGS.get(`deploy:${id}`);
  if (!raw) return c.json({ error: 'unknown_deploy' }, 404);
  return c.json(JSON.parse(raw));
});

// Retry a deploy from the first errored step. Resets every step at and
// after the error to `pending` and bumps `startedAt` so the stream
// endpoint re-issues fresh snapshots. The actual re-execution is the
// stream's job — this just rewinds state. Idempotent: re-running on a
// fully done deploy is a no-op.
deploy.post('/:id/retry', async (c) => {
  const id = c.req.param('id');
  const raw = await c.env.SETTINGS.get(`deploy:${id}`);
  if (!raw) return c.json({ ok: false, error: 'unknown_deploy' }, 404);
  let state: DeployState;
  try {
    state = JSON.parse(raw) as DeployState;
  } catch {
    return c.json({ ok: false, error: 'corrupt_snapshot' }, 500);
  }
  const firstErrorIdx = state.steps.findIndex((s) => s.state === 'error');
  if (firstErrorIdx < 0) {
    // Nothing to retry — return ok so the client doesn't error-out.
    return c.json({ ok: true, retried: 0 });
  }
  state.steps = state.steps.map((s: DeployStep, i: number) =>
    i >= firstErrorIdx ? { ...s, state: 'pending' as const, durationMs: undefined, error: undefined } : s,
  );
  state.startedAt = Date.now();
  await c.env.SETTINGS.put(`deploy:${id}`, JSON.stringify(state), {
    expirationTtl: 60 * 60 * 24 * 7,
  });
  return c.json({ ok: true, retried: state.steps.length - firstErrorIdx });
});
