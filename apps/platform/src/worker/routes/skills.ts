import { Hono } from 'hono';

import type { Env, Variables } from '../env';
import type { Skill } from '../../shared/types';

export const skills = new Hono<{ Bindings: Env; Variables: Variables }>();

// Iteration 1 ships a static catalog of skill stubs so the UI Settings → Skills
// page can render real cards. The live registry (D1 + Vectorize) lands in iteration 6.

const SKILL_CATALOG: Skill[] = [
  {
    id: 'cloudflare-workers',
    name: 'cloudflare-workers',
    description: 'Build and deploy Cloudflare Workers.',
    source: 'cloudflare',
    version: '1.0.0',
    enabled: true,
    whenToUse: 'User mentions Workers, wrangler, edge deployment.',
    tags: ['cloudflare', 'workers'],
    hasWorkflow: false,
  },
  {
    id: 'agents-sdk',
    name: 'agents-sdk',
    description: 'Use the Cloudflare Agents SDK.',
    source: 'cloudflare',
    version: '1.0.0',
    enabled: true,
    whenToUse: 'User mentions Durable Objects, AIChatAgent, McpAgent.',
    tags: ['cloudflare', 'agents'],
    hasWorkflow: false,
  },
  {
    id: 'skill-creator',
    name: 'skill-creator',
    description: 'Create new agent skills.',
    source: 'anthropic',
    version: '1.0.0',
    enabled: false,
    whenToUse: 'User asks to create or edit a skill.',
    tags: ['meta'],
    hasWorkflow: false,
  },
  {
    id: 'frontend-design',
    name: 'frontend-design',
    description: 'Master-level UI/UX implementation.',
    source: 'anthropic',
    version: '1.0.0',
    enabled: false,
    whenToUse: 'User asks for polished UI, interactive flows, or design polish.',
    tags: ['frontend', 'design'],
    hasWorkflow: false,
  },
];

skills.get('/', (c) => c.json({ skills: SKILL_CATALOG }));

skills.post('/:id/toggle', async (c) => {
  const target = SKILL_CATALOG.find((s) => s.id === c.req.param('id'));
  if (!target) return c.json({ error: 'unknown_skill' }, 404);
  target.enabled = !target.enabled;
  return c.json({ ok: true, skill: target });
});
