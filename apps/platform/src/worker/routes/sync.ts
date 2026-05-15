import { Hono } from 'hono';

import type { Env, Variables } from '../env';

export const sync = new Hono<{ Bindings: Env; Variables: Variables }>();

// Iteration 6 ships a deterministic stub for /api/sync/status so the Settings
// → Sync panel renders against shape-correct data. The live implementation in
// iteration 8 polls GitHub via the user's token (stored as a Workers Secret)
// and persists the last seen SHA in KV so the nightly Workflow can short-circuit
// when no drift has accumulated.

sync.get('/status', (c) => {
  // In dev we synthesize three "ahead" commits so the panel renders the
  // dry-run path. Behind-the-scenes the production polling Workflow caches
  // this snapshot in KV under `sync:status:<agentId>`.
  return c.json({
    upstreamSha: 'e593b06',
    localSha: '24cbc5b',
    ahead: 0,
    behind: 3,
    summary:
      "Three commits since your local: the canvas grew eight artifact types, train mode landed with a Save-as-skill diff, and the WS bridge now falls back to a local echo when the Worker isn't reachable.",
    lastChecked: Date.now() - 4 * 60_000,
    commits: [
      {
        sha: 'e593b06',
        author: 'tzarebczan',
        message: 'WS bridge: shell ↔ orchestrator with graceful local-echo fallback',
        ts: Date.now() - 30 * 60_000,
      },
      {
        sha: '492f6b5',
        author: 'tzarebczan',
        message: 'train mode plan card + library/skills/learning/settings pages',
        ts: Date.now() - 90 * 60_000,
      },
      {
        sha: '0ce2681',
        author: 'tzarebczan',
        message: 'artifact canvas: 8 types, 3 window modes, thumbnail strip',
        ts: Date.now() - 180 * 60_000,
      },
    ],
    recentPRs: [],
  });
});

sync.post('/pull', async (c) => {
  // Dry-run: synthesize a minimal diff in dev. In production this stands up a
  // Cloudflare Sandbox, performs a real `git fetch` + 3-way merge, and returns
  // the unified diff for user approval before applying.
  return c.json({
    ok: true,
    diff: SAMPLE_DIFF,
  });
});

sync.post('/apply', async (c) => {
  // The user has accepted the dry-run: redeploy via wrangler versioned routes
  // with zero downtime. Iteration 8 wires this to the Cloudflare API.
  return c.json({ ok: true, deployVersion: 'v2026-05-15-1', status: 'queued' });
});

sync.post('/propose-pr', async (c) => {
  // Agent-authored PR back to upstream. The PRD §5 commit-author rule applies:
  // committer = the user, author = deployment-specific agent email, no Claude
  // attribution in the message or trailer. Iteration 7 dispatches this through
  // the GitHub MCP server.
  const body = (await c.req.json().catch(() => ({}))) as {
    skillId?: string;
    title?: string;
    body?: string;
  };
  if (!body.skillId || !body.title) {
    return c.json({ ok: false, error: 'missing_fields' }, 400);
  }
  return c.json({
    ok: true,
    prUrl: `https://github.com/NeoFlux-Holdings/openthink3/pull/draft-${Math.floor(Math.random() * 1_000)}`,
    branch: `agent/skill-${body.skillId}`,
    state: 'draft',
  });
});

const SAMPLE_DIFF = `--- a/apps/platform/src/web/shell/canvas/Canvas.tsx
+++ b/apps/platform/src/web/shell/canvas/Canvas.tsx
@@ -42,6 +42,9 @@ export function Canvas({ artifacts, agentName }: Props) {
       <header className="canvas__header">
         <span className="canvas__title">
           {mode === 'single' && active ? active.title : 'Artifacts'}
         </span>
+        {hasUpdates && (
+          <span className="ot-pill ot-pill--accent">sync available</span>
+        )}
         <div className="canvas__mode" role="tablist" aria-label="Canvas window mode">
--- a/apps/platform/src/worker/agents/browser-session.ts
+++ b/apps/platform/src/worker/agents/browser-session.ts
@@ -1,3 +1,18 @@
-import { BaseRpcAgent } from './base-rpc-agent';
+import { BaseRpcAgent } from './base-rpc-agent';
+import type { BrowserBinding } from '../env';
+import type { BrowserFrame } from '@openthink/browser';

-// BrowserSession — wraps a live Browser Rendering instance. Stub for iteration 1.
+// BrowserSession — wraps a live Cloudflare Browser Rendering instance.
+// Streams screenshots over WS at 4-6 fps; persists state in DO SQLite so the
+// session survives Worker restarts.`;
