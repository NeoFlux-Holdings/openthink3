# Contributing to OpenThink

OpenThink is the upstream that every deployed agent syncs from. PRs are welcome — humans or agents can open them, as long as they follow the rules below.

## Rules for agent-authored PRs

Per PRD §5, commits authored by the deployed OpenThink agent **must not** include any Claude / model attribution in the message or trailer:

- Author: the deployment-specific email (e.g. `agent@drift-wombat.openthink.run`)
- Committer: the user
- No `Co-Authored-By: Claude` trailers
- No "Generated with Claude Code" footers

The same rule applies to bootstrap commits made by Claude during the build of this repo. If you submit a PR through Claude Code, configure the commit signoff before pushing.

## Development workflow

1. Fork or branch from `main`.
2. `pnpm install`.
3. Make your change. Add a test if it's worth testing.
4. `pnpm typecheck`. The pre-commit hook runs this too.
5. Run the dev preview (`pnpm --filter @openthink/platform run dev:web`) and verify the change in the browser.
6. Open a PR. Reference the PRD section your change touches.

## Areas that need help

- **Real Browser Rendering integration test.** The `BrowserSession` DO scaffolds the WS stream + screenshot pump but the integration with `@cloudflare/puppeteer` only fires when the binding is live. A short E2E that spins up wrangler dev + a fake puppeteer would catch regressions early.
- **Pierre Diffs integration.** The SaveAsSkillSheet's inline diff is currently hand-rolled. Replace with `@pierre/diffs` once the package's React entry stabilizes (we want the accept/reject hunk affordance).
- **Skill packs.** Ingestors for `aihero`, `gstack`, `gbrain` need a real fetch + cache + Vectorize embed pass. The parser in `packages/skills` handles the SKILL.md shape; the loader hasn't been wired to pull from the source repos yet.
- **Real model wiring.** The orchestrator's `dispatch` currently echoes locally and the Judge scores are stubs. Wire `@ai-sdk/anthropic` + `@ai-sdk/openai` + Workers AI through a single adapter contract (`packages/agents-core/src/index.ts` has the type).

## Code style

- TypeScript strict + `noUncheckedIndexedAccess` on, `exactOptionalPropertyTypes` off.
- Prettier defaults (`.prettierrc`), Inter / Fraunces / JetBrains Mono in the UI.
- Comments explain *why*, not *what*. Don't restate the code.
- No "I am Claude" comments. No "added by agent" markers.

## Security

If you find a vulnerability, please email tom@odysee.com rather than opening a public issue. We'll acknowledge within 48 hours.
