import { Hono } from 'hono';

import type { Env, Variables } from '../env';
import { buildTokenUrl, CANONICAL_SCOPES } from '../../shared/cf-token';

export const cfTokenScopes = new Hono<{ Bindings: Env; Variables: Variables }>();

cfTokenScopes.get('/url', (c) => {
  const name = c.req.query('name') ?? 'Open Think - My Personal Agent';
  return c.json({ url: buildTokenUrl(name), scopes: CANONICAL_SCOPES });
});

cfTokenScopes.post('/validate', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { token?: string };
  const token = body.token;
  if (!token || token.length < 20) {
    return c.json({ ok: false, error: 'token_too_short' }, 400);
  }
  // Real validation: hit /user/tokens/verify with the token.
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as { success: boolean; result?: { status?: string }; errors?: unknown };
    if (!res.ok || !data.success) {
      return c.json({ ok: false, error: 'verify_failed', upstream: data }, 400);
    }
    return c.json({ ok: true, status: data.result?.status ?? 'active' });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : 'unknown' }, 502);
  }
});
