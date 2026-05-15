# OpenThink — Product Requirements Document v1.0

> Source of truth. Drafted 2026-05-14. The full HTML PRD lives in [`/docs/PRD.html`](./docs/PRD.html) (rendered version).

## Five principles

1. **Yours, not ours.** The agent runs on the user's Cloudflare account, at their domain, with their data. We never see a token, a prompt, or a memory.
2. **Ninety seconds to "hi".** From landing page to first message: under 90 seconds wall-clock on the free path.
3. **Progressive disclosure.** Chat app on the surface; whiteboard in Train mode; Stripe-style resource panel one click deeper.
4. **Self-evolving, in the open.** The agent edits its own config, opens PRs to its own repo, reconciles with an upstream the user can pin or fork.
5. **Multi-mode trust.** Full auto, smart auto, manual. Per-tool overrides. Hard spend caps that override every other mode.
6. **Agents talk to agents.** Orchestrator and specialists communicate over DO RPC; also reachable over HTTP MCP for outside callers.

## Architecture (one paragraph)

One Cloudflare Worker per user. The Orchestrator (an `AIChatAgent` Durable Object) holds the user's chat. It binds three peer `McpAgent` DOs (Researcher, Coder, Memory) plus a Judge sibling, all via DO RPC — zero-network, hibernation-safe. Long-running goals route to a Cloudflare Workflow. Code execution lands in `@cloudflare/sandbox`. Live browser sessions stream from Cloudflare Browser Rendering into the canvas via WebSocket. State: D1 for trajectories + audit + policies; R2 for blobs; KV for hot settings; Vectorize for memory + skill retrieval.

## Phased roadmap

| Phase | Exit criterion |
|-------|----------------|
| P0 — Foundation | Token paste → live agent in < 60s |
| P1 — Onboarding + deploy UI | A normie can deploy without seeing "Wrangler" |
| P2 — Shell + canvas + browser sessions | Users can browse, edit, and pop out artifacts |
| P3 — Orchestration + skill packs | Orchestrator delegates; skills auto-load |
| P4 — Train + Smithers + self-evolve | A user can create a skill from a trained run |
| P5 — Approvals + payments | A user can hand the agent a credit card with a $20/day cap |
| P6 — Sync + PR-back | A user can pull upstream; agent can open a PR back |
| P7 — Workspaces + multi-orchestrator | A user runs `work` + `personal` orchestrators side by side |
| P8 — Adopt Smithers runtime | Workflow forks/replays/diffs against alternate models |

## Acceptance criteria (v1.0)

- New user (no CF, no GitHub) lands on `openthink.run`, pays $12, has a live agent **< 90s wall-clock**.
- CF-token user deploys **< 60s**.
- Browser Session streams **≥ 4 fps** with **< 500ms** take-over handoff.
- Train-mode skill creation, accept, and reuse cycle **< 60s end-to-end**.
- Upstream pull with three commits of drift completes **< 120s**, visible diff before commit.
- 30-day chaos test passes: Worker restarts, DO migrations, model swaps, network drops — conversations resume.
- **Zero Claude/model attribution** on any commit authored by the agent.
- Total monthly CF bill for a hobbyist single-agent user **< $5**.

## Open problems

See PRD §20 in the rendered HTML for the long list. Highlights:

- Agents SDK 0.12.4 chat-recovery + durable submissions: plausible per user note, verify at install.
- CF token deep-link URL pattern is undocumented; add a fallback docs page.
- Access OTP group caveat (groups not re-evaluated after first auth).
- Vectorize lacks native hybrid; we ship D1 FTS5 + Vectorize fused by RRF.
- Browser Rendering pricing can spike — surface a cost meter; v1.1 adds an absolute cap.
- Workflow `step.waitForEvent` caps at 24h; for longer pauses use `step.sleep` polling.
- Auto-PR upstream is a new threat surface (prompt-injection); v1.0 requires Manual mode.

— Thomas Zarebczan, 2026-05-14
