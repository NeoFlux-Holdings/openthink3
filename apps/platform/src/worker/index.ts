import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';

import type { Env, Variables } from './env';
import { onboarding } from './routes/onboarding';
import { deploy } from './routes/deploy';
import { chat } from './routes/chat';
import { artifacts } from './routes/artifacts';
import { skills as skillsRoute } from './routes/skills';
import { learning } from './routes/learning';
import { settings } from './routes/settings';
import { cfTokenScopes } from './routes/cf-token';
import { sync } from './routes/sync';
import { stripe } from './routes/stripe';
import { browserSessions } from './routes/browser';

export { Orchestrator } from './agents/orchestrator';
export { Researcher } from './agents/researcher';
export { Coder } from './agents/coder';
export { MemoryAgent } from './agents/memory-agent';
export { Judge } from './agents/judge';
export { BrowserSession } from './agents/browser-session';
export { GoalWorkflow } from './workflows/goal';
export { RetrainingWorkflow } from './workflows/retraining';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', logger());
app.use('*', cors({ origin: '*', credentials: true }));

app.use('*', async (c, next) => {
  c.set('requestId', crypto.randomUUID());
  await next();
});

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    version: c.env.OPENTHINK_VERSION,
    ts: Date.now(),
  }),
);

app.route('/api/onboarding', onboarding);
app.route('/api/deploy', deploy);
app.route('/api/chat', chat);
app.route('/api/artifacts', artifacts);
app.route('/api/skills', skillsRoute);
app.route('/api/learning', learning);
app.route('/api/settings', settings);
app.route('/api/cf-token', cfTokenScopes);
app.route('/api/sync', sync);
app.route('/api/stripe', stripe);
app.route('/api/browser', browserSessions);

// WebSocket upgrade — routes to the orchestrator DO for a given agent.
app.get('/agents/:agentId/ws', async (c) => {
  const upgrade = c.req.header('Upgrade');
  if (upgrade !== 'websocket') {
    return new Response('Expected websocket', { status: 426 });
  }
  const agentId = c.req.param('agentId');
  const id = c.env.ORCHESTRATOR.idFromName(agentId);
  const stub = c.env.ORCHESTRATOR.get(id);
  // c.req.raw is a fetch Request; the DO stub accepts the same.
  return stub.fetch(c.req.raw as unknown as Request);
});

// SPA fallback — serve the static UI bundle for any non-API GET.
app.get('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw as unknown as Request);
});

app.onError((err, c) => {
  console.error('[openthink] unhandled error', err);
  return c.json({ error: 'internal_error', requestId: c.get('requestId') }, 500);
});

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<unknown>, env: Env, _ctx: ExecutionContext) {
    const { handleTrajectoryQueue } = await import('./queues/trajectories');
    await handleTrajectoryQueue(batch, env);
  },
  // Daily 08:00 UTC cron — kicks the per-agent retraining Workflow for every
  // active agent. The Workflow short-circuits if no fresh trajectories exist.
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const agents = await env.DB.prepare('SELECT id FROM agents').all<{ id: string }>();
        for (const row of agents.results) {
          await env.RETRAIN_WORKFLOW.create({
            id: `retrain-${row.id}-${Date.now()}`,
            params: { agentId: row.id, windowHours: 24, scoreThreshold: 0.6 },
          });
        }
      })(),
    );
  },
};
