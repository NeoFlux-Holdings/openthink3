// Cloudflare bindings declared in wrangler.toml.
// We deliberately use local interface declarations for primitives whose exact
// shapes vary between @cloudflare/workers-types versions — that decouples this
// file from the SDK churn until iteration 6 binds the Agents SDK directly.

import type {
  D1Database,
  DurableObjectNamespace,
  KVNamespace,
  R2Bucket,
  Queue,
  Fetcher,
  Ai,
  VectorizeIndex,
} from '@cloudflare/workers-types';

// BrowserWorker isn't exported by all workers-types vintages. The runtime binding
// is fetch-compatible (used by puppeteer-cloudflare under the hood), so a Fetcher
// is structurally sound for our usage.
export type BrowserBinding = Fetcher;

export interface Env {
  // Static assets
  ASSETS: Fetcher;

  // Durable Objects
  ORCHESTRATOR: DurableObjectNamespace;
  RESEARCHER: DurableObjectNamespace;
  CODER: DurableObjectNamespace;
  MEMORY_AGENT: DurableObjectNamespace;
  JUDGE: DurableObjectNamespace;
  BROWSER_SESSION: DurableObjectNamespace;

  // Storage
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  SETTINGS: KVNamespace;
  // Vectorize binding is optional locally — see wrangler.toml comment near the
  // [[vectorize]] block. Uncomment it there before deploying to production.
  MEMORIES?: VectorizeIndex;

  // Async
  TRAJECTORIES: Queue;
  GOAL_WORKFLOW: {
    create(opts: { id?: string; params: unknown }): Promise<{ id: string }>;
    get(id: string): Promise<unknown>;
  };
  RETRAIN_WORKFLOW: {
    create(opts: { id?: string; params: unknown }): Promise<{ id: string }>;
    get(id: string): Promise<unknown>;
  };

  // AI + Browser
  AI: Ai;
  // BROWSER binding is commented out of wrangler.toml for local dev (Browser
  // Rendering has no miniflare emulator). Re-enable for production.
  BROWSER?: BrowserBinding;

  // Vars
  OPENTHINK_VERSION: string;
  OPENTHINK_UPSTREAM_REPO?: string;

  // Secrets (set via `wrangler secret put`)
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GITHUB_TOKEN?: string;
  CLOUDFLARE_API_TOKEN?: string;
  STRIPE_API_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_DOMAIN?: string;
  STRIPE_PRICE_WORKERS_PAID?: string;
}

export interface Variables {
  agentId?: string;
  userId?: string;
  requestId: string;
}
