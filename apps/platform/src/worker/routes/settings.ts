import { Hono } from 'hono';

import type { Env, Variables } from '../env';

export const settings = new Hono<{ Bindings: Env; Variables: Variables }>();

settings.get('/:agentId', async (c) => {
  const raw = await c.env.SETTINGS.get(`settings:${c.req.param('agentId')}`);
  return c.json(raw ? JSON.parse(raw) : null);
});

settings.put('/:agentId', async (c) => {
  const body = await c.req.json();
  await c.env.SETTINGS.put(`settings:${c.req.param('agentId')}`, JSON.stringify(body));
  return c.json({ ok: true });
});
