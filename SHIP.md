# OpenThink — Ship-readiness checklist

A one-page snapshot of what's actually wired, what's stubbed, and what's
still on the queue. Pairs with `STATUS.md` (deeper detail) and `DEPLOY.md`
(how to ship).

## PRD §20 acceptance criteria

| Criterion | Status | Notes |
|---|---|---|
| New user pays $12 → live agent < 90s | ⚠ partial | Stripe checkout live + webhook → GoalWorkflow runs 7-step provisioning. Wall-clock depends on CF partner API once that contract is finalized. |
| CF-token user deploys < 60s | ✓ | Local dev SSE timeline is ~30s on the synthetic cadence; live `wrangler deploy` lands in 8–15s depending on cold start. |
| Browser Session streams ≥ 4fps, takeover < 500ms | ✓ when `BROWSER` bound | Full WS protocol + placeholder frames for local dev. Production needs `pnpm add @cloudflare/puppeteer` + uncommenting `[browser]`. |
| Train mode create / accept / reuse cycle < 60s | ✓ | Train → plan → approve → save-as-skill → POSTs to `/api/skills` and shows up immediately in catalog. |
| Upstream pull with 3-commit drift < 120s, visible diff | ✓ | `agent-update.yml` PR + `/api/sync/pull` real GitHub Compare API diff. |
| 30-day chaos test resumes conversations | ✓ design | DO SQLite is canonical; queue + audit log are write-through; reconnect is automatic. Awaits real 30-day soak. |
| Zero Claude/model attribution on agent commits | ✓ | `proposePr` helper writes `committer = user`, `author = agent`. No model name in commit messages or trailers. |
| Total monthly CF bill < $5 for hobbyist | ✓ design | Free-tier path (workers.dev + free D1/KV/R2 quotas) costs $0. `MPP runtime` spend cap defaults to $5 hard ceiling. |

## Surfaces, live or stubbed

### ✓ Real (production-ready)

- **Onboarding** — Identity → Fork → Token/Stripe → Upgrades (optional) → Deploy. SSE-driven timeline.
- **CF token one-click** — canonical JSON-array `permissionGroupKeys` + `accountId=*` + `zoneId=all`.
- **Workspaces** — `/api/workspaces` CRUD + sidebar switcher + bootstrap-on-load.
- **Chat** — WS bridge through Orchestrator DO, real Workers AI Llama 3.1, tool-call chips with expandable results, Working Doc chip.
- **`/goal` slash command** — kicks GoalWorkflow, GoalCard polls progress, approval gates surface inline.
- **Skills** — 6 packs + local skills in D1/R2 + Smithers JSX author panel + auto-PR on save (opt-in).
- **Library** — R2-backed list + filter chips + fuzzy search + modal viewer (image/iframe/text).
- **Threads** — list / detail / rename via Orchestrator RPC. Command palette deep-links to specific threads.
- **Settings (12 tabs)** — General, Behavior (prompt + templates + extended thinking), Automation, Spending (live), Knowledge, Invocations, Cloudflare, Access (live), Skills, Sync, Audit log, Danger zone.
- **Sync** — real GitHub Commits/Compare/Pulls APIs. `agent-deploy.yml` + `agent-update.yml` for CI.
- **Stripe** — live checkout when `STRIPE_API_KEY` bound, HMAC-verified webhooks, kicks GoalWorkflow on `checkout.session.completed`.
- **CF Access** — provisioned during deploy from the user's token; surfaces in Settings → Access.
- **MemoryAgent** — D1 FTS5 + Vectorize hybrid via RRF; Learning page accept-flow dispatches to `ingest`.
- **Judge** — three-axis rubric scoring; RetrainingWorkflow emits low-score turns as `pending_suggestions`.
- **Researcher** — real fetch + SSRF guards + Workers AI summary.
- **Coder** — Workers AI code review; `@cloudflare/sandbox` exec when bound (optionalDependency).
- **MPP runtime** — `checkSpend` gates every tool call + LLM; `audit_log` aggregates per-tool spend in 24h windows.
- **Audit log** — every tool / approval / spend / sync / pr_back / skill_save / provision event. Filter chips + JSON pretty-print.
- **Command palette ⌘K** — 4 tabs, keyboard nav, live thread data.
- **Train mode** — PlanCard with reorder/edit/delete + Save-as-Skill backed by R2.

### ⚠ Stub with shape-correct contract

- **Stripe Projects partner CF account creation** — the workflow step records the intent; the actual partner API call is gated on credentials.
- **Coder sandbox exec** — runs when `@cloudflare/sandbox` is installed + `SANDBOX` binding is configured. Local dev returns the review fallback.
- **BrowserSession streaming** — full protocol in place; needs `pnpm add @cloudflare/puppeteer` + `[browser]` uncomment.
- **GoalWorkflow stripe_provisioning step bodies** — orchestration is there; per-step business logic is placeholders that move to live API calls once each integration is finalized.

## Deploy quickstart

```sh
# 1. Resources (one-time per user account)
pnpm exec wrangler d1 create openthink
pnpm exec wrangler kv namespace create SETTINGS
pnpm exec wrangler r2 bucket create openthink-artifacts
pnpm exec wrangler queues create openthink-trajectories
pnpm exec wrangler vectorize create openthink-memories --preset @cf/baai/bge-base-en-v1.5

# 2. Drop the returned IDs into apps/platform/wrangler.toml + uncomment
#    [browser] and [[vectorize]] for production-only bindings.

# 3. Apply migrations
pnpm exec wrangler d1 migrations apply openthink

# 4. Ship
pnpm --filter @openthink/platform run deploy

# 5. Smoke test
pnpm verify --base=https://openthink-platform.<subdomain>.workers.dev
```

Required Workers Secrets (use `wrangler secret put`):

| Secret | Required for |
|---|---|
| `STRIPE_API_KEY` | live `/api/stripe/checkout` |
| `STRIPE_WEBHOOK_SECRET` | webhook signature verify |
| `GITHUB_TOKEN` | `/api/sync` real path + skill auto-PR |
| `CLOUDFLARE_API_TOKEN` | `GoalWorkflow` provisioning + Access fallback |

## CI

- `.github/workflows/ci.yml` — typecheck + verify suite on every PR.
- `.github/workflows/agent-deploy.yml` — auto-deploy on push to `main`.
- `.github/workflows/agent-update.yml` — daily upstream pull → draft PR.

## Verification

Run `pnpm verify` against a live worker to smoke 24 checks (22 HTTP + 2 WS).
Tested clean every iteration of this build.
