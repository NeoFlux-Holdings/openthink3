# BACKLOG — what to tackle after the approval round-trip

This is the running plan from the gap audit on 2026-05-20. Tier 1 mostly
shipped this round — only the remaining piece (1.3 partial / 1.4) is
open. Each entry below has concrete entry points so the work can start
cold without a re-audit.

Last update: 2026-05-21 — Tier 1.1 + 1.2 + 1.3 partial all shipped.

## Tier 1 — credibility floor (close the gap between UI and backend)

### 1.1 — Mobile `/today` + `/threads` + `/library` real data — **DONE**
Shipped via three Orchestrator RPCs (`mobileToday`, `mobileThreads`,
`mobileConversation`) and a real R2 list in the `/library` route.
Fixtures gone. Mobile screens now show actual DO state. ✓

### 1.2 — Mobile `/threads/send` real send — **DONE**
`Orchestrator.mobileSend()` stages the user message + ensures the
thread row exists. The chat WS path picks it up from there. The
mobile route is no longer a placeholder echo. ✓

### 1.3 — Spend cap enforcement — **partial**
- ✓ When the cap is exceeded `checkSpend` now fires a push to all
  registered devices (`queueSpendCapPush`), throttled to once per
  10 min so a retry loop can't carpet-bomb. Deep link points at
  `openthink://settings/spend-cap`.
- ✓ Hard pause (return `{ allowed: false }`) already worked.
- **Still open:** the `/api/stripe/spend` route returns hardcoded
  171¢/152¢ numbers. Wire it to read `OrchestratorState.spentCentsToday`
  via a dedicated RPC so the Spending tab shows real data.
- **Still open:** the cap is set globally in the DO; surface the
  per-day-cap-vs-monthly-cap distinction the mobile UI implies.

### 1.4 — Trigger approvals from real agent paths
`Orchestrator.requestApproval()` works end-to-end. The dev fixture
`/api/mobile/approvals/test` is still the only producer. The
declarative tool registry (`worker/agents/tools/registry.ts`) we
shipped this week is the seam to add real triggers: every `tool({
needsApproval })` definition routes through `requestApproval`
automatically.
**Plan:**
1. Replace the `searchWeb` fixture in `tools/registry.ts` with a real
   web-search tool (Brave Search API or Tavily) — it already has
   `needsApproval: () => true`.
2. Add `send_email` once MailChannels (Tier 2.1) lands. `needsApproval`
   defaults true for first-recipient or per-day-throttle limits.
3. Add a BrowserSession destructive-click pre-check that calls
   `requestApproval` before any form submission.

---

## Tier 2 — Cloudflare primitives that unlock the most leverage

The capabilities CF gives us essentially free that we haven't tapped.

### 2.1 — Email send via MailChannels
**Why:** CF Workers can send mail through MailChannels with no API key —
zero marginal cost. This unlocks the most-promised "send email" approval
scenario in the mockups.
**Plan:** new `apps/platform/src/worker/lib/email.ts` wrapping the
MailChannels API. Add a `send_email` skill. Surface it as a tool the
orchestrator can call, gated through `requestApproval()`.
**Reference:** MailChannels Workers integration docs.

### 2.2 — Inbound Email Routing → Email Worker
**Why:** "Email the agent to start a task" is a killer feature — most
people already have their inbox in their pocket.
**Plan:** Configure Email Routing on the agent's subdomain to route
`agent@<host>` to a new Email Worker. Parse the inbound, look up the
agent, drop a message into a new thread, fire push if it needs approval.
**Where:** new export from `worker/index.ts` with `email()` handler.

### 2.3 — AI Gateway binding
**Why:** Every `env.AI.run()` call goes direct today. AI Gateway gives
cost tracking, response caching (huge for tool routers + system prompts),
retry/fallback to OpenAI/Anthropic when CF AI is rate-limited, and a real
observability dashboard.
**Plan:**
- Add `[ai_gateway]` binding to `wrangler.toml`.
- Wrap inference behind `apps/platform/src/worker/lib/inference.ts`:
  `run({ model, messages })` picks Claude Opus / GPT-4o-mini / Llama
  based on `cost-class` tag.
- All existing call sites switch from `env.AI.run(...)` to `inference.run(...)`.

### 2.4 — Multi-model routing (Claude / GPT / Workers AI)
**Why:** Orchestrator, Researcher, Coder, Judge all hardcode
`@cf/meta/llama-3.1-8b-instruct`. For real work users want Claude Opus
for reasoning, GPT-4o-mini for tool calls, Llama for cheap routing.
`packages/skills/src/index.ts` already classifies skills by source
(`anthropic`, `openai`, `cloudflare`, `gstack`, …) — we just don't honor it.
**Plan:** routes through 2.3's inference shim. Adds `ANTHROPIC_API_KEY` +
`OPENAI_API_KEY` secrets (already declared in env.ts).

### 2.5 — MCP server (expose the agent's tools to external clients)
**Why:** A user with this agent should be able to use it from Claude
Desktop, Cursor, or any MCP-aware client. We already mention "RPC, no
MCP-over-HTTP needed for own-account specialists" in orchestrator.ts:609.
**Plan:** new route `apps/platform/src/worker/routes/mcp.ts` implementing
the MCP server protocol over HTTP+SSE. Expose Skills, Memory, Library,
Browser session as MCP tools. Auth via the same bearer token system as mobile.

### 2.6 — MCP client (consume external tools)
**Why:** GitHub, Slack, Notion, Linear all have official MCP servers.
Adding an MCP client unlocks N integrations without writing N OAuth flows
ourselves.
**Plan:** another `lib/mcp-client.ts` that talks to remote MCP servers.
User-supplied URLs + bearer tokens stored in KV. Tools surface in the
orchestrator's tool list automatically.

