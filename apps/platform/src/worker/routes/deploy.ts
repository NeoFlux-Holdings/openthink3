import { Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../env';
import type { DeployState, DeployStep } from '../../shared/types';

export const deploy = new Hono<{ Bindings: Env; Variables: Variables }>();

// In iteration 1 the deploy endpoint is a deterministic dry-run that drives the UI
// timeline. The real Wrangler-driven provisioner lands in iteration 2 alongside
// the CF token validator (see tools/cf-token).

const DEFAULT_STEPS: ReadonlyArray<Pick<DeployStep, 'id' | 'label'>> = [
  { id: 'validate-token', label: 'Validating Cloudflare token' },
  { id: 'create-worker', label: 'Creating Worker' },
  { id: 'setup-storage', label: 'Setting up D1, KV, R2' },
  { id: 'provision-dos', label: 'Provisioning Durable Objects' },
  { id: 'configure-access', label: 'Configuring Access' },
  { id: 'deploy-route', label: 'Deploying to workers.dev' },
  { id: 'ready', label: 'Ready' },
];

const StartBody = z.object({
  agentName: z.string().min(2),
  email: z.string().email(),
  cloudflareToken: z.string().min(20).optional(),
  subdomain: z.string().regex(/^[a-z0-9-]+$/).optional(),
  accessEmails: z.array(z.string().email()).default([]),
});

deploy.post('/start', async (c) => {
  const parsed = StartBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const id = crypto.randomUUID();
  const state: DeployState = {
    agentName: parsed.data.agentName,
    startedAt: Date.now(),
    steps: DEFAULT_STEPS.map((s) => ({ ...s, state: 'pending' })),
  };
  await c.env.SETTINGS.put(`deploy:${id}`, JSON.stringify(state), { expirationTtl: 60 * 60 });
  return c.json({ ok: true, deployId: id, state });
});

// Server-Sent Events stream for the deploy timeline. Drives the UI without polling.
// The stub flips steps green on a sane cadence so the UI motion + states are real
// even before Wrangler is wired in iteration 2.
deploy.get('/:id/stream', async (c) => {
  const id = c.req.param('id');
  const raw = await c.env.SETTINGS.get(`deploy:${id}`);
  if (!raw) return c.json({ error: 'unknown_deploy' }, 404);
  const initial = JSON.parse(raw) as DeployState;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      send('snapshot', initial);

      // Walk through the steps with realistic-ish timings.
      const timings = [400, 2_100, 8_700, 4_200, 1_500, 6_000, 200];
      let cursor = { ...initial };
      for (let i = 0; i < cursor.steps.length; i++) {
        cursor.steps[i] = { ...cursor.steps[i], state: 'running' };
        send('step', { index: i, state: cursor.steps[i] });
        await new Promise((r) => setTimeout(r, timings[i] ?? 1_000));
        cursor.steps[i] = {
          ...cursor.steps[i],
          state: 'done',
          durationMs: timings[i] ?? 1_000,
        };
        send('step', { index: i, state: cursor.steps[i] });
      }
      cursor.finishedAt = Date.now();
      cursor.hostname = `${cursor.agentName}.workers.dev`;
      send('done', cursor);
      await c.env.SETTINGS.put(`deploy:${id}`, JSON.stringify(cursor), { expirationTtl: 60 * 60 });
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
