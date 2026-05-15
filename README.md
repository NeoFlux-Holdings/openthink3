# OpenThink

A personal AI agent that lives on your own Cloudflare account. One token, ninety seconds, and the agent ships behind your email at a domain you control — talking to itself, evolving with you, and quietly contributing patches back upstream.

> v3 — built from first principles against [PRD v1.0](https://github.com/NeoFlux-Holdings/openthink3/blob/main/PRD.md). Earlier attempts: `open-think`, `OpenThink`, `openthink2`.

## What it is

- **One Worker per user.** Workers + Durable Objects + Workers AI + Browser Rendering + Sandbox + Workflows.
- **Yours, not ours.** Runs on the user's Cloudflare account at their domain with their data. We never see a token, a prompt, or a memory.
- **Progressive disclosure.** Chat app on the surface; whiteboard in Train mode; Stripe-style resource panel one click deeper.
- **Self-evolving.** The agent edits its own config, opens PRs to its own repo, reconciles with an upstream the user pins or forks.

## Repository layout

```
openthink3/
├── apps/
│   ├── platform/        # The deployed Worker + static UI (the agent's chat shell)
│   └── marketing/       # openthink.run public site
├── packages/
│   ├── agents-core/     # Agent base classes, RPC plumbing, model adapters
│   ├── ui/              # Shared React components + design tokens
│   ├── skills/          # AgentSkills loader + pack registry
│   ├── memory/          # Vectorize + D1 FTS5 hybrid retrieval (RRF)
│   ├── browser/         # Cloudflare Browser Rendering wrapper
│   └── workflows/       # Smithers-JSX → Cloudflare-Workflows compiler
├── starters/
│   └── personal-agent/  # The deploy template (single-Worker scaffold)
├── tools/
│   └── cf-token/        # Token URL builder + scope validator
└── migrations/          # D1 schema migrations
```

## Quickstart (dev)

```bash
pnpm install
pnpm dev
# UI on http://localhost:5173, Worker on http://localhost:8787
```

Deploy your own:

```bash
pnpm deploy:platform
```

## Status

Pre-alpha. See [PRD §20 roadmap](./PRD.md#20-roadmap--open-problems) and the GitHub Project board.

## License

Apache-2.0.
