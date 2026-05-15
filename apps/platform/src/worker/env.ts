// Cloudflare bindings declared in wrangler.toml.
// Regenerate with `pnpm cf-typegen` after editing wrangler.toml.

import type {
  D1Database,
  DurableObjectNamespace,
  KVNamespace,
  R2Bucket,
  Queue,
  Fetcher,
  Ai,
  VectorizeIndex,
  BrowserWorker,
} from '@cloudflare/workers-types';

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
  MEMORIES: VectorizeIndex;

  // Async
  TRAJECTORIES: Queue;
  GOAL_WORKFLOW: {
    create(opts: { id?: string; params: unknown }): Promise<{ id: string }>;
    get(id: string): Promise<unknown>;
  };

  // AI + Browser
  AI: Ai;
  BROWSER: BrowserWorker;

  // Vars
  OPENTHINK_VERSION: string;

  // Secrets (set via `wrangler secret put`)
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GITHUB_TOKEN?: string;
  CLOUDFLARE_API_TOKEN?: string;
}

export interface Variables {
  agentId?: string;
  userId?: string;
  requestId: string;
}
