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
import { cfDomain } from './routes/cf-domain';
import { upgrades } from './routes/upgrades';
import { knowledge } from './routes/knowledge';
import { invocations } from './routes/invocations';
import { cfAccess } from './routes/cf-access';
import { workspaces } from './routes/workspaces';
import { audit } from './routes/audit';
import { goal } from './routes/goal';
import { threads } from './routes/threads';
import { mobile } from './routes/mobile';

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

// Surface the worker's live binding state so Settings → Cloudflare can
// render a definitive "what's actually plumbed in" panel. Each entry
// reports whether the named binding is present in `env`; the kind
// determines the visual treatment in the UI. Cheap — synchronous
// `in env` checks, no fetches.
// Live ping of the Workers AI binding — used by Settings → Cloudflare
// to give the user proof their AI binding is reachable and roughly how
// fast. Same 3.5s Promise.race timeout the orchestrator uses so a hung
// model can't lock the UI. Returns latencyMs + a short sample reply.
app.post('/api/cf-bindings/ping-ai', async (c) => {
  if (!c.env.AI) {
    return c.json({ ok: false, error: 'binding_unbound' }, 400);
  }
  const start = Date.now();
  try {
    const result = (await Promise.race([
      c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: 'You are a terse health-check probe.' },
          { role: 'user', content: 'Reply with exactly: "ok"' },
        ],
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('ai_timeout')), 3_500),
      ),
    ])) as { response?: string };
    return c.json({
      ok: true,
      latencyMs: Date.now() - start,
      model: '@cf/meta/llama-3.1-8b-instruct',
      sample: (result.response ?? '').slice(0, 60),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const kind = /ai_timeout/i.test(msg)
      ? 'timeout'
      : /Invalid access token|Not logged in|9109/i.test(msg)
        ? 'auth_expired'
        : 'unreachable';
    return c.json(
      { ok: false, latencyMs: Date.now() - start, error: kind, detail: msg },
      502,
    );
  }
});

app.get('/api/cf-bindings', (c) => {
  const e = c.env as unknown as Record<string, unknown>;
  const present = (k: string) => e[k] != null;
  const bindings = [
    { kind: 'do', name: 'ORCHESTRATOR', label: 'Orchestrator DO', bound: present('ORCHESTRATOR') },
    { kind: 'do', name: 'RESEARCHER', label: 'Researcher DO', bound: present('RESEARCHER') },
    { kind: 'do', name: 'CODER', label: 'Coder DO', bound: present('CODER') },
    { kind: 'do', name: 'MEMORY_AGENT', label: 'MemoryAgent DO', bound: present('MEMORY_AGENT') },
    { kind: 'do', name: 'JUDGE', label: 'Judge DO', bound: present('JUDGE') },
    { kind: 'do', name: 'BROWSER_SESSION', label: 'BrowserSession DO', bound: present('BROWSER_SESSION') },
    { kind: 'workflow', name: 'GOAL_WORKFLOW', label: 'GoalWorkflow', bound: present('GOAL_WORKFLOW') },
    { kind: 'workflow', name: 'RETRAIN_WORKFLOW', label: 'RetrainingWorkflow', bound: present('RETRAIN_WORKFLOW') },
    { kind: 'kv', name: 'SETTINGS', label: 'SETTINGS KV', bound: present('SETTINGS') },
    { kind: 'd1', name: 'DB', label: 'D1 (openthink)', bound: present('DB') },
    { kind: 'r2', name: 'ARTIFACTS', label: 'R2 (openthink-artifacts)', bound: present('ARTIFACTS') },
    { kind: 'queue', name: 'TRAJECTORIES', label: 'Trajectories queue', bound: present('TRAJECTORIES') },
    { kind: 'ai', name: 'AI', label: 'Workers AI', bound: present('AI') },
    { kind: 'browser', name: 'BROWSER', label: 'Browser Rendering', bound: present('BROWSER') },
    { kind: 'vectorize', name: 'MEMORIES', label: 'Vectorize (memories)', bound: present('MEMORIES') },
    { kind: 'sandbox', name: 'SANDBOX', label: 'Sandbox (exec)', bound: present('SANDBOX') },
  ];
  return c.json({
    version: c.env.OPENTHINK_VERSION,
    bindings,
    bound: bindings.filter((b) => b.bound).length,
    optional: bindings.filter((b) => !b.bound).length,
  });
});

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
app.route('/api/cf-domain', cfDomain);
app.route('/api/upgrades', upgrades);
app.route('/api/knowledge', knowledge);
app.route('/api/invocations', invocations);
app.route('/api/access', cfAccess);
app.route('/api/workspaces', workspaces);
app.route('/api/audit', audit);
app.route('/api/goal', goal);
app.route('/api/threads', threads);
app.route('/api/mobile', mobile);

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
