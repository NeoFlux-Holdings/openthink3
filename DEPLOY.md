# Deploying OpenThink

The platform Worker is the deployable unit. Each user gets one. This guide walks
through deploying *the upstream platform* — the marketing + sign-up surface that
provisions per-user Workers. Per-user provisioning lands in iteration 6 alongside
the Stripe Projects integration.

## Prerequisites

- A Cloudflare account
- A Cloudflare API token with the scopes listed in `apps/platform/src/shared/cf-token.ts` (the same set the in-app onboarding URL pre-fills)
- `pnpm` 9 and `node` 20+

## Local development

```sh
pnpm install
pnpm --filter @openthink/platform run dev:web      # Vite UI on :5180
pnpm --filter @openthink/platform run dev:worker   # Wrangler dev on :8787
```

The UI proxies `/api/*` and `/agents/*` to the Worker via Vite's dev server. The
Shell shows a `live` chip in the thread feed header when the WS bridge is up; if
no Worker is running, it falls back to a local echo and shows `local echo`.

## Production deploy

```sh
pnpm --filter @openthink/platform run build       # Vite -> dist/, Wrangler dry-run
pnpm --filter @openthink/platform run deploy      # Wrangler push
```

You'll need to fill in the `placeholder-set-by-provisioner` IDs in
`apps/platform/wrangler.toml` for D1 + KV. Create them with:

```sh
pnpm exec wrangler d1 create openthink
pnpm exec wrangler kv namespace create SETTINGS
pnpm exec wrangler r2 bucket create openthink-artifacts
pnpm exec wrangler vectorize create openthink-memories --preset @cf/baai/bge-base-en-v1.5
pnpm exec wrangler queues create openthink-trajectories
```

Copy each returned ID into wrangler.toml. Then apply the D1 migrations:

```sh
pnpm exec wrangler d1 migrations apply openthink
```

## Bindings the Worker expects

| Binding | Purpose | Created by |
|---|---|---|
| `ORCHESTRATOR` | Chat DO (one per agent) | `wrangler.toml` |
| `RESEARCHER` / `CODER` / `MEMORY_AGENT` / `JUDGE` / `BROWSER_SESSION` | Specialist DOs | `wrangler.toml` |
| `DB` | D1 — trajectories, audit, policies | `wrangler d1 create openthink` |
| `ARTIFACTS` | R2 — blob storage for artifact payloads | `wrangler r2 bucket create openthink-artifacts` |
| `SETTINGS` | KV — hot per-user settings | `wrangler kv namespace create SETTINGS` |
| `MEMORIES` | Vectorize — semantic memory index | `wrangler vectorize create openthink-memories ...` |
| `TRAJECTORIES` | Queue — async trajectory writeback | `wrangler queues create openthink-trajectories` |
| `GOAL_WORKFLOW` | Workflow — /goal long runs | declared in `wrangler.toml` |
| `AI` | Workers AI | platform binding |
| `BROWSER` | Browser Rendering | platform binding |

## Acceptance criteria (from PRD §20)

- New user (no CF, no GitHub) lands on `openthink.run`, pays $12, has a live agent **< 90s wall-clock**.
- CF-token user deploys **< 60s**.
- Browser Session streams **≥ 4 fps** with **< 500ms** take-over handoff.
- Train-mode skill creation, accept, and reuse cycle **< 60s end-to-end**.
- Upstream pull with three commits of drift completes **< 120s**, visible diff before commit.
- 30-day chaos test passes: Worker restarts, DO migrations, model swaps, network drops — conversations resume.
- **Zero Claude/model attribution** on any commit authored by the agent.
- Total monthly CF bill for a hobbyist single-agent user **< $5**.

## Iteration status

- ✓ Iteration 1 — monorepo scaffold
- ✓ Iteration 2 — onboarding (identity, fork, token, Stripe) + deploy progress
- ✓ Iteration 3 — artifact canvas (8 types, 3 window modes, thumbnail strip)
- ✓ Iteration 4 — train mode plan card, save-as-skill sheet, library/skills/learning/settings pages
- ✓ Iteration 5 — WS bridge wired (graceful fallback to local echo when Worker is down)
- ◐ Iteration 6 — Sync panel + PR-back upstream
- ◯ Iteration 7 — Stripe Projects + MPP runtime payments
- ◯ Iteration 8 — Browser Session DO wired to CF Browser Rendering
- ◯ Iteration 9 — Self-evolution loop + judge scoring + nightly retraining Workflow
- ◯ Iteration 10 — E2E polish + acceptance criteria + final design pass