### 2.7 — Browser Rendering in production
**Why:** `BrowserSession` DO already lazy-imports `@cloudflare/puppeteer`,
the binding is just commented out in `wrangler.toml` because there's no
miniflare emulator. Uncomment + redeploy to get actual screenshots and
the WS frame stream that powers the live activity card.
**Where:** `apps/platform/wrangler.toml:104` (commented `[browser]` block).
**Plan:** uncomment, set `BROWSER` binding, ensure `BROWSER_SESSION` DO
gracefully degrades when binding missing (it already does).

### 2.8 — Whisper for voice transcription
**Why:** Mobile Hold-to-Talk button is stubbed with "voice transcription
in v1.1" copy. Workers AI has `@cf/openai/whisper-tiny-en` for free.
**Plan:** mobile uses `expo-audio` to record while the button is held,
POSTs the blob to `/api/mobile/transcribe`, worker runs Whisper, returns
the text. Pipe straight into the send-message flow.

### 2.9 — TTS for read-aloud responses
**Why:** Workers AI has `@cf/myshell-ai/melotts`. For driving-friendly
mode, the agent reads its replies aloud.
**Plan:** companion to 2.8. New mobile setting "Read responses aloud".

### 2.10 — User-defined Cron Triggers
**Why:** Personal agents really need "every morning at 8am, summarize
yesterday's Slack." We have one system cron (daily retrain) but no UI
for user-defined schedules.
**Plan:** D1 `scheduled_tasks` table (cron, prompt, threadId, enabled).
System cron polls every minute → fires due rows as Orchestrator messages.
Or per-task DO alarms (more scalable but more code).

### 2.11 — Vectorize activation in production
**Why:** Code is wired (`agents/memory-agent.ts:69`), binding is
commented in `wrangler.toml`. Without it, Memory recall falls back to
plain D1 text matching — semantic similarity is dead.
**Plan:** `wrangler vectorize create openthink-memories` + uncomment +
redeploy.

---

## Tier 3 — features the mockups don't yet show but the product needs

### 3.1 — Real OAuth for Gmail / Calendar / Slack / Notion
**Why:** Send-email-as-the-user, read-calendar, post-to-slack all need
user-scoped OAuth. Worker routes handle the callback, encrypted tokens
stored in KV under the agent's session.
**Plan:** New `/oauth/<provider>/start` and `/oauth/<provider>/callback`
routes. Provider-agnostic token refresh in a shared `lib/oauth.ts`.

### 3.2 — Connector marketplace UI
**Why:** Skills screen exists but the only entries are local fixtures.
Wire it to install MCP servers + OAuth-flow connectors from a catalog.
**Plan:** D1 `connector_catalog` seeded from a YAML in the repo.
Click "Install" → kicks the OAuth or MCP-server-URL flow.

### 3.3 — Real WebSocket stream for the activity card
**Why:** Mobile Today + web Today both poll. Live agent token deltas,
status changes, approval events should arrive over WS.
**Plan:** Mobile opens a WS to `<agent>/api/stream?token=…`, server
subscribes that socket to the agent's broadcast bus (already there via
`Orchestrator.broadcast()` + the `sockets` Set). Filter frames by tab
relevance.

### 3.4 — Agent observability viewer (Tail Worker → /observability)
**Why:** Train mode shows the agent reasoning but the live trace is
mock. CF Tail Worker can stream real DO logs.
**Plan:** new Tail Worker writes structured frames to a R2 NDJSON file
per agent per day. `/observability` reads the latest, renders a
trace timeline. Costs nothing (Tail Workers are free for the source).

### 3.5 — D1 backup/restore to R2
**Why:** Personal data, no DR story today.
**Plan:** Daily cron extends to dump D1 via `EXPORT` SQL → gzip → R2.
Settings → Data → Restore lists the snapshots; restore button
uploads back into a staging DB and switches the binding.

### 3.6 — Face ID gate on approvals
**Why:** Mobile toggle exists in You → Face ID for approvals. Not wired.
**Plan:** `expo-local-authentication` wrapper around the approval sheet's
Send button. Cache auth for 30s so a flurry of approvals doesn't re-prompt.

### 3.7 — Privacy controls (export, delete-account)
**Why:** GDPR-style, but also just hygiene for a personal agent.
**Plan:** Settings → Data → Export downloads a ZIP of D1 dump + R2
artifacts + KV settings. Delete-account flow walks the user through
detaching from Cloudflare. Already partially scaffolded in the
deploy/teardown route?

### 3.8 — Hyperdrive for external Postgres
**Why:** Only relevant if anyone runs against an external DB. Probably
not v1, but worth a sketch when we add the Postgres skill.

---

## Cosmetic / mock-only screens to either real-ify or remove

These are visual elements in the mockups that aren't wired and aren't
actually planned to be — keeping them around inflates the "what we ship"
story. Decide one of: build it, hide it, or change the copy.

- **"Updates" available count** — hardcoded 3 in `app/updates.tsx`.
  Either wire to a real `/api/mobile/updates` route or hide the count
  badge until updates actually exist.
- **Stats on Library** — "214 items · 1.2 GB" subtitle in
  `app/library.tsx:151`. Replace with real counts from `getLibrary()`
  response.
- **Live "agent driving" pill** in browser session — copy hardcodes
  "4.2 fps · 0:43". Either reflect the real stream metrics or generalize
  the copy.

## How to use this doc

When you're ready for the next chunk:
1. Pick the lowest-numbered Tier 1 item — those make the existing demo
   honest.
2. Confirm it's still relevant (sometimes a parallel change fixes one
   item incidentally).
3. Add tasks via TaskCreate to track sub-work.
4. Tear out the entry from this file once shipped.
