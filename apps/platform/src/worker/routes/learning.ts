import { Hono } from 'hono';

import type { Env, Variables } from '../env';

export const learning = new Hono<{ Bindings: Env; Variables: Variables }>();

// Stubs for the Learning page. Real surfaces (skills + memories + rubrics + suggestions)
// arrive with iteration 6+.
learning.get('/summary', (c) =>
  c.json({
    skills: { total: 4, pinned: 2 },
    memories: { total: 0, byCategory: { user_facts: 0, active_work: 0, preferences: 0, domain_knowledge: 0, people: 0 } },
    rubrics: { total: 1, defaultId: 'default' },
    pending: { count: 0 },
  }),
);

learning.get('/pending', (c) =>
  c.json({
    pending: [],
  }),
);
