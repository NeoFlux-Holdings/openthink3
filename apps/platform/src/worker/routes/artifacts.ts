import { Hono } from 'hono';

import type { Env, Variables } from '../env';

export const artifacts = new Hono<{ Bindings: Env; Variables: Variables }>();

artifacts.get('/:id', async (c) => {
  const obj = await c.env.ARTIFACTS.get(c.req.param('id'));
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

artifacts.put('/:id', async (c) => {
  const body = await c.req.arrayBuffer();
  await c.env.ARTIFACTS.put(c.req.param('id'), body, {
    httpMetadata: { contentType: c.req.header('Content-Type') ?? 'application/octet-stream' },
  });
  return c.json({ ok: true });
});
