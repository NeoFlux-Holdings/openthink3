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
pnpm --filter @openthink/platform run build:web          # build the UI once
pnpm --filter @openthink/platform run dev:worker         # wrangler dev on :8787

# one-time, before the trajectories queue can persist:
pnpm --filter @openthink/platform exec wrangler d1 migrations apply openthink --local

# Workers AI hits the real CF API even from miniflare — fresh OAuth required:
pnpm --filter @openthink/platform exec wrangler login
```

The worker now serves both `/api/*` and the static UI from its `[assets]` block,
so you can point a browser at `http://127.0.0.1:8787` and you've got the whole
app. The Shell shows a `live` chip in the thread feed header when the WS bridge
is up; if no Worker is running, the UI falls back to a local echo and shows
`local echo`.

If chat replies say _"the local wrangler OAuth token has expired"_, re-run
`wrangler login` — the workers-ai binding requires the local CF auth even though
everything else (D1, KV, R2, Queues, DOs) is fully simulated by miniflare.

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

## Optional production-only bindings

Both are commented out in `wrangler.toml` so local dev (miniflare) boots
cleanly. Re-enable for production:

```toml
[browser]
binding = "BROWSER"

[[vectorize]]
binding = "MEMORIES"
index_name = "openthink-memories"
```

`BROWSER` powers `BrowserSession` screenshot streaming. The runtime imports
`@cloudflare/puppeteer` lazily — install it before deploy:

```sh
pnpm --filter @openthink/platform add @cloudflare/puppeteer
```

It's listed as an `optionalDependency` so `pnpm install` doesn't fail in
environments that can't fetch it (CI sandboxes, etc.). The DO falls back to
the placeholder-frame path when the import fails.

## Secrets

Bind via `wrangler secret put` (or via CI — see
`.github/workflows/agent-deploy.yml`).

| Secret | Required for | Notes |
|---|---|---|
| `STRIPE_API_KEY` | Live `/api/stripe/checkout` and upgrades | Test or live mode |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verify | Without this dev accepts unverified payloads with a warn log |
| `STRIPE_PRICE_DOMAIN` / `STRIPE_PRICE_WORKERS_PAID` | Mapping checkout line items to Stripe Price IDs | Per-deployment |
| `GITHUB_TOKEN` | `/api/sync` real path (status, pull, propose-pr) | Needs `repo` scope on the user's fork |
| `CLOUDFLARE_API_TOKEN` | `GoalWorkflow` Stripe-Projects branch + Access provisioning fallback | Same token the user pasted during onboarding |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Optional providers when the user opts out of Workers AI | Only read if the Behavior tab's `model` picks the matching provider |

## Continuous deployment

Two GitHub Actions workflows ship in `.github/workflows/`:

- **`agent-deploy.yml`** — runs on every push to `main` in the user's
  fork. Installs, typechecks, builds the web bundle, applies remote D1
  migrations, ships via `wrangler deploy`, binds any secrets that
  changed, smoke-tests `/api/health`, then bumps the `sync:local-sha`
  KV key to the new HEAD. Concurrency-cancelled on consecutive pushes.

- **`agent-update.yml`** — daily at 09:00 UTC + manual trigger. Detects
  drift between the fork and `vars.OPENTHINK_UPSTREAM_REPO` (default
  `NeoFlux-Holdings/openthink3`), creates a `agent/upstream-sync-<run>`
  branch with the 3-way merge result, and opens a draft PR with the
  upstream commit list as the body. The user reviews and merges; that
  push fires `agent-deploy.yml` and the new code lands.

Required CI secrets:

| Secret | Required for | Notes |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | `wrangler deploy` | needs `workers_scripts:edit` + everything in `apps/platform/src/shared/cf-token.ts` |
| `CLOUDFLARE_ACCOUNT_ID` | `wrangler deploy` | account the agent ships to |
| `CLOUDFLARE_WORKERS_SUBDOMAIN` | Smoke-test step | your account's workers.dev subdomain |
| `AGENT_BOT_PAT` | `agent-update.yml` | fine-grained PAT with `contents:write` + `pull_requests:write` |
| `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `GITHUB_TOKEN_AGENT` | rebinding as worker secrets | optional |

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

## Verified end-to-end against `wrangler dev --local`

Worker boots clean against the placeholders in `wrangler.toml`, every surface returns 200 OK, the WS bridge round-trips through the Orchestrator DO. Verified via `curl` + a Node WebSocket client + the chrome-connector preview at `http://127.0.0.1:8787`:

| Surface | Path | Verified |
|---|---|---|
| Health | `GET /api/health` | 200, version returned |
| Orchestrator DO RPC | `GET/POST /api/chat/<a>/threads` | CRUD round-trip via DO SQLite |
| Chat WS | `GET /agents/<a>/ws` | open → send → user-echo + assistant frame |
| Chat persistence | shell reload | history survives via DO SQLite |
| Skills | `GET /api/skills`, `POST /api/skills/<id>/toggle` | stateful toggle |
| Learning | `GET /api/learning/summary`, `/pending` | shape-correct responses |
| Settings | `PUT/GET /api/settings/<a>` | KV round-trip |
| Deploy | `POST /api/deploy/start` + `GET /api/deploy/<id>/stream` | SSE: snapshot + 7 step events |
| Sync | `GET /api/sync/status`, `POST /api/sync/{pull,apply,propose-pr}` | mock diff + PR shape |
| Stripe | `POST /api/stripe/{checkout,webhook}`, `GET /api/stripe/spend/<a>` | accepted, webhook event handled |
| CF token | `GET /api/cf-token/url`, `POST /api/cf-token/validate` | URL builder works; validate rejects bogus tokens (400) |
| Artifacts | `PUT/GET /api/artifacts/<k>` | R2 round-trip |
| Browser session WS | `GET /api/browser/<sid>/ws` | open + initial state + spawn ack |
| Train mode UX | chrome connector | Train → send → 7-step plan → approve → save-as-skill sheet with diff |
| Onboarding UX | chrome connector | server-generated agent name, token URL pre-filled |
| `wrangler deploy --dry-run` | bundle | 278 KiB / 55 KiB gzip, all bindings resolved |

## Iteration status

- ✓ Iteration 1 — monorepo scaffold
- ✓ Iteration 2 — onboarding (identity, fork, token, Stripe) + deploy progress
- ✓ Iteration 3 — artifact canvas (8 types, 3 window modes, thumbnail strip)
- ✓ Iteration 4 — train mode plan card, save-as-skill sheet, library/skills/learning/settings pages
- ✓ Iteration 5 — WS bridge wired (graceful fallback to local echo when Worker is down)
- ✓ Iteration 6 — Sync panel + PR-back upstream
- ✓ Iteration 7 — Stripe Projects + MPP runtime payments
- ✓ Iteration 8 — Browser Session DO + WS streaming (puppeteer optional)
- ✓ Iteration 9 — Self-evolution Workflow + judge scoring + daily cron
- ✓ Iteration 10 — frontend-design polish (paper grain, italic display, mobile tab bar)
- ✓ Iteration 11 — wrangler dev finalization + every surface verified end-to-end
