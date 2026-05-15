import { Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../env';
import { generateAgentName } from '../../shared/agent-names';

export const onboarding = new Hono<{ Bindings: Env; Variables: Variables }>();

const IdentityBody = z.object({
  email: z.string().email(),
  agentName: z.string().min(2).max(40).optional(),
});

onboarding.post('/identity', async (c) => {
  const parsed = IdentityBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const agentName = parsed.data.agentName ?? generateAgentName();
  return c.json({ ok: true, agentName, email: parsed.data.email });
});

onboarding.get('/suggest-name', (c) => {
  return c.json({ name: generateAgentName() });
});
