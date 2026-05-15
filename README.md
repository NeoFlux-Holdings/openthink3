# OpenThink

A personal AI agent that lives on your own Cloudflare account. One token, ninety seconds, and the agent ships behind your email at a domain you control — talking to itself, evolving with you, and quietly contributing patches back upstream.

> v3 — built from first principles against [PRD v1.0](./PRD.md). Earlier attempts: `open-think`, `OpenThink`, `openthink2`.

## Five principles

1. **Yours, not ours.** Runs on the user's Cloudflare account, at their domain, with their data. We never see a token, a prompt, or a memory.
2. **Ninety seconds to "hi."** From landing page to first message: under 90 seconds wall-clock on the free path.
3. **Progressive disclosure.** Chat app on the surface; whiteboard in Train mode; Stripe-style resource panel one click deeper.
4. **Self-evolving, in the open.** Edits its own config, opens PRs to its own repo, reconciles with an upstream you pin or fork.
5. **Multi-mode trust.** Full auto, smart auto, manual. Per-tool overrides. Hard spend caps that override every other mode.
6. **Agents talk to agents.** Orchestrator and specialists communicate over DO RPC; also reachable over HTTP MCP for outside callers.

## Repository layout

```
openthink3/
├── apps/
│   ├── platform/        # the deployed Worker + static UI (the agent's chat shell)
│   │   ├── src/web/     # React + Vite UI (landing, onboarding, deploy, shell,
│   │   │                #  library, skills, learning, settings, sync panel)
│   │   ├── src/worker/  # Hono routes, Orchestrator DO + 5 specialists,
│   │   │                #  GoalWorkflow, RetrainingWorkflow, queue consumer
│   │   └── src/shared/  # types shared between the worker and the UI
│   └── marketing/       # openthink.run public site (Cloudflare Pages)
├── packages/
│   ├── agents-core/     # Agent base classes, RPC plumbing, model adapter contract
│   ├── ui/              # shared React primitives + design tokens
│   ├── skills/          # AgentSkills loader + pack registry (one parser, six ecosystems)
│   ├── memory/          # hybrid retrieval (Vectorize + D1 FTS5 fused by RRF)
│   ├── browser/         # Cloudflare Browser Rendering wrapper contract
│   └── workflows/       # Smithers JSX → Cloudflare Workflow compiler
├── starters/
│   └── personal-agent/  # per-user deploy template (the upstream pulls from)
├── tools/
│   └── cf-token/        # token URL builder + scope validator
├── migrations/          # D1 schema migrations applied atomically on deploy
└── DEPLOY.md            # local dev + production deploy guide
```

## What's in v0.1

| PRD ref | Surface | State |
|---|---|---|
| §1, §2 | North star, personas, principles | docs ✓ |
| §3 | Architecture: 1 Worker per user, DO RPC for peers, 3 execution lanes, 3 MCP transports | scaffolded |
| §4 | CF foundations: Workers, DOs (SQLite), Workers AI, D1, R2, KV, Vectorize, Workflows, Queues, Browser Rendering, Sandbox, Access, MPP, Pages | bindings declared |
| §5 | Repo + update + PR-back mechanics — agent + upstream + per-user fork | `/api/sync` routes + SyncPanel UI ✓ |
| §6 | Orchestrator + specialists (Researcher, Coder, MemoryAgent, Judge, BrowserSession) | DOs scaffolded; in-Worker RPC for peers, HTTP MCP transport ready |
| §7 | Self-evolution: trajectory capture → score → candidate → A/B backtest → commit gate | `RetrainingWorkflow` + daily 08:00 UTC cron ✓ |
| §8 | Skill pack system: Cloudflare / Anthropic / OpenAI / aihero / gstack / gbrain | parser + pack registry, Skills page UI ✓ |
| §9 | Onboarding: identity → fork → token / Stripe | three screens + agent name generator ✓ |
| §10 | Deploy progress UI: vertical timeline, live SSE | ✓ |
| §11 | Main shell: three-column, composer, mode toggle | ✓ |
| §12 | Artifact canvas: 8 types, 3 window modes, thumbnail strip, per-artifact header | ✓ |
| §13 | Browser sessions on CF Browser Rendering — pilot/grid/stack modes, take-over | DO wired with WS streaming + R2 snapshots; live browser binding needed in prod |
| §14 | Train mode: plan card + drag-to-reorder + JSX view toggle + save-as-skill sheet | ✓ |
| §15 | Learning page: skills + memories + rubrics + pending suggestions | UI ✓; D1 storage scaffolded |
| §16 | Approval modes + per-skill overrides + spend cap | Settings UI ✓; `tool_policies` D1 table |
| §17 | Payments — Stripe Projects onboarding + MPP runtime | `/api/stripe` routes (checkout, webhook, spend) ✓; live keys at deploy |
| §18 | Cloudflare Access (email-gated) | provisioning route declared; canonical scopes pinned |
| §19 | Pinned stack | targets in package.json |
| §20 | Phased roadmap P0–P8 | through P7; P8 (Smithers runtime) deferred |

## Quickstart (dev)

```bash
pnpm install
pnpm --filter @openthink/platform run dev:web      # Vite UI on :5180
pnpm --filter @openthink/platform run dev:worker   # Wrangler dev on :8787 (optional)
```

Without the worker, the shell falls back to a local echo (chip says "local echo" instead of "live"). See [DEPLOY.md](./DEPLOY.md) for the binding-creation commands required to run wrangler dev or to deploy to production.

## Five iterations of progress

| Commit | What landed |
|---|---|
| `24cbc5b` | Monorepo scaffold — Worker (Hono + 6 DOs + GoalWorkflow + queue), React+Vite UI, D1 migration 0001, six packages |
| `096c745` | Typecheck-clean + dev preview wired (`@shared/*` paths, vite dedupe react, port 5180, removed stale @ts-expect-error markers) |
| `0ce2681` | Artifact canvas — 8 artifact types, 3 window modes, thumbnail strip |
| `492f6b5` | Train mode (PlanCard + JSX toggle + SaveAsSkillSheet), Library / Skills / Learning / Settings pages |
| `e593b06` | WS bridge (`useAgentSocket`) with graceful local-echo fallback + DEPLOY.md |
| `03a85b5` | Sync panel + Stripe surface + BrowserSession DO + RetrainingWorkflow + daily cron |

## License

Apache-2.0.
