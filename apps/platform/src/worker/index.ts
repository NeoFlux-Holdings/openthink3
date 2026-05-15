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

export { Orchestrator } from './agents/orchestrator';
export { Researcher } from './agents/researcher';
export { Coder } from './agents/coder';
export { MemoryAgent } from './agents/memory-agent';
export { Judge } from './agents/judge';
export { BrowserSession } from './agents/browser-session';
export { GoalWorkflow } from './workflows/goal';

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

// WebSocket upgrade — routes to the orchestrator DO for a given agent.
app.get('/agents/:agentId/ws', async (c) => {
  const upgrade = c.req.header('Upgrade');
  if (upgrade !== 'websocket') {
    return c.text('Expected websocket', 426);
  }
  const agentId = c.req.param('agentId');
  const id = c.env.ORCHESTRATOR.idFromName(agentId);
  const stub = c.env.ORCHESTRATOR.get(id);
  return stub.fetch(c.req.raw);
});

// SPA fallback.
app.get('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
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
};
