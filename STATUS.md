# OpenThink — Implementation Status

Tracks coverage of the original spec against what's actually built and
verified end-to-end. Updated each loop iteration.

## What works (verified end-to-end against `wrangler dev --local`)

### Claude Design implementation (Geist · Cloudflare-orange · 3-step onboarding)
- ✓ **Design tokens ported verbatim** from the Claude Design handoff into
  `apps/platform/src/web/styles/tokens.css` — light + dark, brand orange
  `#F38020`, coral `#E54B2C`, status quartet, spacing/radii/motion scale.
  Legacy `--ot-*` tokens kept as aliases pointing at the new values so
  existing 18k-line screens (Library / Skills / Learning / Settings / Sync)
  inherit the palette + Geist typography without per-file rewrites.
- ✓ **Geist + Geist Mono** loaded via Google Fonts; preconnect tags +
  font feature settings `"cv11" 1, "ss03" 1` for the OpenType polish.
- ✓ **Primitives & utility classes** (`primitives.css`) — `.btn`
  (default / primary / brand / ghost · sm/md/lg/xl), `.chip` (default +
  7 status variants), `.kbd`, `.dot` (with `.pulse` ring), `.switch`,
  `.card`, `.input`, `.info-note`. Reduced-motion zeroes durations.
- ✓ **Chord + Icon components** (`shell/Chord.tsx`, `shell/Icon.tsx`) —
  platform-aware kbd rendering (⌘K on Mac, Ctrl+K on Win) and a 60+
  icon set as one typed module (24×24, 1.5 stroke, currentColor).
- ✓ **Theme module** (`shell/theme.ts` + `ThemeToggle.tsx`) — persists
  light/dark to localStorage, syncs across surfaces, applies
  `data-theme="dark"` on `<html>` synchronously so we never flash the
  wrong palette on first paint.
- ✓ **Landing page rebuilt** — nav with theme toggle, hero with gradient
  italic "Cloudflare", live demo two-pane card, 4-cell stats strip
  (90s · $5/mo · 96 KiB · 0), **2-step "how it works"** (fork removed),
  6-tile capability grid, compare block, two-tier pricing ($0 BYO · $12
  Hosted), final CTA. ⌘D / Ctrl+D anywhere on the page deploys. Old
  `Landing.css` deleted.
- ✓ **Onboarding collapsed to 3 steps** in a single `Onboarding.tsx`:
  - Step 01 — Name + workspace, six suggestion chips.
  - Step 02 — Connect Cloudflare with path-toggle: **BYO** (real
    `/api/cf-token/validate` against `api.cloudflare.com/.../user/tokens/verify`
    on every paste/validate) or **Hosted** (real Stripe checkout via
    `/api/stripe/checkout`).
  - Step 03 — Pick capabilities + daily spend cap, then
    POSTs `/api/deploy/start` and routes to the new deploy screen.
  Old 5-route `onboarding/{identity,fork,token,stripe,upgrades}` tree
  collapsed to a single `/onboarding` hash.
- ✓ **Deploy progress rebuilt** with the design timeline — 7-step
  animated rail, live `LIVE LOG` terminal panel with color-coded lines,
  2×2 stats grid, "what just happened" + "what it costs" side blocks.
  Polls `/api/deploy/status?id=…` against the real `DeployState`
  contract when a deployId is present.
- ✓ **`design.css`** — 2,000-line port of every remaining screen-level
  selector from the handoff (sidebar + command palette, thread +
  composer, canvas + 7 artifact types, library / skills / learning /
  sync rows, settings, train mode, mobile-web responsive shrinks).
  Loaded once from `main.tsx`.

### Mobile companion app — Expo (NEW)
- ✓ **`apps/mobile`** scaffolded as a pnpm workspace member. Expo 54 +
  Expo Router 6 + React Native 0.81 + TypeScript strict. Plugins for
  expo-font, expo-camera, expo-notifications. Metro watches workspace
  root for hoisted deps.
- ✓ **Shared design tokens** mirror the web in `src/theme/tokens.ts` —
  light + dark palettes, spacing scale, enlarged radii (12 → 14,
  16 → 18) for the iOS feel, type roles mapped to Geist with
  system-font fallback baked in via the safe-require wrapper in
  `_layout.tsx`.
- ✓ **`ThemeContext`** — persists choice to expo-secure-store, honors
  OS-level flips until the user picks one explicitly, exposes
  `useTheme()` returning `{ theme, colors, setTheme, toggleTheme }`.
- ✓ **Primitives** (`src/components/primitives.tsx`) — `H1`/`H2`/`H3`,
  `Body`, `Mono`, `Eyebrow`, `Dot`, `Chip` (default + 7 status
  variants), `Card`, `Button`, `PillPicker`, `Avatar`, `SectionLabel`,
  `Screen` wrapper. All theme-aware.
- ✓ **TabBar** — bottom nav with a 56×40 brand FAB in the middle that
  opens the New Task sheet. Safe-area aware.
- ✓ **Sign-in / pair-a-device flow** — two-stage:
  1. User types/pastes their agent handle → app opens
     `https://<agent>/#/mobile/pair?device=<label>` in expo-web-browser.
  2. New `/mobile/pair` page on the web app (rendered by
     `MobilePair.tsx`) POSTs `/api/mobile/pair/init`, displays a
     6-letter code (5-minute TTL in KV).
  3. Mobile POSTs `/api/mobile/session/exchange { code, deviceLabel }`
     → bearer token stored in expo-secure-store.
  Deep links (`openthink://?code=…&host=…`) auto-fill so the future
  Universal Link upgrade is one-tap.
- ✓ **11 screens implemented** matching the design's 11 mobile boards:
  - `/today` — greeting + live activity card + approvals + spend bar
    + recent threads. Pull-to-refresh.
  - `/threads` — search + 5 filter chips + grouped lists (Live, Today,
    This week, Older) + chevron rows.
  - `/threads/[id]` — conversation: pinned brand-soft working notes,
    msg-user (brand-2 fill, asymmetric radii), msg-ag (ink avatar +
    tool chips + reasoning trace), horizontal artifact scroll, live
    status pill, send-on-Enter composer with optimistic append.
  - `/threads/[id]/browser` — full-bleed Calendly mock with the
    animated agent cursor (Animated path, 4-position 2.2s loop),
    "agent driving" overlay, brand "Take over" CTA.
  - `/sheets/new-task` — bottom sheet, 96×96 brand mic button with
    pulsing halo (Animated.parallel scale + opacity loop), suggested-
    prompt chips, fallback textarea.
  - `/sheets/approval` — bottom sheet with coral-tinted icon, preview
    card, Skip / Send buttons, "Edit before sending" link. POSTs
    `/api/mobile/approvals/:id/respond`.
  - `/library` — 2-column tile grid with type-tinted previews,
    uppercase mono `EXT` badges, filter pills.
  - `/you` — profile card with gradient avatar, spend meter, Agent
    rows, App rows (theme segmented control, updates badge,
    biometrics), sign-out.
  - `/updates` — reframed Sync screen with status hero, safe/review
    rows, "your agent wants to share" contribution row.
- ✓ **`/api/mobile/*` worker routes** (`apps/platform/src/worker/routes/mobile.ts`):
  - `POST /pair/init` — issue one-time pairing code (5-min KV TTL).
  - `POST /session/exchange` — trade code for bearer token.
  - Middleware enforces `Authorization: Bearer …` on every other
    mobile endpoint.
  - `GET /today`, `/threads`, `/threads/:id`, `POST /threads/send`,
    `/approvals`, `/approvals/:id/respond`, `/library`,
    `POST /push/register`.
- ✓ **Push notifications** — `src/lib/notifications.ts` requests perms,
  configures the Android `default` channel with brand orange,
  registers the Expo push token with the agent. Best-effort: simulator
  + denied perms degrade silently.
- ✓ **Verify suite 24/24 PASS** after the rewrite. Web typecheck +
  worker typecheck + mobile typecheck + `wrangler deploy --dry-run`
  all green.

### Agents SDK 0.13 + Vercel AI 6 adoption + chat UI polish
Reference: github.com/cloudflare/agents-starter. We absorbed the
patterns + deps into our existing Orchestrator-based flow — no
parallel chat system. Wrangler bumped to 4.93 (needed for the
newer SDK runtime).

- ✓ **New deps installed**: `agents@0.13.2`, `ai@6`,
  `workers-ai-provider@3`, `@cloudflare/ai-chat@0.7.1`,
  `streamdown@2`, `@streamdown/code@1`, `@phosphor-icons/react@2`.
- ✓ **Shared inference helper** (`apps/platform/src/worker/lib/inference.ts`)
  wraps `createWorkersAI` + `generateText`/`streamText` from the AI SDK.
  Cost-class API (`cheap | reasoning | long | embed`) lets us re-tune
  models in one place. Same surface as the legacy `env.AI.run`.
- ✓ **Orchestrator refactored** to use the helper for the chat reply
  path + auto-summary title path. Behavior identical, just the modern
  pattern.
- ✓ **Researcher + Coder + Judge refactored** to use the helper
  (fetch-url summary, free-form research, code review, trajectory
  judge). Cost class declared per call (`cheap` vs `reasoning`).
- ✓ **Declarative tool registry** (`worker/agents/tools/registry.ts`)
  adopts the starter's `tool({ inputSchema, execute, needsApproval })`
  pattern. The `needsApproval` callback is wired into the existing
  `Orchestrator.requestApproval` so a new approval-gated tool is a
  one-liner.
  - Three v1 fixtures land the pattern: `getWeather` (no approval),
    `calculate` (approval over abs 1000 — same threshold as the
    starter), `searchWeb` (always asks).
  - Public RPCs on the Orchestrator: `runDeclarativeTool(threadId,
    name, args)` and `listDeclarativeTools(threadId)` — chat path
    + Skills surface can both consume.
- ✓ **Desktop chat — Markdown rendering**
  (`apps/platform/src/web/shell/Markdown.tsx`) — assistant messages
  now render bold / italic / inline code / fenced code with a copy
  button / bullets / numbered lists / quotes / headings 1–3 / links.
  ~150 lines, no Tailwind dep, theme-token aware. Search-highlight
  path still uses the existing plain-text renderer so the `<mark>`
  pipeline survives. Streaming-friendly: an unterminated code fence
  shows the partial content + a brand pulse line.
- ✓ **Desktop chat — typing indicator** — 3 brand-color dots animate
  in a 1.2s loop whenever any toolEvent is in the `running` state.
- ✓ **Desktop chat — jump-to-bottom pill** — appears when the user
  scrolls up and a new message arrives. Tapping scrolls to end +
  clears the pill. Auto-scroll still fires while the user is sitting
  at the bottom; the digest of message text lengths picks up
  token-by-token streaming, not just message-count changes.
- ✓ **Desktop chat — tool cards polished** — `shell__tool` row now
  picks up status-tinted backgrounds (brand-soft running, green-soft
  done, coral-soft blocked/error) instead of just border colors. The
  expanded state morphs to a card shape so the JSON output reads as
  a structured block.
- ✓ **Mobile app — Markdown primitive**
  (`apps/mobile/src/components/Markdown.tsx`) — same subset as web,
  renders to RN `<Text>`/`<View>`, theme-token aware. Code blocks
  ship with a copy button via `expo-clipboard`. No new RN dep.
  Wired into the assistant-message body in `/threads/[id]`.
- ✓ **Mobile app — ToolCallCard**
  (`apps/mobile/src/components/ToolCallCard.tsx`) — five states
  (`running` / `done` / `approval-needed` / `blocked` / `error`)
  with brand/green/coral-soft tints, Reanimated spin on running,
  Approve/Reject buttons baked in for the approval state, tap to
  expand the JSON output, +inline cost display for approval cards.
  Replaces the simple tool-chip row in the conversation screen.
- ✓ **Mobile-web composer polish** at ≤760px (`compat.css`):
  - `shell__composer` picks up `safe-area-inset-bottom` padding +
    16px+ font on the input so iOS Safari skips the focus zoom.
  - `shell__composer-send` / `shell__composer-mic` clamped to 44px
    minimum for thumb-reach.
  - Composer-meta row reflows to wrap so the send button always
    sits at the right edge.
  - Desktop-only hint strip hides on mobile to free vertical space.
  - Jump-to-bottom pill lifts above the composer so it never sits
    behind the send button when the iOS URL bar transitions.

### Approval round-trip + push send pipeline (Tier-1 backend close-out)
Closes the gap where the mobile UI promised "tap Send to unblock the
agent" but the worker route was a stubbed `// TODO`. See `BACKLOG.md`
for the rest of the Tier 1/2/3 plan.

- ✓ **Push send pipeline** (`apps/platform/src/worker/lib/push.ts`) —
  thin wrapper around the Expo push API (`https://exp.host/--/api/v2/push/send`).
  No npm deps, just `fetch`. Batches up to 100 messages per call,
  returns `{ ok, failed }` counts, never throws. Three convenience
  exports: `pushToAgent`, `pushApprovalNeeded`, `pushStatus`. Token
  enumeration walks the `mobile:push:` KV prefix with cursor pagination.
- ✓ **Orchestrator approval RPCs** — three new methods on the DO:
  - `requestApproval(req): Promise<decision>` — stores a row, broadcasts
    `approval-needed` over WS, fires `pushApprovalNeeded` best-effort,
    returns a promise that resolves when the user responds.
  - `listPendingApprovals(): ApprovalRecord[]` — newest-first list,
    capped at 50.
  - `respondToApproval(id, decision): { ok, reason? }` — flips row to
    resolved, broadcasts `approval-resolved`, audits, resolves the
    awaiting promise. Idempotent against double-respond.
- ✓ **Approval persistence** — new `approvals` table inside the DO's
  SQLite (`id PK, thread_id, kind, title, body, meta, cost_cents,
  context, status, decision, created_at, resolved_at`) plus a
  `(status, created_at)` index for the list query. DO restart mid-
  wait preserves the row; only the JS resolver is lost.
- ✓ **Real mobile routes** (`apps/platform/src/worker/routes/mobile.ts`):
  - `GET /api/mobile/approvals` — RPCs into `listPendingApprovals`,
    maps `cost_cents` → `costUsd` at the wire edge.
  - `POST /api/mobile/approvals/:id/respond` — accepts both the mobile
    UX vocab (`send`/`skip`/`edit`) and the wire vocab (`approve`/`deny`/
    `edit`), normalizes server-side, RPCs into `respondToApproval`.
  - `POST /api/mobile/approvals/test` — dev-only fixture (gated on
    `OPENTHINK_VERSION === '0.1.0'`) that fires a `requestApproval`
    so we can exercise the round-trip without an agent path that emits
    one yet. Returns the new approval's id.
- ✓ **Mobile approval sheet rewritten** (`app/sheets/approval.tsx`) —
  fetches by id, shows real title/body/meta/cost (not the hardcoded
  Sarah Cohen copy), renders a clear "already resolved" state if the
  id is missing or gone, sends the decision over the API. Long-press
  Edit routes to `'edit'`; Send → `'approve'`; Skip → `'deny'`.
- ✓ **Push deep-link routing** (`src/lib/notifications.ts`) — adds
  `attachPushListeners(router)` mounted from `_layout.tsx`. Parses
  `openthink://approval/<id>` → `/sheets/approval?id=<id>`, also
  handles `openthink://thread/<id>`, `openthink://browser/<id>`,
  `openthink://updates`, `openthink://you`, `openthink://today`.
  Covers both the foreground tap path (response listener) and the
  cold-start path (`getLastNotificationResponseAsync`).
- ✓ **End-to-end smoke** — pair → token → POST `/approvals/test` →
  GET `/approvals` (pending) → POST `/approvals/:id/respond` → GET
  `/approvals` (empty) all return the expected shapes. Idempotency:
  second respond returns `{ ok: false, reason: 'already_resolved' }`.
  Invalid decision returns 400. Missing token returns 401. Verify
  suite 24/24 PASS.

### Mobile UX delta v2 — full screen rebuilds + native interactions
Layered on top of the initial mobile companion. Sourced from the second
Claude Design handoff (`live-phone.jsx` + `live-phone-screens.jsx` +
`mobile-screens-1.jsx`). All native, all UI-thread driven (Reanimated 4
+ gesture-handler), all type-checked clean.

- ✓ **LargeTitleHeader** (`src/components/LargeTitleHeader.tsx`) —
  iOS-style title that collapses on scroll. Big title fades + nudges
  up between 0 and 40px; nav title fades in to replace it; tinted
  backdrop fills at t > 0.3; hairline rule appears at t > 0.9. All
  three transitions driven by a single `scrollY` shared value the
  caller supplies via `useAnimatedScrollHandler`. Optional left-side
  back chevron + brand label, right-side accessory slot (e.g. avatar).
- ✓ **SwipeRow** (`src/components/SwipeRow.tsx`) — left + right swipe
  actions per row using Reanimated `Gesture.Pan` with `activeOffsetX`
  + `failOffsetY` to only steal the pan when the user clearly meant
  horizontal. |dx| > 80 on release commits the action; anything
  shorter rubber-bands back with a 240ms cubic-bezier(0.22,0.61,0.36,1)
  release. Action panels (`pin`, `archive`, `mark`, `mute` tones)
  expand to match drag distance. Haptic confirm on fire.
- ✓ **MiniBrowserThumb** (`src/components/MiniBrowserThumb.tsx`) — a
  faithful mini browser preview: traffic-light buttons, URL pill,
  page heading + calendar grid (one slot selected), and the agent
  cursor SVG with brand-orange `<FeDropShadow>`. Used in the Today
  live-task card and inside `/threads/[id]` Canvas tab artifact
  previews of type `browser`.
- ✓ **Segmented** (`src/components/Segmented.tsx`) — pill-style 2/3
  option picker with selected card lift (subtle shadow). Optional
  per-option badge slot for counts ("Canvas 3"). Used inside
  `/threads/[id]` to switch Chat ↔ Canvas without losing scroll
  position on either side.
- ✓ **Today rebuilt** to match the delta. LargeTitleHeader · big
  live activity card with the MiniBrowserThumb embedded · brand-soft
  glow wash · stat tripod (Spent / Elapsed / Tools) below a hairline ·
  approval cards inline with Skip + Review actions split by a 1px
  rule · today's spend bar (8px height, brand→coral gradient if pct
  > 0.85) · recent threads list with SwipeRow on each row.
- ✓ **Threads rebuilt** with sticky group headers, search input, and
  horizontal-scroll filter chips (All · Live · Today · This week ·
  Has approvals). Every row wraps in SwipeRow with `Pin` (left) +
  `Archive` (right). Live threads skip the Pin action since the user
  almost never pins running work.
- ✓ **Library rebuilt** with type-specific mini previews: `image`
  renders as a brand→coral LinearGradient swatch; `doc` as horizontal
  bars; `code` as a dark-charcoal terminal with faded mono lines;
  `chart` as a 7-bar histogram in brand orange with rising opacity;
  `table` as a 5-row column grid; `webpage` with a thin chrome strip
  and stub heading/lines. Tile labels match the source thread ("Q3
  launch", "Brand") + age in mono.
- ✓ **You rebuilt** with hero profile card (gradient avatar 56px ·
  agent URL in mono · live dot), This-month spend card (32px display
  number + brand→coral bar + 3 sub-stats), Agent group (Approval
  mode · Spend cap · Skills · Memory — each with brand-tinted icon
  square), App group (Theme picker that pushes a bottom sheet ·
  Updates with coral badge · Face ID switch).
- ✓ **Conversation [id] rebuilt** with Segmented Chat | Canvas
  control. Chat: working notes pin · message bubbles · agent reply
  with tool chips + token count + reasoning hint · inline approval
  card · live status pill · suggested follow-up chips. Canvas:
  full-width artifact cards with type-specific previews (browser
  uses MiniBrowserThumb, doc gets a paragraph mock, table gets a 6-
  row column grid). Streaming auto-scroll preserved via digest of
  message text lengths + `atBottom` gate.
- ✓ **Updates rebuilt** with hero card pattern: 44×44 brand-soft
  icon · big "3 updates available" · "2 safe · 1 needs review"
  caption · full-width Apply 2 safe CTA. Below: list of available
  updates with green Apply chips for safe ones and amber Review
  chips for schema-touching ones.
- ✓ **Settings detail pushes** — single `app/settings/[key].tsx`
  switches on the route key:
  - `approval-mode` — three radio rows (Full auto / Smart auto /
    Manual) with brand-bordered selected indicator.
  - `spend-cap` — $20 display + bar visualization + five quick-pick
    pills ($5, $10, $20, $50, $100).
  - `skills` — six toggleable skills with brand-tinted category
    glyphs (Send email coral, Browser brand, Calendar blue, CRM
    green, Doc edit amber).
  - `memory` — total count card + 4 fact rows with green bulb
    glyph + source thread chip.
  Every key footers with a "Open in browser" link so the user can
  jump to the full desktop settings UI.
- ✓ **Browser session screen** (`app/browser/[id].tsx`) — full-
  screen Calendly mock with animated agent cursor (Reanimated
  withRepeat + withSequence breathing over the 11:00 AM slot with
  a periodic 220ms "click" scale-down). Top bar: brand back chevron
  + lock+URL pill + close. Bottom: "Agent driving · 4.2 fps · 0:43"
  dark pill + brand "Take over" CTA with brand-orange drop shadow.
- ✓ **Theme picker sheet** (`app/sheets/theme.tsx`) — bottom sheet
  with two visual cards previewing the actual palette: warm cream
  for Light, charcoal for Dark. Selected card gets brand-orange
  border + brand check badge.
- ✓ **Stack animation tightened** in `_layout.tsx`. Browser,
  Settings detail, and Thread detail routes use `slide_from_right`
  with `gestureEnabled: true`. Sheet routes (new-task, approval,
  theme) use `transparentModal` so the BottomSheet draws its own
  backdrop. GestureHandlerRootView at the root keeps drag-to-
  dismiss + pan-to-back working everywhere.

### Mobile web — ≤760px responsive pass
- ✓ **Marketing nav collapses** at ≤760px: only the primary CTA
  remains on the right; All / Pricing / Docs links + separators
  hide.
- ✓ **Hero / sections stack vertically**: `.lhero-demo-body`,
  `.compare-block`, `.two-step`, `.cap-grid`, `.price-block` drop
  to `grid-template-columns: 1fr`; `.stats-strip` halves to 2-col.
- ✓ **Onboarding rail hidden** + `.onb-main` padding tightens to
  `32px 20px`; the form gets full width. Step indicator stays.
- ✓ **Deploy side panel hidden** + `.deploy-main` padding matches
  onboarding. The 7-step timeline still scrolls if it overflows.
- ✓ **Composer respects iOS safe area** via
  `padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px))`
  on `.composer`, and 16px+ `font-size` on `.composer-input` so
  iOS Safari doesn't auto-zoom on focus.
- ✓ **44px tap targets** on every interactive row (`.nav-item`,
  `.sb-item`, `.m-list-row`, `.shell__nav-item` clamped via
  `min-height: 44px`).
- ✓ **Library grid → 2-col** at phone widths
  (`.lib-grid { grid-template-columns: 1fr 1fr; gap: 10px; }`).
- ✓ **Skills + audit + PR rows simplify** at ≤760px: skill row
  drops the `.ct` category col, PR row drops `.branch` + `.who`.
- ✓ **Sync hero stacks** to a column with 14px gap; auto-cards
  drop the right border and pick up a bottom border (last cell
  borderless).
- ✓ **Settings rows stack their controls** so toggles and theme
  pickers go full-width below the label.
- ✓ **AppShell mobile breakpoint** dropped from 920px → 760px to
  align with everything else. Hamburger drawer + bottom tabs
  unchanged.

### Onboarding & deployment
- ✓ Identity → Fork → Token/Stripe → **Upgrades (optional)** → Deploy progress flow
- ✓ **Workers Paid opt-in** ($5/mo) — Stripe checkout intent created on click,
  flow.workersPaid carried into the deploy step list as
  `activate-workers-paid`. Settings → Cloudflare reflects "Workers Paid · $5/mo"
  vs. "Free tier" after the deploy lands.
- ✓ **Custom domain search & purchase** — fuzzy domain finder powered by
  `/api/cf-domain/search`. Live path: proxies to CF Registrar
  `/availability` with the user's Bearer token + account id. Local path:
  deterministic FNV-1a hash returns ~80% availability across 9 TLDs
  (.com .ai .dev .io .app .run .so .co .me) plus suffix variants
  (-ai, hq, lab, co, run) so the UX is testable without burning DNS quota.
  Available results sorted by price, taken results shown muted + struck-through.
  Picking a domain creates a Stripe checkout, threads through deploy, and the
  deploy timeline gains a `Registering <domain>` step. Hostname returned by
  the SSE `done` event prefers the custom domain over the .workers.dev
  fallback.
- ✓ Sidebar identity surfaces the custom hostname + a "paid" pill when
  Workers Paid is active.
- ✓ Server-generated agent names (2-word hyphenated, e.g. `cottony-paradox`)
- ✓ **One-click CF token URL** — generates the canonical JSON-array
  `permissionGroupKeys` format Cloudflare's dashboard expects, with
  `accountId=*`, `zoneId=all`, and the 18 PRD scopes pre-selected. Verified
  via `GET /api/cf-token/url`.
- ✓ Token validation via `/user/tokens/verify` (live CF API)
- ✓ Subdomain pick + Access email list (default = owner, optional extras)
- ✓ SSE-driven deploy progress timeline (snapshot + 7 step events)

### Library
- ✓ **Real R2-backed Library** — `/api/artifacts/list/<agent>` lists every
  R2 object under `artifacts/<agent>/`, infers type from `Content-Type` +
  filename heuristics (image/code/document/table/webpage/slides/chart),
  reads `customMetadata.title` + `version`, sorts newest first. Library
  screen pulls from this endpoint, supports 9 filter chips and fuzzy
  search by title/key, shows file size + relative-time per tile. Falls
  back to a 4-entry sample set with a "sample entries shown" hint when
  R2 is empty.
- ✓ **Inline artifact viewer** — clicking a tile (for real R2 entries —
  stubs route back to the chat) opens the **shared `ArtifactPreview`
  modal** (also used by Knowledge), which fetches `/api/artifacts/<key>`
  and renders by content-type: inline `<img>`, sandboxed `<iframe>` (HTML
  + PDF), `<pre>` for code/text. **Code-text gets cheap syntax
  highlighting** via language detection (file extension + content-type)
  across ts/js/py/go/rs/sql with keyword / string / number / comment
  token classes. Download / Open-in-new-tab in the footer, Esc +
  backdrop click to dismiss.

### Smithers JSX skill compiler
- ✓ **`apps/platform/src/shared/smithers.ts`** ships a hand-written
  recursive-descent parser for `<workflow name="…"><step name="…"
  requiresApproval tool="…">body</step></workflow>` and the reverse
  `renderPlanAsJsx`. No babel/eval, no runtime React dep — small enough
  to run inside the Worker as well as the SPA.
- ✓ `POST /api/skills/compile` and `POST /api/skills/render` round-trip
  between the JSX authoring shape and the JSON plan PlanCard renders.
- ✓ **Skill author UI** — new "Author a skill" panel on the Skills page.
  Two-column editor (Smithers JSX on the left, compiled preview on the
  right with step-by-step JSON rendering), debounced 280ms compile via
  `/api/skills/compile`, "Save skill" persists via `/api/skills` and
  returns the live PR URL when the user has `shareSkillsUpstream` on.
  Starter template seeds a 3-step morning routine.

### Workspace switching on boot
- ✓ App.tsx now fetches `/api/workspaces` on first mount and seeds
  `flow.agentName` from the active workspace when the user hasn't gone
  through onboarding. Returning users land directly in their active
  workspace's chat surface.

### Chat & artifacts
- ✓ **Working Doc chip** (PRD §4) — pinned summary above the thread feed
  the agent maintains for context. Opens via "+ notes" button in the feed
  header, editable inline, persists **per thread** in a new
  `working_docs` DO SQLite table (`getWorkingDoc` / `setWorkingDoc` RPC;
  routes at `/api/threads/<agent>/<threadId>/working-doc`). Loads on
  thread switch, saves on textarea blur. 8KB body cap so it can't bloat
  prompt context. **The doc is now prepended to every LLM system
  prompt** (`## Working notes for this thread (always read first)`) when
  non-empty — survives compaction by design, exactly the PRD §4 promise.
- ✓ **Train-mode Save-as-Skill** is real — clicking "Save" in the sheet
  POSTs to `/api/skills` which writes the `SKILL.md` body to R2 under
  `skills/local/<id>/SKILL.md`, inserts the metadata row into D1
  `skills` with `source: 'local'`, and appends a `skill_save` row to the
  audit log. The new skill immediately shows up in the Settings → Skills
  catalog list. **When the user enables `shareSkillsUpstream` in Settings →
  Behavior**, the same save also calls the shared `proposePr` helper to
  open a draft PR against `OPENTHINK_UPSTREAM_REPO` with the SKILL.md body
  as the patch.
- ✓ **Live tool-call chips** under assistant messages — render `tool-start`
  → `tool-done` → `tool-blocked` WS frames as animated pills (spinning
  ring while running, green check when done, red ⊘ + reason when blocked
  by the spend cap). Up to the last 4 events visible per turn.
- ✓ **Code-mode pill** in the composer next to Auto / Plan first / Train —
  cycles `always` → `smart` → `off` on click, dispatches `set-code-mode`
  over the WS bridge, persists alongside other Behavior settings.
  Visual treatment: filled accent for `always`, ghost mono for `smart`,
  dashed border for `off`.
- ✓ **Tool-call results are expandable** — clicking a `done` or `blocked`
  chip reveals an inline panel rendering the structured result: researcher
  shows source URL + bytes + summary, coder shows summary + risk %  +
  severity-coded issues + suggestions, unknown tools fall back to a
  pretty-printed JSON dump. Block reasons render as italicized notes.
- ✓ Three-column shell — sidebar, thread feed, artifact canvas
- ✓ **Persistent sidebar** across Chat / Library / Learning / Skills /
  Settings (via the new `AppShell` wrapper; the sidebar no longer disappears
  when leaving the chat surface)
- ✓ Mobile single-pane mode with bottom tab bar and slide-out drawer
- ✓ WebSocket bridge: shell ↔ Orchestrator DO with thread persistence in
  DO SQLite; falls back to local echo when the worker is down
- ✓ 8 artifact types, 3 window modes, thumbnail strip
- ✓ Train mode plan card (approve/edit/reorder/delete/add) + Save-as-skill
  sheet with diff preview
- ✓ Composer modes (Auto / Plan first / Train) — server-side: Plan + Train
  prepend a numbered-steps system prompt; Auto runs normal completion

### Search
- ✓ **Command palette (⌘K / Ctrl+K)** — full-screen blur sheet, 4 tabs
  (Threads / Artifacts / Memories / Sections), keyboard nav (↑↓ Enter Tab
  Esc), groups threads by Today / Past week / Past month. Sidebar search
  click also opens it. **Threads tab pulls real data** via
  `/api/threads/<agent>` (Orchestrator.listThreads over DO RPC); clicking
  a thread **deep-links via `#/shell?thread=<id>`** — Shell hydrates from
  `/api/threads/<agent>/<threadId>` (returns thread row + tail of 50
  messages) on mount, populates the feed before the WS bridge connects.

### Thread inline rename + archive + restore + hydration
- ✓ Clicking the feed title in Shell turns it into an editable input
  (Enter to save, Esc to cancel, blur to commit). Optimistic local
  update + `POST /api/threads/<agent>/<threadId>/title` persists via
  `Orchestrator.renameThread`. Idempotent — silently no-ops on unknown
  threadId.
- ✓ Each sidebar thread row reveals an `×` archive button on hover.
  Click optimistically removes from the sidebar, jumps active to the
  next remaining thread, and POSTs to
  `/api/threads/<agent>/<threadId>/archive` (Orchestrator flips
  `threads.archived = 1` in DO SQLite — messages remain, restore is
  lossless).
- ✓ `▸ Show archived` toggle below the recent-threads list lazy-loads
  `/api/threads/<agent>?archived=1`; each archived row has a `↺` restore
  button that POSTs `archived: false` and re-pulls the active list.
- ✓ Shell hydrates the sidebar from real `Orchestrator.listThreads` on
  mount — the Welcome stub only appears for first-run agents with zero
  rows. Deep-link `?thread=<id>` still wins when present.
- ✓ `+ New task` in the sidebar synthesizes a fresh thread (client-side
  UUID; the first WS send materializes the row in DO SQLite via the
  Orchestrator's `INSERT OR IGNORE` path). Works from subpages too via
  `#/shell?newThread=1`. Custom event `openthink:new-thread` keeps
  AppSidebar agnostic about Shell internals.

### Automation & spend
- ✓ Settings → Automation: full_auto / smart_auto / manual radio
- ✓ **Approval mode persists via KV** and is pushed to the Orchestrator DO
  over the WS bridge on next chat connection. Verified end-to-end via
  Chrome connector + `curl /api/settings/<agent>`.
- ✓ Spend cap UI + per-tool breakdown stub
- ✓ Spend gating hook on the Orchestrator (`checkSpend`) — call sites land
  with the live tool dispatch in the next iteration.

### Agent orchestration
- ✓ Workers AI conversational replies via `@cf/meta/llama-3.1-8b-instruct`
- ✓ Orchestrator DO with SQLite-backed threads/messages/policies
- ✓ **Intent routing to specialist sub-agents over DO RPC** — when the user
  prompt matches research/code intent, the Orchestrator calls
  `RESEARCHER` or `CODER` via in-Worker DO fetch (no public internet hop),
  attaches the result as a `ToolCall` to the assistant message, and emits
  `tool-start`/`tool-done` frames over the WS bridge.
- ✓ Code-mode toggle (`always` / `smart` / `off`) stored in DO memory and
  settable via `set-code-mode` WS message
- ✓ All 6 DOs declared and bound: Orchestrator, Researcher, Coder,
  MemoryAgent, Judge, BrowserSession
- ✓ 2 Workflows declared and bound: GoalWorkflow, RetrainingWorkflow
- ✓ Daily 08:00 UTC cron retraining trigger

### Settings page (PRD §7)
- ✓ 12 tabs: General · **Behavior** · Automation · Spending · **Knowledge** ·
  **Invocations** · Cloudflare · Access · Skills · Sync · **Audit log** · Danger zone
- ✓ **Behavior** consolidates prompt editor + template seeds (Personal
  assistant / Researcher / Coder / Writer) + Orchestrator/Sub-agent model
  pickers + Code-mode toggle + Extended thinking toggle w/ token budget
  slider + Response style radios (concise/balanced/detailed). Every change
  persists via `PUT /api/settings/<agentName>`; the Shell reads them back
  on socket-open and pushes the relevant state into the Orchestrator DO.
- ✓ **Knowledge** lets the user pin URLs, text snippets, **and arbitrary
  files** (up to 5 MB, multipart-uploaded to R2 with content-type preserved)
  the agent should always have in context. Backed by `/api/knowledge/<agent>`
  with `/url`, `/text`, `/file` ingestion routes. Drag-and-drop drop zone
  with active-state styling + size-limit message. Pin/unpin and remove
  remain optimistic. **Clicking any item opens a shared `ArtifactPreview`
  modal** that fetches from `/api/artifacts/<key>` (or iframes external
  URLs directly) and renders by content-type: images inline, HTML in a
  sandboxed iframe, PDFs in an iframe, everything else as `<pre>` text.
  **Pinned items (max 6, ~2KB total cap) get injected into every LLM
  system prompt** under `## Pinned knowledge` — URLs by `(title — url)`,
  text snippets inlined (truncated at 600 chars), files surface as a
  fetch-via reference so the agent knows the R2 key exists.
- ✓ **Invocations** lists recent runs with When / Thread / Model /
  Duration / Tools / Status / Cost columns plus a 3-stat summary header
  (runs in 24h, $ spent in 24h, on this page). After migration
  `0002_trajectory_cost_columns` ran, the route reads native
  `cost_cents` / `duration_ms` / `tool_call_count` / `status` columns
  directly — no JSON parse at query time. Queue consumer in
  `queues/trajectories.ts` populates them on every turn, with a graceful
  narrow-INSERT fallback if migrations haven't applied yet.
- ✓ **Audit log** renders every consequential action — tool_call /
  approval / spend / sync / pr_back / skill_save / provision — with kind
  filter chips, color-coded pill per kind, JSON payload pretty-print.
  Backed by `/api/audit/<agent>` reading D1 `audit_log`. Supports
  `from` / `to` date range + `q` substring search across the payload
  JSON. **Infinite scroll** via `before` cursor — IntersectionObserver
  sentinel arms 200px before the bottom of the list; each page is 50
  rows; response carries `{hasMore, oldest}` so the next page request is
  exact. Debounced 220ms.

### Skills, learning, sync, stripe
- ✓ Skills catalog with 6 packs (Cloudflare/Anthropic/OpenAI/aihero/gstack/
  gbrain), per-skill toggle, when-to-use hints
- ✓ Learning summary cards (Skills/Memories/Rubrics), 5 memory categories,
  pending suggestions list
- ✓ Sync panel: status / pull / apply / propose-pr endpoints, diff
  rendering with syntax highlight
- ✓ Stripe routes: checkout / webhook (signature stub) / spend summary

### `/api/goal` long-running runs
- ✓ `POST /api/goal/run` creates a GoalWorkflow run with optional pre-built
  plan; persists a seed snapshot in KV so polls right after creation see
  something.
- ✓ `GET /api/goal/<id>` returns the latest progress snapshot.
- ✓ `POST /api/goal/<id>/approve` records the approval intent for the
  workflow's human-in-the-loop gate.
- ✓ **Chat-composer `/goal <text>` slash command** — Shell detects the
  prefix in `send()`, POSTs to `/api/goal/run`, and renders an inline
  `GoalCard` that polls `/api/goal/<id>` every 1.5s while the run is
  active. Each step shows pending / running (spinning glyph) / done
  (green) / error (red) / awaiting_approval (orange with Approve / Skip
  buttons). Card pins to the originating thread.

### Sync panel
- ✓ `Settings → Sync` now polls `/api/sync/status` every 60s for live
  upstream drift. Manual refresh button (↻) sits in the header next to
  "last checked Xm ago"; disabled state while in flight. The KV-cached
  60-second window on the worker keeps the load fixed even with many
  open tabs.

### Loading polish
- ✓ Generic `.ot-skel` shimmer class added to tokens.css — animated
  gradient that respects `prefers-reduced-motion` via the existing
  `--ot-dur-*` token reset.
- ✓ Library shows 8 skeleton tiles while waiting on R2 list.
- ✓ Invocations shows 4 skeleton rows in the table while loading.
- ✓ Audit log shows 6 skeleton entries while loading; the existing
  infinite-scroll sentinel still arms after the real rows render.
- ✓ Sidebar `Recent threads` grew a `clear` action that confirms then
  bulk-archives every visible thread one by one (each goes through the
  existing `onArchiveThread` so the optimistic remove + active-thread
  hop logic still applies).

### Per-thread WS scoping
- ✓ Orchestrator DO tracks a per-socket `subscribe-thread` registration
  (WeakMap keyed by WebSocket). Broadcasts that include a `threadId`
  only fan out to sockets subscribed to that thread; unsubscribed sockets
  continue to receive everything (legacy behavior the verify suite relies
  on). Shell sends `unsubscribe-thread` on thread switch + on unmount so
  the next tab doesn't silently leak.
- ✓ **Cross-tab thread mutations** — `renameThread` + `archiveThread`
  emit `thread-renamed` / `thread-archived` frames with `id` (not
  `threadId`) so the scope filter doesn't restrict them; every tab's
  sidebar reconciles via `socket.threadEvent` on a ts-keyed effect.
  Rename updates the title in place, archive prunes the row (with active-
  thread hop if the user was viewing it), restore re-pulls the canonical
  list from the DO.

### Cross-tab Knowledge sync
- ✓ Settings → Knowledge pane now re-polls `/api/knowledge/<agent>`
  every 10s while idle (not busy, not previewing) so a second tab's add /
  pin / remove surfaces in this one without manual refresh. Skipped
  during in-flight writes so optimistic state isn't clobbered.

### Sync diff per-file collapsible
- ✓ Dry-run diff is now parsed into per-file blocks (`diff --git` or
  fallback `+++ b/`), each rendered as a `<details>` with the path,
  `+N` adds, `−N` removals in the header. Single-file diffs default
  open, multi-file collapses everything so the user gets a filename
  overview first. Diff coloring (add / del / hunk / ctx) preserved
  inside each expanded block; the container can scroll to 540px before
  paging.

### Mobile + desktop styling pass
- ✓ Settings nav becomes a horizontal-scrolling pill strip below 800px
  (sticky glass header with snap-points) instead of stacking vertically,
  so the actual settings content stays above the fold on phones. The
  active tab is filled with the accent color for clear orientation.
- ✓ Both mobile bottom tab bars (AppShell + Shell) gained a 22×2px
  accent line above the active tab, 56px min tap target, and a 92%
  scale on `:active` for tactile feedback. Glyph scales to 1.1× on
  active.
- ✓ AppShell hamburger bumped to 44×44 with shadow + active-scale,
  matching Apple HIG tap targets.
- ✓ Library / Skills / Learning gained `≤720px` breakpoints: heading
  drops 36→28px, padding tightens to 18px, Library filters scroll
  horizontally instead of wrapping, grid minmax drops to 140px so 2
  tiles still fit on narrow phones, Learning summary card metric drops
  48→36px.

### Sidebar live-reorder on new turn
- ✓ Every `message` WS frame now also surfaces in `socket.threadEvent`
  as `{kind: 'bumped', id, ts}`. Shell folds it by removing the matching
  thread row, splicing it back at the head with `updatedAt = ts`. When
  the bumped id isn't in the local list (new thread on another tab) the
  effect re-pulls the canonical list. Cross-thread message leaks
  (cross-broadcast picked up by a tab subscribed to a different thread)
  are also blocked at the Shell merge step — the active-thread filter
  drops anything that doesn't belong to the visible feed.

### Mobile command palette
- ✓ Below 640px the palette transitions from "top-anchored card" to
  "bottom sheet": slide-up animation from the bottom edge, 18px top-
  rounded corners, 36×4px pull-handle bar, 92vh max height, 48px min
  tap target on each result. The `esc` kbd hint hides; a circular `×`
  button appears next to the input. Footer kbd legend collapses
  entirely (touch users don't need it). Bottom padding clears the iOS
  home-indicator via `env(safe-area-inset-bottom)`.

### Empty-state polish
- ✓ New shared `.ot-empty` primitive in `app.css`: dashed card,
  accent-soft circular glyph with a 4.2s breathing animation, display-
  serif headline, soft body copy, and a CTA action row. Respects
  prefers-reduced-motion via the `--ot-dur-*` token reset.
- ✓ Library shows the `◇` glyph empty when nothing matches, plus a
  "Start a task →" primary + "Clear filters" ghost when filters are
  applied.
- ✓ Skills shows the `⊕` glyph empty when the catalog is empty (no
  installed skills) — instructs the user to install a pack or save one
  from a Train-mode run.
- ✓ Learning shows the `✦` glyph empty under "Pending suggestions" when
  the retraining workflow has no pattern proposals — clarifies that the
  nightly cron will fill it.

### Sidebar hover-preview tooltip
- ✓ Hovering a non-active thread row in the sidebar (mouse pointer only —
  `pointerType !== 'mouse'` short-circuits on touch) fires a 400ms-
  debounced fetch of `?tail=1` from the thread endpoint, then renders a
  floating tooltip pinned to the right edge of the sidebar (234px left
  offset, 320px wide, 3-line clamp) showing the thread title, the last
  message's role + content preview (140-char truncated), and a relative
  timestamp. Cached by id so re-hovers are instant. Skeleton-row
  placeholders during the fetch. Hidden entirely on touch / ≤920px via
  `@media (pointer: coarse)`.

### Library viewer keyboard nav
- ✓ `ArtifactPreview` gained optional `onPrev` / `onNext` / `position`
  props. When supplied, ←/→ walk through the viewing list, two glassy
  44px chevron buttons flank the panel (positioned `max(12px, 50vw−540px)`
  so they hug the screen edge on wide monitors but hop closer to the
  modal on narrow ones), and a `N of M` pill appears in the header.
  Arrows are ignored when focus is in an input/textarea/contenteditable
  so the user can edit nearby fields without hijacking. Mobile chevrons
  shrink to 38px and snap to the screen edges.
- ✓ Library threads the prev/next handlers from its `visible` array, so
  filtering or searching narrows the walk to just the matching set.

### Sync apply → redeploy
- ✓ The diff viewer's "Apply & redeploy" button now actually fires
  `POST /api/sync/apply`, surfaces a `Queued · v<date>-1` chip in the
  footer on success, and the panel auto-closes after 900ms while the
  parent re-pulls `/api/sync/status` so the "behind upstream" pill
  resolves to "up to date". Both the apply and cancel buttons disable
  while in flight. Apply failures stay inline; "Try again." text in
  the footer until the user retries or cancels.

### Sidebar inline thread filter
- ✓ When the recent-threads list reaches 6+ entries, a small mono
  filter input renders below the section header. Case-insensitive
  substring match against thread titles, instant local filter (no
  fetch). Inline `×` clear button appears when the field has text.
  "No matches for "foo"" empty state when the filter zero-outs the
  list. The full ⌘K palette is still the right answer for global
  search across artifacts/memories/sections; this is just the local
  "find this thread in my recents" win.

### WebSocket auto-reconnect
- ✓ `useAgentSocket` now reconnects via exponential backoff (500 ms →
  1 s → 2 s → 4 s → 8 s → 16 s → 30 s cap) after a dropped connection.
  The retry counter resets on every successful `open`, so a temporary
  glitch doesn't push subsequent flaps into long waits. The cleanup
  detaches all handlers + closes the socket on unmount so a stale
  closure can't trigger another reconnect from a previous `agentId`.
  The Shell's existing `subscribe-thread` effect fires automatically
  on state→'open' so the user's active thread re-subscribes without
  any extra wiring.

### Code copy button in artifact viewer
- ✓ The `CodePreview` block (the syntax-highlighted text view inside
  `ArtifactPreview`) gained a floating `⧉ Copy` pill at top-right. Hover
  fades it in on mouse, always visible on touch (`pointer: coarse`).
  Click copies the raw body via `navigator.clipboard.writeText`,
  transitions to `✓ Copied` for 1.5 s, then back. Falls through
  silently if clipboard is blocked (insecure context). Pure CSS-only
  hover-reveal so the chrome doesn't compete with the code body.

### Invocations CSV export
- ✓ Settings → Invocations gained an `Export CSV ↓` button in the
  summary row. Builds an RFC4180 CSV (header + one line per row,
  proper quoting for fields with commas / newlines / quotes), wraps
  it in a Blob with `text/csv;charset=utf-8`, and triggers download
  as `invocations-<agent>-<isoStamp>.csv` via a synthetic anchor
  click. Blob URL revoked on next tick. Disabled while loading or
  when the rows array is empty. Mobile (`≤720px`) keeps the 3-stat
  grid intact and parks the button on its own row.

### Audit-log row click → inline payload
- ✓ Each audit-log row defaults to a single-line collapsed header now
  (kind pill + one-line summary + timestamp + chevron). The summary
  is shape-aware per-kind: tool_call → `researcher.research → ok ·
  1.2s · $0.003`, spend → `+$0.005 from researcher`, sync →
  `op · v2026-05-16-1`, pr_back → `#142 · title…`, etc. Falls back
  to the first scalar key=value when the shape doesn't match.
  Clicking the row toggles the full JSON payload underneath with a
  180ms slide-in animation; the row border picks up the accent color
  when expanded. State is in-component (per-row `Set<id>`) so
  re-fetching/loading-more doesn't lose your open rows. Timestamp
  hides on ≤600px to keep the row tidy on narrow screens.

### Working-doc collapse toggle
- ✓ The pinned "Agent's notes" aside in the chat feed now toggles
  collapsed via a `▾ / ▸` button in the header. Collapsed state
  shows a one-line italic preview of the first 90 chars next to the
  pill so the user still knows what's in there without the full
  card weight. Edit button hides while collapsed (expanding to edit
  is one extra click). Per-thread preference (`Record<threadId,
  boolean>`) lives in component state so each thread remembers its
  toggle for the session. Padding tightens when collapsed (6×12 vs
  10×14) so the row hugs its single line.

### Invocations click-to-expand trajectory detail
- ✓ New route `GET /api/invocations/<agent>/turn/<turnId>` returns the
  full trajectory row: parsed payload (input / output / toolCalls)
  plus Judge rubric scores (overall / faithfulness / relevancy /
  schema). Falls back to a narrow payload-only SELECT when the rubric
  columns aren't present yet, and to a deterministic stub when the
  table is empty.
- ✓ Each Invocations row now toggles an inline detail panel below it
  on click. Side-by-side `Prompt` / `Response` blocks (max 600 chars,
  monospace text wraps with `pre-wrap`, scroll inside the 200px box).
  Tool calls render as a list with the tool name in a `<code>` chip +
  status + duration. Judge scores render as a grid of three: label,
  bar (gradient fill scaled 0..1), numeric. The detail-row foot
  surfaces `turn <turnId> · thread <threadId>` for debugging.
- ✓ Detail fetch is lazy + cached in component state (`Record<turnId,
  InvocationDetail>`) so re-toggling a row is instant. Open row gets
  an accent-orange 3px left inset border + bg lift.

### Sidebar archive count badge
- ✓ AppSidebar pre-fetches `?archived=1&limit=50` on mount + whenever
  `threads.length` shifts (a thread was archived/restored) and shows
  the count in a small pill next to the "▸ Show archived" toggle. The
  toggle hides entirely when count is 0, so a fresh agent doesn't see
  a "Show archived (0)" sitting there. Past 50 archived rows we show
  "50+"; the existing list cap of 25 in the actual expanded panel is
  unchanged.

### Audit log expand-all / collapse-all
- ✓ When entries are present, a thin bulk-action row appears between
  the filters and the list: `N entries · M expanded` on the left, two
  ghost-pill buttons on the right (`Expand all` / `Collapse all`).
  Either disables itself when its terminal state is already reached
  (all expanded → disable Expand all; none expanded → disable Collapse
  all). The pills use the same `--ot-accent` hover treatment as the
  rest of the page.

### Keyboard shortcut hints panel
- ✓ Pressing `?` from anywhere outside an input/textarea/contenteditable
  opens a `ShortcutsHelp` modal — single source of truth listing all
  shortcuts implemented across the app, grouped by surface (Global,
  Chat, Library viewer, Sidebar). Mac users see `⌘`, others see
  `Ctrl`, picked via `navigator.platform` sniff. Kbd chips have a
  bottom-shadow lift so they read like real keys. Esc dismisses;
  scrim click dismisses; circular × dismisses.
- ✓ Mounted at the App root next to the CommandPalette so the panel
  is available on every authenticated surface (and even on the
  landing/onboarding pages — pressing `?` works anywhere).

### Composer attachment paste
- ✓ Pasting an image into the chat composer (⌘V/Ctrl+V from a
  screenshot, copied photo, etc.) captures the `image/*` clipboard
  item, refuses files >5MB inline (with a one-line hint appended to
  the composer), caps at 3 attachments per message, and renders a
  thumbnail chip below the textarea showing the 36×36 thumb,
  filename, size, and a remove `×` button. Chips animate in via a
  4px slide-up.
- ✓ On send, the chip metadata is folded into the user content as
  `[image attached: name (size, type)]` per chip so the agent at
  least sees an image was offered. Full multimodal byte-piping to
  the model is left for a separate iteration; this gives the user
  the muscle-memory paste affordance now.

### Settings save-toast
- ✓ New `ToastHost` mounted at the App root listens for
  `openthink:toast` custom events. Any code path can call
  `showToast('Saved', 'ok' | 'err' | 'info')` from `shell/Toast.tsx`
  to surface transient feedback. Toasts stack bottom-right (or
  bottom-center on mobile, clearing the tab bar via
  `env(safe-area-inset-bottom)`), auto-dismiss in 2.4 s, click to
  drop early. Pill-shaped with an inline glyph: ✓ for ok, ✕ for err
  (red bg), i for info.
- ✓ Wired into Settings → Automation (`Automation set to <mode>`),
  Settings → Behavior (`Behavior saved`), and the new
  Invocations CSV export (`Exported N rows`). Other save paths can
  opt in by adding a single `.then(() => showToast(...))` line; the
  pattern is in place and the network errors get an `err` toast
  in those same code paths.

### In-thread search
- ✓ Ctrl/⌘+F in the chat surface now opens a sticky search bar
  pinned below the feed header (also reachable via the "⌕ search"
  button in the header). Type a query → matches highlight inline
  via `<mark class="shell__msg-match">` spans; the active match
  gets a stronger accent fill + soft glow ring. Counter shows
  "N / M" or "no matches"; ↑/↓ buttons and ↑/↓ arrow keys walk
  between matches with wraparound, Enter advances (Shift+Enter
  back). Escape closes; smooth scroll-into-view keeps the active
  match centered. Search state lives in the Shell component so it
  follows the active thread (clearing on close).

### Library bulk-select + delete
- ✓ New `DELETE /api/artifacts/<id>` endpoint + `POST /api/artifacts/delete`
  for batch (accepts `{ keys: string[] }`, fans out to `R2.delete` in
  parallel, returns deleted count). Idempotent — missing keys still
  resolve.
- ✓ Library filter row gained a `Select` chip that toggles bulk mode.
  In mode: tile clicks add/remove from a `Set<id>` instead of opening
  the viewer; selected tiles get a 22×22 round check badge in the
  top-right and a 2-px accent glow. A floating action bar shows
  `N selected` + `Select all` + `Delete N`. Confirm dialog before
  destructive call. Stub rows (sample data) are silently excluded
  from selection — they don't exist on R2.
- ✓ Successful delete emits a `Deleted N artifacts` toast and rebuilds
  the local row list from the in-memory state (no full refetch
  needed). The Library viewer ←/→ walk uses `visible` so removed
  artifacts disappear from the carousel immediately.

### Message-level copy action
- ✓ Each message in the chat feed gets a small floating action row
  in the top-right (26×26 chip). On mouse hover the row fades in;
  on touch (`pointer: coarse`) it's always visible since there's no
  hover. Click ⧉ copies the full message content via
  `navigator.clipboard.writeText` and fires a `Copied message`
  toast (or `Copy failed` on `err` if clipboard is blocked).

### Composer slash + @-mention autocomplete
- ✓ Composer detects two trigger contexts on every keystroke:
  - `slash` — buffer starts with `/` and the caret is in the first
    token. Static command list: `/goal`, `/help`.
  - `mention` — `@<token>` within the last 30 chars before the
    cursor (no whitespace inside the token). Filters threads first
    (max 4) then skills (lazy-loaded from `/api/skills` on first
    trigger, cached for the session).
- ✓ Popover anchors above the textarea with a glass-y dropdown:
  category title + items with a 110px label column and a hint on
  the right. Hover or ArrowUp/ArrowDown highlights an item;
  Enter or Tab inserts the chosen completion (splices the active
  token from `tokenStart` to current cursor) and closes; Esc
  closes without inserting. Click an item to insert directly. The
  textarea blur drops the popover after 150ms so click-to-pick
  still lands.
- ✓ `/help` is a client-only slash — picking it (or typing it +
  Enter) re-dispatches a synthetic `?` keypress so the existing
  ShortcutsHelp modal opens, and clears the composer. `/goal …`
  continues to route to the existing goal-run path on send.

### GoalCard cancel
- ✓ New `POST /api/goal/<id>/cancel` route — idempotent: flips the
  KV snapshot's run-level `status` to `cancelled` (preserving any
  terminal `completed`/`error`/`aborted`), nudges in-flight per-step
  `state` to `error` so spinners stop, and writes a
  `goal-cancel:<id>` sentinel for the workflow body to pick up on
  its next loop (Workflows can't be killed mid-step from a worker;
  this is the cooperative path).
- ✓ GoalCard header now shows a `✕ Cancel` pill while the run is
  still in flight (`queued` / `running` / `awaiting_approval`).
  Confirm dialog → POST → optimistic local flip to `cancelled` so
  the UI doesn't keep polling, then the next /api/goal/<id> poll
  confirms from KV. Wired into the toast host: `Goal cancelled` on
  success, `Cancel failed` on err. Status pill picks up the
  cancelled-style border + `⊘ cancelled` footer.

### Thread pin-to-top
- ✓ Threads table grew a `pinned INTEGER NOT NULL DEFAULT 0` column
  (CREATE includes it; existing DOs get an idempotent ALTER guarded
  by try/catch). `listThreads` orders `pinned DESC, updated_at DESC`
  so pinned threads always float to the top regardless of recency,
  and now returns `pinned: boolean` on each row.
- ✓ New `pinThread(threadId, pinned)` RPC + `POST
  /api/threads/<agent>/<id>/pin` route. Broadcasts `thread-pinned`
  for cross-tab consistency. Idempotent — silent no-op on unknown
  id.
- ✓ Sidebar surfaces pin/unpin via a `☆/★` button next to the
  archive `×`, hover-revealed for un-pinned threads but always
  visible (accent-orange) for pinned ones. Pinned threads get a
  📌 inline glyph in front of the title + bold weight; the sidebar
  groups them under a `PINNED` mono label above a dashed divider,
  with the rest of "Recent threads" below. Pinning optimistically
  re-sorts the local list + POSTs the change.

### Spending tab live-update
- ✓ `useAgentSocket` now dispatches `openthink:spend` on every
  `spend` frame (carrying the latest rollup) and
  `openthink:tool-blocked` on every cap-hit, both as custom DOM
  events. The Spending settings tab lives outside the Shell subtree
  but the global event bus makes the wiring trivial — listeners on
  mount, removed on unmount.
- ✓ The Spending tab folds `openthink:spend` into its local state
  immediately so the cap progress bar moves the moment a tool
  charges, no 5s poll lag. `openthink:tool-blocked` triggers an
  immediate refresh + a red-tinted inline banner ("Spend cap
  reached · `tool` was blocked · reason") that auto-dismisses after
  8s or via `×`.

### Sync status refresh on focus
- ✓ `SyncPanel` adds `visibilitychange` + `focus` listeners on top
  of the existing 60s auto-poll. When the tab becomes visible (or
  window regains focus), the panel re-pulls `/api/sync/status` —
  the auto-interval may have been throttled by the browser while
  the tab was backgrounded. 10s throttle prevents thrashing on
  rapid alt-tabs. The cached 60s KV layer on the worker absorbs
  the extra load.

### Thread export to markdown
- ✓ New `⬇ export` button in the feed header next to search /
  + notes. Pulls the full thread tail (up to 200 turns) via
  `/api/threads/<agent>/<threadId>?tail=200`, formats as a
  markdown file with a `# <title>` heading, an italic byline
  (`agent · thread id · exported <date>`), an `---` divider,
  then `## <role> · <ISO timestamp>` per message followed by the
  body. Slug-safe filename: `thread-<slug>-<isoStamp>.md`. Blob
  download via synthetic anchor click, URL revoked after 500ms.
  Disabled when no active thread / empty feed. Fires an
  `Exported N messages` toast on success, `Export failed` on err.

### Per-tool spend chart
- ✓ Settings → Spending replaces the per-tool table with a
  stacked horizontal bar showing each tool's share of today's
  spend (8-color rotating palette) + a 2-column legend below
  with swatch, tool name, `$X.XX`, and percent share. Hovering a
  bar segment shows a tooltip `tool · $cost · N%`. Brightness
  bumps on hover for visual feedback. Mobile collapses the legend
  to a single column.

### Skills search filter
- ✓ Installed-skills section gained a filter row above the list:
  a search input (matches name / description / when-to-use,
  case-insensitive) + a row of source chips (`all` + whatever
  sources are actually present in the loaded set, e.g.
  `cloudflare`, `anthropic`, `local`). Right-aligned `N / total`
  counter. `× clear` chip appears when any filter is active.
  Empty-result state shows a small "No skills match this filter"
  hint instead of an empty list. Wraps gracefully on mobile.

### Bulk thread export
- ✓ Settings → General gained an `Export all threads ↓` button.
  Pulls `/api/threads/<agent>?limit=50`, then fetches each
  thread's tail (200 turns) in cohorts of 6 to avoid hammering
  the DO. Concatenates into one big markdown file with a
  top header, an `---` divider per thread, and the same
  `## <role> · <ISO ts>` per-message format the single-thread
  export uses (one parser for both). Filename:
  `<agent>-all-threads-<isoStamp>.md`. Empty-thread case
  surfaces as `Exported 0 threads` info toast.

### Library tile rename
- ✓ New `PATCH /api/artifacts/<key>` endpoint writes the new
  title to KV under `artifact-title:<r2 key>`. The list
  endpoint reads KV first, falls back to R2 customMetadata
  (so reading is one extra parallel KV `get` per row, which is
  cheap). `DELETE /api/artifacts/<key>` now also clears the
  override so a future upload starts clean.
- ✓ `ArtifactPreview` got optional `onRename(next) => Promise<bool>
  | bool`. When supplied, the title becomes click-to-edit: click
  to focus an inline input, Enter to commit, Esc to cancel,
  blur to commit. Library wires this to PATCH the new title +
  reflect locally via the `Renamed` / `Rename failed` toast.

### Automation per-tool deny list
- ✓ Settings → Automation gained an "Always require approval for
  these tools" panel below the mode picker. Each tool name is a
  removable accent-soft pill; an input + Add button below extends
  the list. Persists via `PUT /api/settings/<agent>` as
  `denyTools: string[]`. Prefix-match supported — adding `coder.`
  denies `coder.exec` and `coder.review` both.
- ✓ Orchestrator's `checkSpend()` now reads the deny list from KV
  on every check. Denied tools short-circuit with
  `{ allowed: false, reason: 'tool_denied' }` regardless of mode,
  so even Full Auto can't auto-run them. The block surfaces as a
  normal `tool-blocked` WS frame → audit_log row + (when on the
  Spending tab) the inline red banner.
- ✓ Fixed a latent bug while wiring this: the settings PUT route
  was full-replace, which meant Behavior saves clobbered
  Automation saves and vice versa. Now does a shallow merge with
  the existing blob so partial PUTs preserve the unchanged keys.

### Knowledge bulk-clear
- ✓ New `DELETE /api/knowledge/<agent>` route that drops every
  knowledge item for the agent in one shot. Drops blob-backed
  files from R2 in parallel (best-effort; missing blobs don't
  fail the route), then writes an empty list back to KV. Returns
  the count cleared.
- ✓ Settings → Knowledge gained a `Clear all` ghost button (red-
  tinted hover) above the form. Confirm dialog before fire; busy-
  state disables it during the call. Optimistic clear with rollback
  on error. Wired into the toast host — `Cleared N items` on
  success, `Clear failed` rolls back local state.

### Sidebar workspace quick-pick
- ✓ The identity avatar in the sidebar footer is now a button —
  click opens a small popover above the row listing every
  workspace. Active workspace gets a `✓`; clicking another POSTs
  to `/api/workspaces/<id>/activate` and reloads into `#/shell`
  so the App's bootstrap effect picks up the new agent. The
  agent name remains a link to the full Workspaces screen via
  the second column of the row + a `Manage workspaces →` footer
  link.
- ✓ Workspaces list is lazy-loaded on first open and cached for
  the session. Click-outside and Escape both close the popover.

### Deploy progress retry
- ✓ New `POST /api/deploy/<id>/retry` route that rewinds the KV
  snapshot: resets every step from the first errored one back to
  `pending` (clearing `durationMs` + `error`), bumps `startedAt`
  to "now", and returns `retried: N`. Idempotent — no-op when no
  step is in error. The actual re-execution is the existing
  stream endpoint's job; this just rewinds state.
- ✓ DeployProgress detects an errored step and renders an inline
  banner with the step label, the error message in a mono pane,
  and a `Retry from <step> ↻` primary + `Start over` ghost.
  Retry POSTs + bumps a `streamKey` state which re-mounts the
  EventSource, so the user gets a fresh stream of the now-pending
  steps. `Start over` bounces to `#/onboarding/identity` for the
  escape-hatch case.

### Canvas pane drag-resize
- ✓ Shell grid grew a 4th column (`8px`) for a draggable resizer
  between thread feed and canvas pane. Drag with pointer events,
  clamped to `[320px, windowWidth − 220 − 360 − 8]` so neither
  pane can collapse below its sensible minimum. Double-click
  resets to the default 1.4fr ratio. Choice persists in
  `localStorage.openthink:canvasPx` so it survives reloads.
- ✓ Grip styling: 2×28px rule that turns accent-orange on hover/
  active; the whole 8px gutter takes the `col-resize` cursor.
  Mobile (≤920px) hides the resizer entirely — single-pane mode
  doesn't have a meaningful split.

### Plan-card per-step output preview
- ✓ `PlanStep` interface gained optional `output: string` +
  `durationMs: number` so the orchestrator can attach the
  realized result of a step once it runs. The PlanCard renders
  a thin collapsible mono pane under any step in `done` or
  `error` state with output present: chevron + "output" /
  "error" label + duration; click toggles a 220px-max scroll
  pane with the truncated body (first 600 chars).
- ✓ Error states auto-expand on first mount so the user sees
  what went wrong without an extra click. Errored panes use
  a red-tinted border + accent-error label. State held in a
  component-local `Set<id>` so re-runs preserve open rows.

### Library tile star
- ✓ New `POST /api/artifacts/<key>/star` route writing
  `artifact-star:<key>` = "1" (or deleting on `starred: false`).
  List endpoint reads star flag in parallel with the rename
  override; rows sort by `starred DESC, uploadedAt DESC`.
  Single-artifact delete now clears the star flag alongside the
  title override so a future upload starts clean.
- ✓ Library tiles got a ☆/★ button (top-right, mirror position
  of the bulk-select check). Hover-revealed for unstarred,
  always visible accent-soft for starred. Click toggles star
  + optimistic local re-sort. New `★ Starred` filter chip
  added to the filter row — picking it shows only the starred
  set, with the existing search input still active.
- ✓ Refactored the tile from a `<button>` to a `role="button"
  tabIndex={0}` div so the star action can nest without an
  invalid-html button-in-button. Enter/Space on the tile still
  triggers the open-viewer flow.

### Sidebar collapse-to-icons
- ✓ `AppSidebar` gained a small `‹/›` toggle in the brand row.
  Click flips an `localStorage.openthink:sidebarCollapsed` flag
  and applies a `shell__sidebar--icons` class on the aside. Both
  `Shell.css` and `AppShell.css` use `:has(.shell__sidebar--icons)`
  to shrink the grid column from 220px → 56px on the same render
  (no React state in the parent layouts).
- ✓ Collapsed mode: brand text hides, "New task" / search shrink
  to 36×36 icon-only buttons, nav rows center their glyphs +
  drop the labels, thread list / budget / identity meta all hide.
  Identity avatar stays visible at 34×34 so the workspace picker
  still opens. Mobile (≤920px) doesn't honor the collapse — the
  sidebar already lives in a slide-out drawer.

### Learning page — memory inline edit
- ✓ New `GET /api/learning/memories` reads up to 50 active rows
  from D1 `memories` (importance > 0, ordered by updated_at).
  `PUT /api/learning/memories/<id>` supports partial patches
  (content / whenToUse / importance, zod-validated). `DELETE`
  soft-deletes by zeroing importance — mirrors MemoryAgent.remove
  so the vector index stays intact for future undo.
- ✓ Learning page now renders a new "Memories" section above
  Categories. Each row: category pill (color-coded per category),
  click-to-edit content (textarea with auto-grow rows), importance
  badge, × remove button. Edit commits on Enter or blur, Esc
  cancels. Optimistic local update + rollback + toast for both
  edit and remove. Skeleton rows show during the initial load;
  empty state explains memories accumulate during chat.

### Audit log per-row deep link
- ✓ Settings now parses `tab` + `id` from `#/settings?tab=...&id=...`
  on mount, so external links can land on a specific tab — and
  when `id` is present on the audit tab, the row auto-expands +
  scrolls into view + flashes a 1.6s accent box-shadow ring so
  the user spots which row matched. Tab clicks rewrite the hash
  via `history.replaceState` so back/forward navigation works.
- ✓ Each open audit row gained a footer action row with a
  `🔗 copy link` pill (writes the canonical URL to the clipboard
  + fires a `Link copied` toast) and a `id <prefix>` mono affordance
  surfacing the first 12 chars of the entry id for terminal-paste
  use. Border-top is dashed so the actions feel like a footer
  rather than part of the payload.

### Thread auto-summary title
- ✓ After the first assistant turn lands, the orchestrator's new
  `autoSummarizeTitle()` checks: (a) is the title still the default
  placeholder ("New thread" / "(untitled)" / falsy), and (b) is
  this the first assistant message in the thread. Both conditions
  via a single DO SQLite read. Then asks Workers AI for a 4-6 word
  title-cased name and routes the result through the existing
  `renameThread()` path so the broadcast fires and every tab's
  sidebar updates. Falls back to "first 6 words of the user prompt"
  if the LLM call fails or returns gibberish. Subsequent turns
  short-circuit so a user-renamed thread is never clobbered.

### Knowledge URL refresh
- ✓ New `POST /api/knowledge/<agent>/<itemId>/refresh` route that
  fetches the live URL (6s timeout via `AbortSignal.timeout`,
  32KB head-only read for cheap parsing), pulls the first
  `og:title` or `<title>` tag, sanitizes + clamps to 200 chars,
  and updates the item's title + `addedAt`. Failures return
  `ok: false` with the prior title so the client can hint.
- ✓ Knowledge tab gained a `↻ Refresh` ghost button next to
  Pin/Remove on `kind: 'url'` items. Click → POST → fold the new
  title back into local state + toast (`Refreshed: <title>` on
  success, `Refresh failed — page unreachable` on err).

### Deploy custom-domain DNS hint
- ✓ The deploy success card now renders an accent-left-bordered
  hint card when the resolved hostname matches the user's
  custom domain: "Custom domain may take a few minutes to
  propagate." Below the heading, a one-line micro-paragraph
  surfaces the `.workers.dev` fallback in a `<code>` so users
  with an impatient cursor have somewhere to go immediately
  while the DNS records propagate.

### @-mention chips in messages
- ✓ New `renderMessageBody()` helper in Shell.tsx parses
  `@thread:<name>` and `@skill:<name>` tokens out of message
  content and renders them as styled inline pills (mono font,
  colored fill by type — thread: blue, skill: accent-orange).
  Non-mention segments still flow through the search highlighter
  so `Ctrl/⌘+F` matches keep working in surrounding text.
- ✓ Mention pills render inside both assistant and user message
  bubbles. The user-bubble palette flips to a translucent-white
  fill so the pill doesn't disappear against the accent-soft
  background. Hover surfaces `type: name` as a title attribute
  for screen readers.

### Sync PR-back inline
- ✓ Sync panel actions row gained a `Propose PR upstream ↗`
  ghost button alongside `Pull latest`. Click → POST
  `/api/sync/propose-pr` → shows an inline green chip
  (`✓ #142 opened`) next to the buttons with a clickable PR
  link. Chip auto-dismisses after 12s; the recent-PRs section
  below also refreshes so the new PR shows up there too. Wired
  through the existing 60s status poll so the "behind upstream"
  banner reflects the right state on the next tick.

### Workspace pin from sidebar picker
- ✓ The sidebar workspace picker now puts pinned workspaces at
  the top (sorted alphabetically within the group), separates
  them from the rest with a faint dashed divider, and renders
  a 📌 inline glyph next to pinned names. Active workspace floats
  to the top of its group.
- ✓ Each row gained a ☆/★ pin button on hover (always-visible
  accent-orange when on). Click → POST
  `/api/workspaces/<id>/pin` (the existing toggle endpoint) +
  optimistic local re-sort. The picker item refactored from a
  single `<button>` to a `<div role="menuitem">` containing the
  activate button + the pin button so the two actions don't
  conflict as nested controls.

### Knowledge file upload progress bar
- ✓ The Knowledge file upload swapped `fetch()` for
  `XMLHttpRequest` so `xhr.upload.onprogress` can drive a live
  progress bar. State: `{ name, pct: 0..100 }`. Renders in the
  drop zone with the filename + percent and a 4px-tall accent-
  gradient fill. Pins at 100% for ~600ms after success so the
  user sees the confirmation before the bar unmounts. Cleared
  immediately on error (existing red error message takes over).

### Audit log CSV export
- ✓ Audit bulk-action row gained an `Export CSV ↓` button next
  to `Collapse all`. Builds an RFC4180 CSV (header + one row per
  entry, proper quoting), columns: When (ISO), Kind, Summary
  (the same shape-aware one-line summary the row header uses),
  Payload (JSON.stringify), Id. Filename:
  `audit-<agent>-<isoStamp>.csv`. Blob download via synthetic
  anchor + URL revoke. `Exported N rows` toast on success.

### Deploy step-log inline expand
- ✓ Each step in the DeployProgress timeline is now a button
  with a chevron at the right end. Clicking expands a mono
  code-block log pane below the step body (38px left margin
  to indent under the glyph column). Disabled when the step
  has no `log` array and no `error` message; the chevron only
  renders when a log is available.
- ✓ Errored steps auto-expand on first observation of the
  snapshot via a `useEffect` that grows the `logsOpen` Set,
  so the user sees the failure without an extra click. The
  log pane gets a red-tinted fill for errors so it stands out
  from the normal dark code-bg style.

### Learning memory category filter
- ✓ Memory list got a chip row above it: `all` + each category
  that actually has entries (others omitted to keep the row
  tidy). Each chip carries a numeric count badge. Picking a
  chip narrows the visible list; the active chip uses the
  accent-soft palette + an inverted count badge for clear
  state.
- ✓ Empty-filter message ("No memories in this category") shows
  when the picked category zeros out, so the user knows the
  filter is on rather than thinking the list broke.

### Command palette recent items
- ✓ Navigating from a palette result now records the picked
  item to `localStorage.openthink:cmdk-recent` (last 6, dedup
  by id, most recent first). On next open, the recent list
  loads fresh from storage so cross-tab picks reflect.
- ✓ Empty-query mode prepends recents (filtered to the active
  tab) as a `Recent` group above the tab's default list, with
  remainder items below for browsing. Typing a query falls
  back to the existing search pipeline.

### Sidebar nav badge counts
- ✓ AppSidebar pulls `/api/learning/summary` on mount + every
  60s, holding the `pending.count` in component state. When
  it's >0, the Learning nav row renders a small accent-orange
  pill (`N` or `99+` past two digits) right of the label.
- ✓ Collapsed-sidebar mode replaces the pill with an 8px
  accent dot in the top-right corner of the glyph so the
  badge remains visible without the label.

### Artifact preview image zoom + pan
- ✓ Image artifacts in `ArtifactPreview` now render through a
  new `ImageZoomer` subcomponent. Scroll-wheel zooms 1× → 6×
  (Math.sign + 0.18 step), drag-to-pan when zoomed, double-
  click resets to 1×. Floating top-right glass-pill controls
  (`−` / percent / `+` / ⌖ reset) for keyboard-friendly use.
  `cursor` flips between `zoom-in` / `grab` / `grabbing` so
  the affordance is obvious. `touch-action: none` makes touch
  trackpads pan instead of scrolling the page.

### Knowledge list drag-reorder
- ✓ New `PUT /api/knowledge/<agent>/order` route accepts
  `{ ids: string[] }`, reorders the KV list to match that
  sequence, and silently appends any items the client didn't
  enumerate (defensive against stale snapshots). Returns the
  new count. Idempotent + zod-validated.
- ✓ Knowledge tab items are now `draggable`. Drag → highlight
  drop target (accent-dashed top border + 2px translate),
  drop → local splice + persistOrder. Drop-state classes
  (`--dragging`, `--over`) keep visual feedback crisp. Cursor
  flips to `grab` / `grabbing` so the affordance is clear.

### Audit log → jump to thread
- ✓ Each open audit row's action footer now surfaces an
  `→ open in chat` ghost pill when the payload carries a
  `threadId` (most `tool_call` rows + approvals routed through
  the orchestrator). Clicking deep-links to
  `#/shell?thread=<id>` which Shell hydrates on mount.
  Defensive narrowing: accepts both `threadId` and
  `thread_id` field names since older audit rows used the
  D1 column casing.

### Orchestrator AI call timeout
- ✓ The Workers AI call inside the chat path now races against
  a 3.5s timeout. On timeout the assistant message comes back
  as "Workers AI didn't respond in time — try again?" so the
  WS round-trip completes within a bounded window. Real
  latency is typically 1-2s on llama-3.1-8b; the timeout
  catches hangs / network blips without changing the happy
  path. Fixed an intermittent verify-suite flake where slow
  AI responses were timing out the WS-test's 4.5s assertion
  window.

### Sync diff side-by-side view
- ✓ Diff viewer header gained a `unified / split` segmented
  toggle (right-aligned next to the close button). Choice
  persists to `localStorage.openthink:diffView` so the user's
  preference sticks across sessions. Unified is the existing
  inline +/- view; split renders before/after as two
  equal-width columns.
- ✓ New `SplitDiff` subcomponent walks a file's diff lines and
  groups consecutive `-` / `+` runs, then zips them into
  paired rows so removed + added lines align horizontally.
  Context lines render in both columns; hunk headers span
  both columns. Unpaired removes/adds get an empty cell
  opposite. Mobile (≤700px) collapses back to a single column
  since side-by-side gets cramped on narrow screens.

### Audit log relative time
- ✓ Audit row timestamps now render as relative ("5m ago",
  "3h ago", "2d ago") with the absolute date kept as the
  parent's `title` attribute for tooltip hover. Past 7 days
  falls back to the locale date string. Saves a lot of width
  in the row header and matches the timing format the rest
  of the app uses (Library tile age, sidebar tooltips).

### Settings → Cloudflare bindings detail
- ✓ New `GET /api/cf-bindings` route runs cheap `in env` checks
  against every canonical binding declared in wrangler.toml
  (6 DOs + 2 Workflows + KV + D1 + R2 + Queue + AI + Browser
  + Vectorize + Sandbox) and returns the bound/unbound state
  plus the kind tag. No fetches — synchronous reads only.
- ✓ Settings → Cloudflare tab gained a Live bindings panel
  below the existing token/account/plan fields. Each row:
  color-coded kind chip (DO / WORKFLOW / KV / D1 / R2 /
  QUEUE / AI / BROWSER / VECTORIZE / SANDBOX), the human
  label, the binding name in mono code, and a bound/optional
  status pill. Unbound (optional) bindings render dashed with
  reduced opacity. Mobile collapses the name+status into a
  second row.

### Library bulk-download
- ✓ Bulk-select action row gained a `Download N ↓` ghost
  button alongside `Delete N`. Click fires N sequential anchor
  clicks (350ms apart so browsers don't drop later downloads
  as popup-blocker false-positives) AND writes a
  `library-manifest-<isoStamp>.json` first listing every
  selected artifact's key, title, type, version, size, and
  ISO upload timestamp. Toast confirms with the count.

### Working-doc templates
- ✓ When the working-doc editor is empty, a chip row appears
  below the textarea offering four starter templates:
  Meeting (attendees/agenda/decisions), Research (question/
  sources/hypothesis), Project (goal/milestones/risks),
  Standup (yesterday/today/blockers). Picking a chip drops
  the template body into the doc + persists immediately via
  the existing setWorkingDoc + persistWorkingDoc path.
- ✓ Templates only render in editing mode (the textarea is
  visible) so they don't clutter the read view. Bodies stay
  short — the 8KB cap on the working doc means these are
  starting points, not canonical structure.

### Onboarding upgrades skip clarity
- ✓ A new dashed "free path" notice renders above the upgrade
  cards on the onboarding/upgrades step. Surfaces the user's
  default workers.dev hostname inline and a ghost-pill `Skip —
  just deploy free tier →` button that fires the same
  `proceed()` path as the bottom CTA. Lets users without
  upgrade intent bail in one click without scrolling past the
  Workers Paid + custom-domain cards.

### Audit log infinite-scroll re-arming
- ✓ Refactored the IntersectionObserver to stay armed across
  page loads. The old implementation tore down + rebuilt the
  observer on every `loadingMore` flip, which meant a sentinel
  still in the viewport after the new page rendered wouldn't
  trigger another load until the user scrolled again. Now the
  observer is one long-lived instance per (baseUrl, oldest)
  pair, and we gate against duplicate firing via a
  `loadingMoreRef` (ref-not-state) so the deps don't include
  loadingMore. Result: scrolling to the bottom auto-loads
  pages back-to-back instead of one-per-scroll.

### Skills uninstall pack
- ✓ New `POST /api/skills/pack/<source>/uninstall` route that
  disables every catalog skill with that source + drops local
  D1 rows + best-effort-deletes their R2 blobs. Returns the
  removed count. Idempotent — re-calling on an already-empty
  pack is a no-op.
- ✓ Pack cards on Skills gained a footer row with the pack id
  on the left and an `✕ uninstall (N)` button on the right
  (only shown when N > 0). Confirm dialog before fire; success
  removes the rows from local state immediately + fires a
  `Uninstalled <pack> · N removed` toast.

### Artifact preview text find
- ✓ `CodePreview` got a `⌕ Find` button in the new top-right
  action row (next to the existing `⧉ Copy` chip). Click
  toggles a small floating find bar with input + match
  counter. Enter / ↓ next, Shift+Enter / ↑ previous, Esc
  closes.
- ✓ Search results render as inline `<mark>` highlights — when
  the user is searching, the rendered body switches from
  syntax-highlighted HTML to plain-text-with-mark-spans so
  the highlight stays correct (the rest of the time, syntax
  highlight stays on). Active match gets the accent-orange
  fill + glow ring; inactive matches stay accent-soft.

### Spending tab CSV export
- ✓ Per-tool spend section gained an `Export CSV ↓` ghost
  button next to the "Per-tool today" heading (only renders
  when there's spend to export). Builds an RFC4180 CSV with
  one row per tool + a TOTAL footer row + cap + ISO reset
  timestamp. Filename:
  `spend-<agent>-<isoStamp>.csv`. Blob download via synthetic
  anchor + toast confirmation. Mirrors the Invocations /
  Audit CSV export shape so a downstream tool sees the same
  quoting rules across all three.

### Sync recent-PRs live-refresh
- ✓ Recent-PRs section gained a "checked Xs ago" indicator
  next to the section label, updating every 15s via a
  refresh-only `setTick` re-render (no extra fetch). Click
  the inline `↻` button to force a status re-pull immediately
  — same path as the panel header refresh but right next to
  the PR list where it matters.
- ✓ Per-PR state pill picked up its own color treatment:
  open = green-soft, merged = purple-soft, closed = grey,
  draft = dashed. Replaces the generic `ot-pill` look so the
  user can scan PR states at a glance instead of reading
  each one.

### Knowledge refresh-all URLs
- ✓ New `POST /api/knowledge/<agent>/refresh-urls` route fans
  out the live URL fetches in cohorts of 6 (each with 6s
  `AbortSignal.timeout` like the per-item refresh). Writes
  back to KV after every cohort so partial failures don't
  drop the wins. Returns `{refreshed, failed, skipped}`.
- ✓ Knowledge bulk-action row gained an `↻ Refresh URLs` ghost
  button (only when at least one URL item exists), plus a
  URL count in the counter line. Click → POST → re-pull list
  → toast: `Refreshed N URLs` (ok) or `Refreshed N · M failed`
  (info) when any fetch failed.

### Sidebar thread filter persistence
- ✓ The chip-bar filter (`all` / `today` / `week` / `pinned` /
  `archived`) in `AppSidebar.tsx` now seeds from
  `localStorage.openthink:threadFilter` on mount and writes back on
  every change (removes the key when reset to default). Survives reload
  and tab dupe so the user doesn't have to re-pick `pinned` every
  session if that's how they work.

### Library hash-deep-linking
- ✓ Library's `filter` (type chip) and `q` (search query) state now
  round-trips through the URL hash. On mount they seed from
  `#/library?filter=code&q=foo`; on change a `history.replaceState`
  rewrites the hash. Collapses to `#/library` when both are defaults.
  Lets the user bookmark a specific Library view (e.g. "code artifacts
  containing 'orchestrator'") and share the link with their other
  device or paste it into a PR for context.

### Command palette workspace switching
- ✓ `CommandPalette` lazy-fetches `/api/workspaces` every time the
  palette opens and injects rows under the `Sections` tab labelled
  `Switch to <Workspace>` with a subtitle showing `active workspace`,
  `pinned`, or just the `agentName`. Rows are sorted active-first,
  pinned-next, alphabetical-last so the most-likely-needed targets
  surface at the top.
- ✓ A new `kind: 'workspace'` discriminator on the `Item` type plus a
  `payload: { workspaceId }` carrier lets `navigate()` short-circuit
  the default hash-navigation when the row is a workspace: it POSTs
  `/api/workspaces/<id>/activate`, lands the user on `#/shell`, and
  reloads so the App's bootstrap effect re-reads the active workspace
  (same flow as the sidebar picker, just driven from ⌘K). Now the user
  can `⌘K → "ops" → Enter` and end up in the Ops workspace without
  ever opening the identity menu.

### Settings sticky pane header
- ✓ `.settings-pane header` (the h3 + lede of every Settings tab) is now
  `position: sticky; top: 0` with a `-48px / -56px` negative-margin trick
  so it bleeds to the scroll container edges and the body content scrolls
  cleanly underneath. A 1px bottom rule + opaque `--ot-bg` keep the
  separation crisp. On mobile the sidebar nav is already sticky, so the
  pane header reverts to `static` there to avoid a double-stack.
- ✓ Side effect: the Audit log group headers (below) can now anchor to
  `top: 64px` and tuck right under the pane header for a clean two-band
  sticky stack.

### Knowledge drag-handle affordance
- ✓ Each `.knowledge__item` now renders a `<span className="knowledge__drag-handle"
  aria-hidden>⠿</span>` (Unicode braille-pattern dots, the canonical grip
  glyph). Hidden at rest (`opacity: 0`), fades to 0.55 on row hover and
  1.0 on handle hover. Cursor flips from grab→grabbing while a drag is in
  flight. The whole `<li>` is still `draggable` so the grip is purely a
  visual affordance — it isn't focusable, isn't keyboard-actionable.
  Users no longer have to discover-by-accident that knowledge items
  reorder; the dots tell them.

### Audit log day grouping
- ✓ The audit log now groups rows by day-bucket (`Today` / `Yesterday` /
  short locale date like `May 15`, with the year tacked on for older
  rows). A small sticky header sits above each group with the bucket
  label + count (`12 entries`). Headers are sticky at `top: 64px` so they
  pin under the Settings pane header during long scrolls — when scanning
  for "what happened on May 12" the day stays anchored to the top of the
  list.
- ✓ Grouping happens in-render via a single pass that walks the
  newest-first entries and emits a header `<li>` whenever the bucket
  changes; the per-group count is precomputed once and stamped into the
  header. No new fetch, no shape change to `/api/audit`.

### Library multi-select keyboard shortcuts
- ✓ While in `selectMode`, ⌘A / Ctrl+A selects every non-stub artifact
  currently visible (post-filter, post-search). Skipped when focus is in
  the search input so the native browser select-all keeps working there.
  Esc clears the selection and exits the select mode in one tap.
- ✓ Shift+click ranges: clicking a tile records it as the anchor (kept
  in a `useRef`), then any subsequent Shift+click selects every tile
  between the anchor and target inclusively — Finder / Photos / GitHub
  style. Falls back to a plain toggle when no anchor exists or the
  anchor scrolled out of the filter.
- ✓ The bulk action bar's hint string ("Click tiles · Shift+click for
  range · ⌘A for all") and the corrected `Select all` button (which now
  calls the same `selectAllVisible()` helper) make the shortcut
  discoverable. The pre-existing broken `disabled={selected.size === 0}`
  on Select-all is gone.

### Composer slash-command preview chip
- ✓ A small pill-shaped chip surfaces above the composer textarea
  whenever the user has typed a recognized slash command (`/goal`,
  `/help`) AND the autocomplete dropdown is no longer active. Shows the
  command name in mono accent text + a short hint ("Kick off a long-
  running goal — runs in the background"). Disappears the moment the
  message stops being a command, so the chat composer's visual weight
  stays low for regular messages.
- ✓ Animated in with the same `shell-suggest-in` keyframe as the
  autocomplete so the two surfaces feel like one system. The chip
  ellipsis-clips on narrow viewports and wraps to two lines below
  720px so the hint stays readable on phones.

### Spending vs-yesterday delta
- ✓ `/api/stripe/spend/<agent>` now returns a `spentCentsYesterday`
  field alongside `spentCentsToday`. The route widens its D1 query
  window to 48h, splits hits into today/yesterday buckets by
  `created_at`, and returns both totals (per-tool tally stays
  today-only). Stub path returns a deterministic prior-day value (152
  vs 171) so the chip renders in local dev.
- ✓ Spending tab computes a `spendDelta` — `{kind: 'up'|'down'|'flat',
  label, title}` — from the two totals and renders a small chip next
  to the "$X / $Y" line. Up (warm red) when today exceeds yesterday,
  down (calm green) when today is lower, flat-neutral when equal. Edge
  cases (`yesterday=0, today>0` → `+$X today`; both zero → no chip)
  handled explicitly. The chip's `title` exposes the raw both-day
  totals on hover so the user can audit the percentage at a glance.

### Skills empty-state CTAs
- ✓ When `/api/skills` returns zero installed skills, the Skills page
  empty-state now ships three actionable buttons under the "no skills
  installed yet" headline:
  1. **↑ Browse packs** — smooth-scrolls to the Packs catalog above and
     flashes it with a soft accent halo for 1.2s so the eye lands on
     the right section.
  2. **✎ Author one inline** — dispatches the new
     `openthink:open-skill-author` custom event; the `SkillAuthor`
     component listens, flips its internal `open` state, scrolls into
     view, and focuses the JSX textarea so the user can start typing
     immediately.
  3. **→ Save from chat** — sets `#/shell` so the user can run a real
     turn and pop the existing Save-as-skill sheet from the canvas.
- ✓ Custom-event wiring keeps the SkillAuthor component
  encapsulated — no prop-drilling or shared state required to open it
  from elsewhere on the page.

### Invocations row density toggle
- ✓ Two-button segmented pill control next to the Export CSV button
  switches between `comfortable` (default — 9px row padding, 13px text)
  and `compact` (4px row padding, 12px text, smaller `model` column).
  Selection persists across reloads via
  `localStorage.openthink:invocations-density`.
- ✓ Active button reads as `aria-pressed="true"` with the accent
  background so screen readers and sighted users both see the state.
  On phones (≤720px) the toggle wraps to its own row below the stat
  cards so it doesn't compete with Export for grid space.

### Onboarding warm-reload resume
- ✓ When the user lands on `#/onboarding/identity` but
  `/api/workspaces` already reports at least one workspace (i.e. they
  completed onboarding in a prior session), a "Already deployed"
  banner surfaces above the form with two buttons: **Resume to chat**
  (merges the active workspace's `agentName` into flow + jumps to
  `#/shell`) and **Start fresh** (dismisses the banner so they can
  spin up a second agent if they actually wanted to).
- ✓ No auto-redirect — some users do reload onto the identity step
  intentionally to provision a second workspace, so we keep the
  decision in their hands. The banner shows the existing workspace's
  display name + the `agentName` it deploys to so the user knows
  exactly what they'd be resuming.

### Learning page memories empty-state
- ✓ When `/api/learning/memories` returns zero rows, the Memories
  section now renders a real `ot-empty` block with the headline "No
  memories yet" + a two-CTA row: **→ Start chatting** (jumps to
  `#/shell`) and **↑ Check pending** (smooth-scrolls to the Pending
  Suggestions section above, where the retraining workflow surfaces
  durable patterns from low-scoring turns). The body copy explains
  that memories accrete from real conversations rather than being
  hand-entered, so the user knows what behavior to expect.
- ✓ Reuses the existing `ot-empty` molecule + adds a
  `learning__memories-empty-cta` flex row that mirrors the Skills page
  empty-state for consistency across surfaces.

### Workspaces card hover-preview
- ✓ Hovering (or focusing) a Workspaces card now reveals a
  side-anchored popover with the 3 most-recent threads in that
  workspace + their relative timestamps. Lazy-fetches from
  `/api/threads/<agentName>?limit=3` once per card per session and
  caches by ws.id so subsequent hovers are instant. A 180ms debounce
  on the pointer-enter timer means a quick sweep across multiple cards
  doesn't fire a fetch for every one.
- ✓ Popover anchors to the right of the card on desktop (≥900px) and
  drops below on narrow screens — keeps it from clipping outside the
  viewport when the Workspaces page is on a phone. `pointer-events:
  none` so the popover doesn't interfere with clicks on Switch/Pin
  buttons. Loading and empty states surface inline ("loading…" /
  "No threads yet — switch to this workspace and start one.").
- ✓ Hovered card gets `border-color: var(--ot-accent)` + a small box
  shadow so it reads as "in focus" while the preview is up, even
  before the data loads.

### Canvas resize handle grip
- ✓ The chat ↔ canvas resizer column (8px wide between feed and
  canvas) now shows a faint vertical hairline at rest via a
  `::before` pseudo so the column reads as a draggable seam rather
  than empty space. Hairline brightens to accent on hover/drag.
- ✓ The grip itself is now a three-dot cluster (center dot + two
  box-shadow clones at ±10px) instead of a single 2px bar. Visible
  (muted ink-mute color, 0.6 opacity) at rest so users actually see
  it without hunting; brightens to full-opacity accent on hover/drag.
  Same DOM (one span) so the change is pure CSS — no React changes.
- ✓ Mobile (<800px) hides the resizer entirely (single-pane view), so
  the grip styling is desktop-only by default.

### Sync panel conflict-marker detection
- ✓ `parseDiff()` now tallies a `conflicts` field per file by counting
  lines that start with `<<<<<<<`, `>>>>>>>`, `=======`, or
  `||||||| ` (the diff3 base-blob marker). Markers are recognized
  both as bare context lines and as upstream-side `+` additions
  (which is how the `agent-update.yml` 3-way merge surfaces them when
  a hunk can't auto-reconcile).
- ✓ Top-level dry-run banner gains a warm-yellow chip "⚠ N conflict
  marker(s)" when the diff has any. Each affected file's
  `<summary>` row gets its own per-file ⚠ N badge alongside the +/-
  stats so the user sees which files need attention without expanding
  them.
- ✓ Conflict-marker lines in the unified diff render with a yellow
  left-border + bold weight + warm-yellow background tint, layered on
  top of their existing add/del/ctx coloring so they pop in a wall of
  green/red.
- ✓ Apply button now triggers a `window.confirm` when total
  conflicts > 0 so a user can't redeploy a half-merged source tree
  without acknowledging the risk. Cancel returns them to the diff.

### Behavior tab "Try this prompt" preview
- ✓ New `POST /api/settings/preview` endpoint runs a single off-thread
  Workers AI roundtrip against `@cf/meta/llama-3.1-8b-instruct` with
  the user-provided system prompt + sample message. Same 3.5s
  Promise.race timeout as the orchestrator so the verify suite's
  WS-frame budget stays untouched. Doesn't write to D1 trajectories,
  doesn't bump the spend counter — pure preview. Zod-validates the
  body, handles the `Invalid access token` / `ai_timeout` cases with
  user-readable fallback replies.
- ✓ Behavior tab gains a collapsed `<details>` accordion under the
  system-prompt textarea labeled "✦ Try this prompt · one-shot
  roundtrip · doesn't save to threads". Opening it reveals a sample
  message input + Run button; Enter submits, the reply renders in a
  bordered card below with proper whitespace preservation. Disabled
  state when the system prompt is empty or a run is in flight.
- ✓ Lets users iterate on prompt tone without sending a message into
  a real thread and burning daily spend on the trial.

### Memories merge-duplicates detector
- ✓ Learning page now runs a client-side duplicate detector across the
  loaded memory list. Uses tokenized Jaccard similarity (lowercased,
  punctuation-stripped, stopword-filtered) with a 0.7 threshold and
  union-find clustering. Only clusters within the same category — a
  user_facts memory and a preferences memory with similar text
  shouldn't be auto-merged.
- ✓ When ≥1 clusters surface, a warm-yellow banner above the memory
  filters shows "**N** likely duplicates found · review & merge".
  Clicking toggles a panel listing each cluster: the newest memory
  is tagged "keep" (green tint), older entries are tagged "drop"
  (muted), and a per-cluster "Keep newest" button runs parallel
  DELETEs against `/api/learning/memories/<id>` for the drops.
  Optimistic UI update + snapshot rollback on failure.
- ✓ Pure-client detection — no new backend route. Hooks into the
  existing PUT/DELETE memory endpoints. Detector cost is O(N²) on
  the memory list, fine for the 50-row cap the server already
  imposes.

### Access tab email management
- ✓ New `POST /api/access/<agent>/emails` and `DELETE
  /api/access/<agent>/emails/:email` endpoints update the KV-stored
  Access allow-list. Both return `pendingSync: true` when the
  workspace was already provisioned against live CF Access, surfacing
  the fact that the change won't reach Cloudflare until the next
  `provisionAccess()` call (typically the next deploy).
- ✓ Settings → Access UI: the previously-dead "add email…" input is
  now wired with an Enter-to-submit handler + an Add button + an
  RFC-light client-side regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`. Errors
  surface as inline red copy under the field (`That doesn't look
  like an email`, `Already on the list`, `Network error`). The input
  gains a `ot-input--err` modifier (accent border + tinted bg) while
  the error is showing; clears as soon as the user types.
- ✓ Each non-owner row gains a `×` remove button that fires a
  confirmation prompt then DELETEs. Owner email cannot be removed
  (hard-blocked in the UI with a "Can't remove the owner email"
  error). When the change is pending sync, a warm-yellow notice
  surfaces explaining the next deploy will roll the policy.

### Spending per-tool sparkline
- ✓ `/api/stripe/spend/<agent>` now also returns `perTool[].hourly` —
  a 24-element array bucketing each tool's cost across the last 24
  hours (slot 0 = oldest, slot 23 = newest). Backed by the existing
  audit_log scan; computed at the same time as the cents tally so
  the route stays single-query. Stub path emits deterministic
  sine-shaped curves so each tool has a distinct sparkline in local
  dev.
- ✓ A new inline `<Sparkline>` SVG component renders an 80×18 area
  chart per legend row — polyline normalized to its own series max
  (so small-cost tools still see useful curve detail), filled with
  the row's palette color at 18% alpha, stroked at 100%. Cell
  collapses gracefully via a `:not(:has(.spend-legend__spark))`
  rule when the server doesn't ship `hourly`. On phones (≤720px)
  the sparkline drops to its own row under the tool name.
- ✓ `aria-label="Hourly spend trend — N cents over 24h"` so screen
  readers see the aggregate at a glance.

### Skills drag-reorder for priority
- ✓ New `PUT /api/skills/order` accepts `{ ids: string[] }` and
  persists a `skills:order` KV blob (capped at 200 entries). The
  existing `GET /api/skills` reads the same blob and stable-sorts
  the merged catalog+local list so ranked skills bubble to the top
  in user-specified order while unranked items keep their original
  catalog order.
- ✓ Each `.skill-row` is now `draggable` with a faint braille-grip
  affordance (`⠿`) that fades in on row hover — same pattern as the
  Knowledge list reorder. Dragging onto another row highlights it
  with an accent-tinted bg + dashed top border ("drop here"); drop
  splices the moved skill into the target position and POSTs the
  new id-array to the server. Toast confirms "Skill order saved" on
  every drop.
- ✓ Gives users a way to manually pin their most-used skills to the
  top of the orchestrator's discovery list without having to disable
  the rest of the catalog.

### Onboarding token-paste auto-validate
- ✓ `OnboardingToken` now listens for `onPaste` on the API-token
  field. When the pasted text matches `^[A-Za-z0-9_-]{20,}$` (loose
  superset of the CF 40-char base64 token shape), we trim it,
  set state to the cleaned value, and fire `/api/cf-token/validate`
  immediately — no need for the user to also click "Verify token".
- ✓ A small accent-colored chip "✦ Pasted — validating…" surfaces in
  the actions row for ~1.8s while the round-trip is in flight, then
  fades. The chip suppresses itself once the verify succeeds (the
  existing "✓ Token works" already covers that state) or errors
  (the existing red error message takes precedence).
- ✓ Heuristic threshold (≥20 chars, alphanum/underscore/dash) is
  loose enough to handle future CF token format tweaks without
  hardcoding 40 chars.

### Composer auto-grow textarea
- ✓ The chat composer textarea now grows with content. A `useRef` +
  `useEffect` on the `pending` value resets the height to `auto`,
  reads `scrollHeight`, then clamps to a 240px cap. Past the cap
  the textarea scrolls internally (`overflow-y: auto`) rather than
  pushing the chat feed off-screen.
- ✓ CSS `resize:none` replaces the prior `resize:vertical` — the
  auto-grow effect now owns vertical sizing, and a manual resize
  handle would compete with it. An 80ms height transition smooths
  the growth visually. Mobile + desktop both inherit the new
  behavior (the composer styles aren't viewport-gated).

### Audit log JSON tree-view
- ✓ Replaced the audit row's flat `<pre>{JSON.stringify(...)}</pre>`
  with a new recursive `<JsonTree>` component. Objects + arrays
  render as collapsible buttons with a `▾`/`▸` chevron, a key
  preview when closed (e.g. `tool, costCents, args… (4 keys)`), and
  expand to show each child indented by depth. Default-open at
  depths 0–1 so the top-level structure is visible; nested objects
  start collapsed so deep payloads stay scannable.
- ✓ Primitive values get type-based coloring: strings green, numbers
  blue, booleans amber, `null` muted-italic, keys accent-tinted —
  same family of hues we use across the app.
- ✓ Generic enough to drop into other surfaces (Skills export
  payloads, trajectory tool-call rendering) without changes; the
  `className` prop lets the caller layer in their own background or
  max-height.

### Library starred-first sticky sort
- ✓ Pulled the star + recency sort into a single `sortArtifacts()`
  helper that runs on both the initial fetch and every star toggle.
  Previously the initial fetch trusted the server's order; now even
  if a future server-side fix lands sub-optimally we maintain a
  consistent client view. Star-toggle path no longer duplicates the
  sort comparator inline.
- ✓ Star toggles + state mutations all funnel through the same
  helper so reorders survive any subsequent operation (delete, bulk
  download, etc.). One source of truth for "what's the canonical
  order of these tiles."
- ✓ Server-side `/api/artifacts/list` already sorts the same way, so
  reload → fresh fetch → exact same visual order. Sticky across
  sessions.

### Artifact preview save-as rename
- ✓ Replaced the static `<a download>` link with a JS-driven download
  button that prompts the user for a filename before initiating.
  Default value is `<sanitized title><extension>`, where the
  extension prefers the R2 key's existing one and falls back to a
  content-type → ext map (PNG/JPG/PDF/JSON/MD/HTML/CSV/JS/TS/PY/TXT).
- ✓ Sanitizer strips `\\/:*?"<>|` and collapses whitespace so the
  prefilled value can't crash the browser's Save dialog. Cancelling
  the prompt aborts cleanly; an empty filename falls back to the
  default suggestion.
- ✓ **Option/Alt-click skips the prompt** for power users who want
  the old fire-and-forget behavior — title says "Download
  (option-click to skip the rename prompt)" so the shortcut is
  discoverable on hover.
- ✓ New `inferExtensionFromContentType()` helper sits alongside the
  existing `detectLanguage()` in `ArtifactPreview.tsx` so the
  download surface and the syntax highlighter share the same
  content-type taxonomy.

### Skills last-used recency badge
- ✓ Each skill row that carries a `lastUsed` timestamp (local D1
  rows updated by the orchestrator when a skill runs) now shows a
  small monospace pill: `used 12m ago` / `used 3h ago` /
  `used 5d ago` / locale date for older items. Hover reveals the
  absolute timestamp via the `title` attribute.
- ✓ "Hot" recency (≤24h) gets an accent-tinted background + accent
  text so frequently-used skills visually pop in the list. Older
  rows fall back to a muted neutral pill. Catalog-only skills with
  no `lastUsed` get no badge, keeping the row visually quiet.
- ✓ Reuses the same minutes/hours/days bucketing pattern as the
  audit `relTime` helper but as `skillRecentLabel()` because the
  skill row drops the "just now" phrasing in favor of a single
  magnitude per pill (tight visual budget).

### Toast queue with pause + dedupe
- ✓ `ToastHost` rewritten as a real queue: each toast tracks its own
  `enqueuedAt` / `lifetime` / `elapsed` / `resumedAt`. Stack capped at
  5; oldest pops on overflow. `err` toasts live 4.6s, others 2.6s.
- ✓ **Duplicate-collapse**: identical message+kind fired within 600ms
  of an active toast bumps a `×N` counter on the existing pill
  instead of stacking a new one. Spam-callers (e.g. memory-merge
  cluster firing N delete confirmations) now read as a single
  pill with the count.
- ✓ **Pause on hover/focus**: mouse-enter (or keyboard-focus)
  cancels the in-flight dismiss timer and freezes the progress bar;
  mouse-leave resumes from the exact elapsed time so a glance at a
  long error doesn't get yanked away mid-read.
- ✓ A thin currentColor progress bar at the bottom of each pill
  mirrors remaining lifetime (1s rerender tick keeps it animating
  without burning RAF cycles). Staggered entry animation via per-
  index `animation-delay`.

### New-thread keyboard shortcut (⌘+Shift+N / Ctrl+Shift+N)
- ✓ Global `keydown` listener in `App.tsx` recognizes the standard
  "new" shortcut from anywhere in the app. When the user is on
  `#/shell`, dispatches `openthink:new-thread` so the existing
  in-place new-thread handler creates the row. From any other route,
  navigates to `#/shell?newThread=1` and Shell's bootstrap effect
  picks it up on mount.
- ✓ Closes the command palette + shortcuts help before creating so
  the user lands cleanly on the fresh thread. `preventDefault` so the
  browser's own Ctrl+Shift+N (new incognito window) doesn't fire.
- ✓ Added to the shortcuts cheat sheet under Global so it shows up
  when the user hits `?` — keeps the help honest.

### Settings unsaved-changes indicator
- ✓ Settings parent now tracks a `dirtyTabs: Set<SettingsTab>` and
  renders a pulsing accent dot in each tab's nav button when it has
  staged but unsaved edits. Tabs broadcast their state via
  `openthink:settings-dirty` events with `{tab, dirty: bool}` — so
  any future tab can opt in without re-plumbing parent state.
- ✓ **Behavior tab now uses a debounced save** (600ms after the last
  edit) instead of per-keystroke PUT. Replaces the toast spam that
  came from typing into the system prompt with a single "Behavior
  saved" confirmation after the user actually pauses. The dot
  visually fills the gap between edit and save.
- ✓ On unmount (tab switch, route change) the Behavior component
  flushes any pending save synchronously so a hidden debounce timer
  can't drop edits. `beforeunload` guard prompts the user before a
  hard refresh when any tab is dirty.

### Sync apply progress phases
- ✓ The Sync panel's Apply flow now surfaces a 4-step progress strip
  during the redeploy: "Sending diff → Apply queued → GitHub Actions
  kicked off → Live deploy in progress". Step 0–1 are gated on the
  real POST response; steps 2–3 fire on a short timer (600ms / 1300ms
  / 2200ms) so the user sees a felt sense of motion before the panel
  collapses and `agent-deploy.yml` takes over for real.
- ✓ Each phase row carries its own glyph: `○` pending, `◐` active
  (pulses at 0.9s ease-in-out), `✓` done (green). The phase label
  switches accent → green-700 as it completes.
- ✓ Apply failure flips the strip to a red alert banner that explains
  what happened ("local changes were not pushed — check the worker
  logs and try again"). Stays visible while the Apply button is still
  available for retry; doesn't auto-dismiss.

### Chat composer char + token counter
- ✓ A small pill between the code-mode toggle and the Send button now
  shows the running character count + a `~tokens` estimate (chars/4,
  the standard rough-tokenizer heuristic). Hidden when the composer
  is empty so the chrome stays quiet in the common case.
- ✓ Three visual tiers: `ok` (muted) below 4000 chars, `warn` (amber
  pill background) above 4000, `danger` (red pill) above 8000. Pure
  visual cue — the worker doesn't gate on this, but it nudges users
  away from accidentally pasting 10K-char dumps into a single turn.
- ✓ Mobile (≤720px) wraps the counter to its own row above the Send
  button via `order: -1` so it doesn't crowd the mode toggles on
  narrow screens.
- ✓ Tooltip on the pill exposes the precise count + token estimate
  (e.g. "4,217 characters · ~1,054 tokens").

### Library tile right-click context menu
- ✓ Right-click on any non-stub artifact tile pops a 220px context
  menu at the cursor with six actions: **Open**, **Rename…**,
  **Star/Unstar**, **Download**, **Copy R2 key**, **Delete**. Menu
  is clamped to the viewport so it never renders off-edge near the
  bottom-right of the grid.
- ✓ Each action wires to the existing route surface: Open uses the
  in-app `ArtifactPreview`; Rename PATCHes the title via
  `/api/artifacts/<key>` and re-sorts; Star POSTs `/star`; Download
  fires a programmatic `<a download>` with the artifact title as the
  filename; Copy R2 key writes the key to the clipboard with a toast
  confirmation; Delete fires a confirm + DELETE + optimistic row
  removal.
- ✓ Click-outside + Esc both dismiss. The menu sits at `z-index: 80`
  so it floats above the tiles but under the artifact-preview modal
  (z:100). Danger action (`Delete`) gets a red label so the
  destructive choice reads at a glance.

### Knowledge upload retry chip
- ✓ Failed Knowledge uploads now snapshot the file + the title-at-
  attempt into a `failedUpload` state. The previous one-line error
  message is replaced with a structured alert block: red glyph,
  bold "Upload failed" headline, the original filename + reason on a
  micro-line, a **↻ Retry** ghost button, and a `×` dismiss control.
- ✓ Retry hands the same `File` instance + saved title back to
  `uploadFile()` so the user doesn't have to re-pick from disk. The
  title is the value typed _at first-attempt time_, not whatever's
  in the input now — protects against the user editing the title
  while the error sat on screen.
- ✓ A successful retry clears `failedUpload` + `uploadError` together
  so the dismiss button isn't sticky. Hitting Dismiss (×) clears
  both without retrying.

### Behavior template hover-preview
- ✓ Each Behavior tab template chip now wraps in a positioned
  container so a 320px popover can anchor against it. On
  hover/focus (debounced 280ms) the popover reveals the template's
  system-prompt body — clamped to 6 lines via `-webkit-line-clamp`
  so wordy templates don't blow up the layout. Click anywhere on the
  chip applies the template and hides the preview.
- ✓ The popover wears a thin shadow + accent border + slide-down
  entry animation matching the rest of the app's tooltip family.
  `pointer-events: none` so it doesn't capture clicks meant for the
  chip below. Mobile (≤90vw clamp) prevents the popover from
  bleeding off-screen on phones.
- ✓ Lets users compare voices without applying-then-reverting through
  the textarea undo stack.

### Sidebar thread search bar
- ✓ The inline filter input is now visible from 3 threads (down from
  6) and gains a ⌕ search-glyph in the left margin so it reads as a
  proper search bar instead of a generic filter input. Stays
  rendered whenever the user has something typed so they can clear
  it even after a thread archive drops the count below the
  threshold.
- ✓ When the filter is active, a `N/M` count chip sits inside the
  input on the right ("3/12" — 3 of 12 threads match). Title-hover
  expands it to "3 of 12 threads match." Esc inside the focused
  input clears the filter.
- ✓ Matched substrings inside thread titles get an accent-tinted
  `<mark>` highlight so the eye lands on the matched run immediately
  — same `renderHighlightedTitle()` helper pattern as the in-thread
  search but scoped to the sidebar.

### Spending cap edit now persists
- ✓ The Spending tab's daily-cap slider used to be a dead control — local
  state moved but never reached the worker. It now persists on every
  edit (debounced 400ms) via `PUT /api/settings/<agent>` with a
  `{ spendCapCents }` patch. The shallow-merge in the settings route
  means this stacks cleanly with the Behavior/Automation blobs.
- ✓ `Daily cap` Field text shows `$X.XX · saving…` while the debounce
  is in flight + a single "Daily cap set to $X.XX" toast on commit
  (no per-step spam). Initial load seeds the slider from
  `data.capCents / 100` and tracks `savedCap` separately so an
  in-flight slider drag never gets clobbered by a polling
  re-fetch.
- ✓ Worker-side wiring is end-to-end:
  - `/api/stripe/spend/<agent>` reads `spendCapCents` from settings
    (default 500¢) and returns it as `capCents` so the bar fills
    against the user's actual cap.
  - `orchestrator.ts` `checkSpend()` reads the same field on every
    tool-call check and overrides `this.memory.spendCapCents`,
    rolling the cap live without restarting the DO. Deny-list read
    consolidated into the same settings fetch — one KV roundtrip
    instead of two.

### Workspaces agent-name auto-suggest
- ✓ The Workspaces create form now surfaces a slugified agent-name
  preview as the user types into the workspace-name field. Pure
  client-side slug (lowercase, alphanum-hyphenated) until the user
  touches the agent-name field — then we stop auto-deriving so a
  typo upstream doesn't blow away their custom value.
- ✓ A **↻ Suggest** button fetches a 2-word hyphenated name from the
  existing `/api/onboarding/suggest-name` route. Reset (×) goes back
  to auto-derived. Submit now POSTs the explicit `agentName` so the
  user lands on the workspace they previewed, not a server-rederived
  string they didn't see.
- ✓ Row only appears once the workspace name has any content (or
  after the user manually edited the agent name), so the form stays
  visually quiet for someone who just types a one-off workspace and
  hits Enter.

### Sync recent-PR reviewer status
- ✓ `/api/sync/status` now extracts `draft` + `requested_reviewers.length`
  from the existing GitHub `/repos/<owner>/<repo>/pulls` list response
  and surfaces them as `draft` + `requestedReviewers` fields on each
  recent PR. No extra round-trips — the data was already in the list
  payload, we just weren't reading it.
- ✓ Each recent PR row in the UI gains a reviewer-state chip with three
  kinds: **✎ draft** (muted neutral), **◐ N reviews requested** (warm
  amber when waiting on humans), **✓ ready for review** (calm green
  when open with no pending reviewers). Hover surfaces the precise
  meaning via `title` attribute.
- ✓ Closed/merged PRs skip the chip entirely so the row stays clean
  past the open-PR phase of the lifecycle.

### Audit log clear-filters chip bar
- ✓ The Audit tab gains a status row above the entry list that appears
  whenever any non-default filter is active (kind != all, fromDate,
  toDate, or search query). Each active filter renders as its own
  clickable chip — clicking the chip clears just that dimension; the
  trailing "× Clear all" button resets everything in one shot.
- ✓ Replaces the previous Clear button that only reset dates+search
  and silently ignored the kind filter, leaving users stranded when
  they'd narrowed by kind. Label "Filters active · N matches"
  surfaces the resulting entry count so the user knows whether their
  narrowing is doing useful work.
- ✓ Wears an accent-tinted background + accent text so the bar reads
  as an explicit "this is filtered" indicator distinct from the
  static filter inputs below it.

### Knowledge URL paste auto-detect
- ✓ Pasting a URL into the title input OR the text-snippet textarea
  now auto-routes it into the URL kind: the URL field receives the
  pasted value (normalized to `https://` if a bare domain was
  pasted), focus jumps to the URL input, and an inline notice
  "✦ URL detected from paste — switched to URL kind" appears for
  ~2.4s. Removes the misclick of stashing a URL inside a text-snippet
  body just because that's where the cursor was.
- ✓ Detection accepts three shapes: `http(s)://…`, `www.…`, and a
  bare `domain.tld/path` form (so a `openthink.run/docs` paste lands
  too). Heuristic skips text with internal whitespace so prose with
  embedded URLs doesn't get hijacked.
- ✓ A new generic `.ot-input--detected` modifier flashes the input
  border with an accent glow on the keyframe so the user sees their
  paste landed in the right field.

### Library bulk-star toggle
- ✓ The Library bulk action bar gains a **Star/Unstar** button next
  to Download. Reads `Star N` when the selected set is mixed or
  fully unstarred; reads `Unstar N` only when every selected
  artifact is already starred — keeps the toggle predictable.
- ✓ Fires N POSTs to `/api/artifacts/<key>/star` in parallel via
  `Promise.allSettled`. Optimistic local flip + `sortArtifacts()`
  re-sort runs immediately so starred items float to the top while
  the network resolves. Toast surfaces partial-failure count when
  some POSTs reject.
- ✓ Skips stub rows (the deterministic seed data when R2 is empty)
  so a bulk-star on a sample-data view doesn't fire dead requests.
  Button is disabled during the in-flight bulk operation + during
  any concurrent download/delete.

### Deploy SSE reconnect on failure
- ✓ DeployProgress's EventSource `onerror` used to silently `es.close()`,
  leaving the user stranded with a half-rendered timeline. Now it sets a
  `streamError` state that drives:
  - **An exponential-backoff auto-reconnect loop** (1s → 2s → 4s → 8s
    cap) that bumps `streamKey` so the effect re-mounts the
    EventSource without the user having to refresh.
  - **A warm-yellow "Live stream interrupted" banner** above the
    timeline showing the reconnect-attempt count + a manual
    "Reconnect now" button. The spinning ↻ glyph signals work in
    flight without screaming failure.
  - **Clean recovery** — any successful snapshot/done frame clears
    the streamError state. The deploy keeps running worker-side
    regardless; the banner is purely about the live stream.
- ✓ Builds on the existing `/api/deploy/<id>/retry` route that resets
  errored steps to pending — together the two cover both kinds of
  failure (a stuck step the worker reported, and a flaky network
  drop on the stream itself).

### Workspaces sort-by-activity
- ✓ A three-way segmented toggle ("Sort by · pinned · last activity ·
  created") sits above the workspace list when there's more than one.
  Selection persists in `localStorage.openthink:workspaces-sort` and
  defaults to the original `pinned` (pinned-first, then alphabetical).
- ✓ The `activity` mode pulls each workspace's most-recent thread
  `updatedAt` via `/api/threads/<agent>?limit=1` and floats the most-
  recently-active workspace to the top. Falls back to `createdAt`
  for any workspace whose fetch hasn't resolved yet so the list never
  blanks during the eager load.
- ✓ Each workspace card now surfaces a "last active 12m ago" stamp
  in the meta line when activity data is available (title-hover
  shows the absolute timestamp).

### Behavior templates JSON import/export
- ✓ Below the Behavior tab's prompt-template chip row, a quiet
  mono-text bar offers **↓ Export N as JSON** and **↑ Import JSON**.
  Export downloads `behavior-templates-<agent>.json` with the merged
  built-in + custom set. Import accepts the same shape (array of
  `{id, label, body}`).
- ✓ Imported templates layer on top of the static catalog and
  persist to `localStorage.openthink:behavior-templates`. Id
  collisions with the built-in catalog are skipped on import (the
  user can't shadow `coder`/`writer`/etc.); collisions within the
  custom set are merged-by-id with later-wins. Toast surfaces the
  exact import count + any skip count.
- ✓ A trailing **× Clear custom** button appears once the user has
  any imported templates so they can roll back to the catalog
  baseline in one confirm-prompt-gated click. The bar is invisible
  noise-wise when only the built-ins are present.

### Audit row share via Web Share API
- ✓ The audit row's `🔗 copy link` button is now `🔗 share` —
  prefers the platform share sheet via `navigator.share()` when
  available (mobile + macOS Safari) so the user gets a one-tap
  path to Mail / Messages / Slack with the deep-link
  pre-populated. Falls back to clipboard copy + toast on
  desktops where `share` is undefined.
- ✓ Share payload uses the audit kind as title, `auditSummary(e)`
  as text, and the deep-link as URL — shape the OS share sheet
  understands and most apps render cleanly.
- ✓ `AbortError` from the share sheet (user dismissed) is treated
  as a no-op rather than falling through to a redundant clipboard
  copy, so dismissing doesn't unexpectedly stash a link the user
  rejected.

### Composer voice dictation (Web Speech API)
- ✓ A new mic button between the char counter and Send button
  fires real voice-to-text dictation via the Web Speech API
  (`SpeechRecognition` / `webkitSpeechRecognition`). Interim
  results stream into the composer textarea on top of whatever
  the user had already typed — a `voiceBaseRef` snapshot at
  start-of-listening prevents the recognizer from clobbering
  earlier content.
- ✓ Three visual states:
  - **Idle** — ghost ring with mic glyph; tooltip explains what
    the button does.
  - **Listening** — solid accent fill with a pulsing ring + filled
    circle glyph; clicking again stops the recognizer.
  - **Unsupported** — muted opacity, disabled, tooltip "Voice
    input not supported in this browser" (Firefox primarily).
- ✓ Recognizer language defaults to `navigator.language`; cleans
  up on unmount via `recogRef.current?.stop()`. No external
  service — the Speech API uses the browser/OS engine so audio
  doesn't leave the user's device.

### Skills inline test-match
- ✓ New `POST /api/skills/<id>/match` endpoint runs the same
  tokenized-Jaccard heuristic the orchestrator uses for
  discover-by-default matching: lowercases + strips punctuation
  + drops stopwords, computes intersection-over-union against
  the skill's `description + when_to_use + name`, returns
  `{score, wouldActivate, matched, threshold}`. Threshold 0.15.
- ✓ Each skill row gains a `✦ Test match` pill-shaped
  `<details>` accordion under the description. Opening reveals
  a sample-message input + Run button. Result renders inline:
  **✓ Would activate** (green tint) or **○ Skipped**, the raw
  score vs threshold, plus the matched keyword list so authors
  can see exactly which words triggered (or didn't).
- ✓ Pure-local test pass — no AI call, no D1 write, no audit
  row. Lets skill authors tune `when_to_use` strings without
  burning real chat turns to validate matching.

### Knowledge file-type icons
- ✓ The previous all-caps `URL` / `FILE` / `TEXT` text pill on each
  Knowledge row is replaced with a kind-tinted square icon glyph:
  `⟶` for URL (cool blue), `¶` for text (warm amber), and an
  ext-derived glyph for file kind (accent-red): `🖼` for images,
  `📕` for PDF, `📑` for markdown, `📊` for tabular (csv/xlsx),
  `⟨/⟩` for code (ts/js/py/go/rs/sql/sh/etc.), `🗜` for archives,
  `◰` for html/json/xml, `📄` for anything else.
- ✓ A new `knowledgeIconFor()` helper centralizes the mapping so a
  future preview/list/etc. surface can share it. Falls back to the
  generic page glyph for unknown extensions so the row never renders
  with a missing icon.
- ✓ Visual win: the row's left edge now communicates the kind +
  sub-type at a glance — no need to read the source URL or filename
  to know "this is an image" or "this is code".

### Library did-you-mean
- ✓ When a Library search returns zero results AND there are real
  artifacts in the loaded list, the empty-state surfaces up to 3
  Levenshtein-near titles as clickable chips ("Did you mean…").
  Clicking a chip replaces the search query with that title.
- ✓ Distance accepts edits ≤ max(4, ⌊queryLen/3⌋) — keeps the list
  tight to real near-misses on short queries while staying forgiving
  on long ones. Uses the standard Wagner–Fischer table with a
  "skip-from-any-column" seed in row 0 so the search lands on
  substrings (not just exact prefixes).
- ✓ Pure-client. Stub rows are skipped so the dev-time sample data
  doesn't pollute the suggestions list. Chip text ellipsis-clips at
  240px so very long titles stay readable.

### Audit log hourly density strip
- ✓ Above the audit-row list, a 24-bucket density strip now shows
  how many entries fell in each of the past 24 hours. Bar height is
  proportional to count vs the peak hour; empty hours render as a
  faint baseline so the strip stays rectangular and readable.
- ✓ Each bar has a `title` exposing the absolute hour + entry count
  ("3pm · 12 entries") so the user can hover-scan a 24h activity
  pattern without expanding rows. Renders only when the entry list
  has at least one row and the user isn't in the loading state.
- ✓ Cheap — single linear pass over `entries` to fill 24 slots, no
  extra fetch, no D1 query. Surfaces alongside the existing density
  insight in the per-tool spend sparkline so users get a consistent
  family of "activity over time" visuals across the Settings tab.

### Sync diff word-level highlighting
- ✓ The SplitDiff renderer now runs a per-pair word diff: when a `-`
  line is paired with a `+` line, an LCS-based token diff identifies
  exactly which words moved. Unchanged words render plain; changed
  words wrap in a `<mark>` with a deeper accent-tinted bg + bold
  weight so only the real edits pop against the line-level
  green/red coloring.
- ✓ New `diffWords()` helper tokenizes both sides via
  `/\w+|[^\w]/g` (keeps whitespace + punctuation in the output so
  the rendered line is character-identical to the source), runs the
  standard Wagner–Fischer LCS table, backtracks to label each token
  match/changed, then collapses adjacent same-label tokens into
  single segments so the rendered DOM stays small.
- ✓ Unpaired add/del rows (one side null) bypass the word diff and
  render the whole line tinted — matches the GitHub UX where a
  pure-insertion or pure-deletion doesn't need within-line
  highlights.

### Sidebar pinned workspaces row
- ✓ The AppSidebar now eager-fetches `/api/workspaces` on mount
  (previously gated on the picker opening) so it can render a
  "Pinned workspaces" quick-access row between the top nav and the
  thread list. Each pinned-but-not-active workspace becomes a
  clickable chip — clicking activates it via the same
  `activateWorkspace()` path the identity picker uses.
- ✓ Hidden entirely when there are no pinned non-active workspaces
  to switch to, so users who haven't pinned anything see no extra
  chrome. Chips wear an accent-glyph + name and the same hover
  treatment as other sidebar pills.
- ✓ Mobile + desktop share the row (no viewport gating); chip
  wrapping handles narrow widths naturally via the existing
  flex-wrap layout.

### Skill author draft persistence
- ✓ The Skill Author's JSX textarea now writes to
  `localStorage.openthink:skill-author-draft` 400ms after each
  keystroke (debounced) so a reload mid-edit doesn't blow away
  in-progress work. The hydration runs on mount: if the stored
  draft differs from `STARTER_JSX`, the editor opens with the
  saved content + a warm-yellow "Draft restored from your last
  session" chip above the textarea.
- ✓ The chip carries an inline "discard" link → confirm-gated
  reset back to STARTER_JSX. First keystroke after a restore
  silently dismisses the chip so it doesn't camp on screen while
  the user keeps typing.
- ✓ Successful save (`/api/skills` POST returns ok) clears the
  draft slot in localStorage automatically — the next reload
  starts fresh because the skill is now persisted server-side.

### Working-doc autosave indicator
- ✓ The "Agent's notes" working-doc panel in the chat shell now
  surfaces autosave status inline in the header: `◐ saving…` while
  a POST is in flight, `✓ saved 12s ago` once it lands, `⊘ save
  failed` on a 5xx or network drop. Hover-titles expose the
  absolute timestamp + the failure mode.
- ✓ Status pill ticks every 15s while a save is recent so the
  "12s ago" stays honest without re-rendering the whole shell.
  Recovers automatically on the next successful save (no manual
  retry needed — the same `persistWorkingDoc` fires on blur).
- ✓ New `workingDocSavedLabel()` helper formats the relative-time
  with mono-friendly short labels ("just now" / "12s ago" /
  "3m ago" / "2h ago") that fit inside the cramped header strip.

### Settings agent-config backup
- ✓ The General tab gets a new "Agent config backup" section with
  **↓ Export config** + **↑ Import config** buttons. Export GETs
  `/api/settings/<agent>` and downloads the whole shallow-merged
  KV blob as `<agent>-config-<stamp>.json` — captures every key
  the orchestrator + Settings UI cares about (Behavior model
  picks, Automation approval mode + deny list, Spending cap,
  response style, code mode, prompt template id, etc.).
- ✓ Import is a confirm-gated PUT that hits the same route. The
  worker route already shallow-merges with the existing blob so
  imports stack cleanly — same-named keys overwrite, untouched
  keys survive. Useful for cloning a tuned agent's configuration
  to a new workspace.
- ✓ JSON-parse errors + non-object payloads surface as toasts
  rather than dropping a corrupt blob into KV.

### Library bulk export-to-zip
- ✓ Replaced the previous "N sequential `<a download>` clicks +
  manifest.json" flow with a single .zip bundle. The bulk-action
  Download button now reads **Zip N ↓** and the in-flight state
  is **Bundling…**.
- ✓ Fetches selected artifacts as raw bytes in parallel cohorts
  of 6 (matches the existing Workspaces / Knowledge concurrency
  budget). Per-file failures are tolerated — they're skipped and
  surfaced in the result toast ("Exported 5 · 2 failed"). The
  zip embeds the same `manifest.json` as before so recipients
  still get the original metadata.
- ✓ New `buildZipBlob()` + `crc32()` helpers ship a pure-JS
  store-only PKZip writer (~80 LOC). Store-only because PNGs /
  PDFs / etc. don't compress further, and a runtime DEFLATE lib
  would be wasted weight. Dedup logic appends `(2)` / `(3)` to
  duplicate filenames inside the zip so two artifacts with the
  same title don't collide.

### Recent workflow runs panel
- ✓ New `GET /api/goal` endpoint walks the SETTINGS KV for `goal:*`
  and `retrain:*` prefixes, parses each blob, and returns a unified
  list of `{id, kind, status, createdAt, summary}` runs sorted by
  recency. Capped at 50 (default 25) per kind so a chatty agent
  doesn't blow up the response.
- ✓ Learning page gains a "Recent workflow runs" section between the
  memories list and the Categories cards. Hidden when there are no
  runs to surface (most accounts pre-first-goal). Each row shows a
  kind pill (goal=accent, retrain=blue) + the goal summary or run id
  + the absolute timestamp + a status pill colored by state
  (queued/running/done/failed/cancelled).
- ✓ Reuses the existing KV `list` API so no new index needed — the
  same prefix scan would page-load fine even at 100+ runs since
  Workflows already TTL-expire after 7 days.

### Memories when-to-use tag chips
- ✓ Below the existing category-filter chip row, the Memories
  section now surfaces a tag chip row derived from the top 10
  most-frequent tokens across every memory's `whenToUse` string.
  Stopwords + ≤2-char tokens are filtered out so chips read as
  meaningful keywords ("python", "deploy", "morning", "client").
  Each chip shows its frequency count alongside the tag.
- ✓ Click a chip → toggles it into an AND-filter against the
  visible memory list (every active tag must appear in the
  whenToUse string). Multiple chips can be active at once; an
  inline "× clear" button drops them all.
- ✓ Hidden when no memories carry a `whenToUse` string, so the
  filter row only appears when it would do useful work. The chip
  row + the existing category row layer cleanly (category narrows
  first, tags narrow further).

### Workers AI live ping
- ✓ New `POST /api/cf-bindings/ping-ai` endpoint runs a one-shot
  `@cf/meta/llama-3.1-8b-instruct` call with the same 3.5s
  Promise.race timeout the orchestrator uses. Returns `{ok,
  latencyMs, model, sample}` on success; `{ok: false, latencyMs,
  error, detail}` on `timeout` / `auth_expired` / `unreachable`.
- ✓ Settings → Cloudflare tab gets a "Workers AI · live ping"
  section between the token/plan fields and the live-bindings
  list. Single **↻ Ping** button fires the call + shows the
  result inline: green ✓ pill with `<latencyMs> ms` and the model's
  sample reply on success, red ⊘ pill with the failure kind on
  error.
- ✓ Button is disabled when the AI binding isn't present in `env`
  (workers without the AI binding configured), with a tooltip
  explaining why. Gives users a quick "is my agent's brain
  reachable + how fast" check without going to the Cloudflare
  dashboard.

### Browser-session canvas filmstrip
- ✓ `BrowserSessionArtifact` now keeps a rolling history of the last
  8 PNG frames in state. Below the main viewport it renders a
  horizontally-scrollable filmstrip of 64×40 thumbnails — each one
  hover-titled with the absolute timestamp the frame landed. Clicking
  a thumbnail pins the viewport to that frame; the latest gets a
  filled accent border.
- ✓ When the user is viewing a past frame (not the live one), a
  small "↻ live" pill appears top-right of the viewport — one click
  jumps back to streaming-current. Avoids the user accidentally
  losing track of where they are in the timeline.
- ✓ Cheap dedupe heuristic: if two consecutive frames share the
  first 64 chars of base64, drop the second so a static page doesn't
  fill the strip with duplicates. Cap stays at 8 most-recent so the
  scroll never gets unwieldy.

### Onboarding fork validation
- ✓ The Path A / Path B picker now runs `validateAgentName()` against
  the agent name carried in from Identity step. CF subdomain rules
  enforced: lowercase letters first, only [a-z0-9-], no leading/
  trailing hyphen, ≤63 chars. Failure surfaces a red banner above
  the path buttons with the specific rule violation + a "← back to
  identity" jump link, and BOTH path buttons disable until fixed.
- ✓ When the name passes, a green "all good" preview banner shows
  what the agent's URL will be on each path:
  `agent.workers.dev` (Path A) or `agent.<yours.com>` (Path B). The
  user sees what they're about to commit to before clicking.
- ✓ Path A gains a "✦ token from your last session is cached" pill
  when the prior session's verified CF token is still in
  localStorage — soft nudge that Path A is the obvious quick pick
  for returning users.

### Audit log multi-kind filter
- ✓ Kind chips are now multi-select. Clicking `tool_call` then
  `approval` filters the list to rows matching EITHER kind (`kind
  IN (...)`); clicking `all` clears the entire kind set. Active
  chips get the existing accent-tinted styling, plus the active-
  filters status bar at the top renders one chip per active kind
  so the user can drop a single dimension without resetting the
  others.
- ✓ Worker route already received the change: `kindFilter` now
  parses a comma-separated list, builds a SQL `IN (?, ?, ...)`
  clause when ≥2 kinds, falls back to plain `kind = ?` for 1.
  Single-kind requests stay byte-for-byte compatible with prior
  clients.
- ✓ State migration: `filter: string` → `filterKinds: Set<string>`
  inside the Audit component. Empty Set semantic = "all kinds" so
  the cleared state on first render Just Works.

### Command palette fuzzy ranking
- ✓ Replaced the substring `.includes()` filter with a real fuzzy
  scorer. Each item gets graded against the query via title
  substring (100 base + bonuses for prefix / word-boundary hits +
  short-title bonus), subtitle substring (40), and a
  longest-subsequence pass (60 base, penalized by gap-runs, plus a
  bonus per word-boundary hit). Items with score 0 drop out;
  positive scores sort descending.
- ✓ Practical win: typing `stng` now ranks **Settings** above
  **Spending** (both contain `s`, `t`, `n`, but the s-t-tings hit
  in Settings has fewer runs + earlier prefix). Typing `wkr`
  reaches **Workspaces** in one fewer character than before.
- ✓ Pure-client. The scorer is ~50 LOC and runs once per
  query/items change inside the existing `filtered` useMemo —
  no extra fetch, no debounce; the palette stays sub-frame
  responsive on every keystroke.

### Onboarding back preserves draft
- ✓ `OnboardingIdentity` + `OnboardingToken` now eager-bubble every
  edit up to the parent's `flow` state via `merge({...})`. The
  parent App holds `flow` in memory, so a hash-navigate back to
  Fork (or forward to Token then back to Identity, etc.) no
  longer drops typed-but-unsubmitted values — token, subdomain,
  access-emails-raw all survive the round-trip.
- ✓ Each merge useEffect is gated on the relevant local state so
  an unmount-during-typing race can't accidentally write an empty
  draft over a previously-saved field. `eslint-disable-next-line`
  on `merge` deps because the parent's closure changes every
  render and we deliberately don't want that to retrigger.
- ✓ Together with the existing flow-state retention (kept in
  App-level useState since iteration 2), the wizard now reads as
  a single coherent multi-step form rather than three separate
  pages that re-prompt every time you navigate away.

### Knowledge open-in-new-tab
- ✓ Each Knowledge row now exposes an **↗ Open** action in the
  bulk-actions cluster alongside Pin/Refresh/Remove:
  - URL items → external `<a target="_blank" rel="noreferrer
    noopener">` pointing at the user's stored URL. Lets them
    sanity-check what the agent is reading without going through
    the Knowledge preview modal.
  - File / text items → `<a>` to `/api/artifacts/<key>` so the
    raw R2 object opens in a new tab. Browser dictates whether
    that renders inline (text/image/PDF) or downloads (binary).
- ✓ `onClick={(e) => e.stopPropagation()}` on each anchor so the
  click doesn't also fire the row's preview-modal trigger. The
  whole click target is still ≥36px tall for thumb-tap
  accessibility on mobile.

### Verify ws-flake hardening
- ✓ Root-caused the intermittent `ws: orchestrator chat · socket
  error` failure: a freshly-restarted `wrangler dev` accepts the
  TCP connect before the Orchestrator DO is fully spun up, and the
  WebSocket upgrade gets dropped with an immediate `error` event.
  Verify suite saw it as a hard FAIL; in practice the next attempt
  always landed clean.
- ✓ Split the `ws()` helper into `wsAttempt()` + a retry wrapper.
  The wrapper now races a single attempt against the 4500ms
  deadline, and on a `socket error` outcome waits 350ms and tries
  once more. Real failures still surface on attempt 2; transient
  cold-start hiccups no longer count as suite failures. Diagnostic
  improved too — `socket error` now includes the underlying
  Node-ws `error.message` when present so future regressions are
  actionable, and successful retries surface "(after 1 retry)" in
  the result line so it's obvious when the flake fired.
- ✓ Validated by running the full verify suite 3 times in a row
  back-to-back against `wrangler dev`: all three came back 24/24
  PASS, with no retry needed during the runs in this session.

### Danger zone type-to-confirm
- ✓ The previous no-op Reset / Delete buttons in the Danger Zone
  now open a real confirmation modal demanding the user type a
  matching phrase before the destructive action becomes
  available:
  - **Reset memories** → type `reset memories`
  - **Delete agent** → type the agent's own name (e.g.
    `cloudy-fjord`) — same convention GitHub uses for repo
    deletion + AWS for ARN confirmations.
- ✓ Commit button stays disabled until the typed phrase exactly
  matches; Enter submits when ready, Esc cancels at any point.
  Modal lives at z-index 200, sits above artifact-preview (z:100)
  + cmdk (z:110) so it always wins focus. Scrim is dismissable
  via click-outside (but disabled during the in-flight action so
  a stray click can't strand a half-completed operation).
- ✓ The actual destructive endpoints are still placeholder no-ops
  (just toast on confirm) since real reset/delete routes haven't
  shipped yet — but the safety gate is now in front of them,
  ready for wiring without UI changes.

### Composer attachment thumbnails
- ✓ The composer attachment chip row now switches rendering based
  on the file's `type`: image kinds keep the data-URL `<img>`
  thumb, everything else gets a 36×36 glyph slot with an
  emoji-style icon (📕 PDF, 🎵 audio, 🎬 video, ◰ json, ¶ text,
  📄 fallback). Visual consistency means a mixed attachment set
  no longer has a half-empty grid.
- ✓ Each thumb is now wrapped in an `<a target="_blank">` pointing
  at the data: URL — clicking opens the attachment in a new tab
  so the user can verify the actual content before hitting Send.
  Lift-on-hover transform + soft shadow signals it's interactive.
  `e.stopPropagation()` prevents the click from bubbling into a
  parent handler.

### Danger Zone real endpoints
- ✓ The Reset memories + Delete agent buttons in Settings →
  Danger zone now hit live worker routes (placeholders are gone):
  - **`POST /api/learning/memories/reset`** — soft-resets every
    memory to importance=0 (matches the per-row delete pattern so
    the vector index stays intact for future restore). Returns the
    count of rows touched; UI surfaces "Reset 47 memories" in the
    success toast.
  - **`DELETE /api/settings/<agent>`** — full agent tear-down.
    Wipes every D1 agent_id-scoped row (memories, skills,
    audit_log, trajectories, pending_suggestions), KV blobs under
    `settings:` / `access:` / `knowledge:` / `provision:` /
    `sync:`, workflow runs whose `agentName` matches (paged
    `list({prefix})`), and every R2 object under
    `artifacts/<id>/` (paged via the R2 cursor). Returns a
    per-stage tally so the UI can confirm what got dropped.
- ✓ Does NOT touch Cloudflare-level resources (the Worker itself,
  the DO classes, the user's account). Those stay the user's
  responsibility via wrangler — keeps the blast radius scoped to
  one agent's data and avoids accidentally nuking a user's whole
  setup.
- ✓ UI redirects to `#/` after a successful delete so the user
  doesn't sit on a stale Settings tab pointing at a non-existent
  agent. The post-success toast includes the per-stage counts
  ("Agent deleted · 47 memories · 2 skills · 8 artifacts").

### Settings full-agent snapshot zip
- ✓ Extracted the store-only PKZip writer + CRC32 helper from
  Library.tsx into a shared `web/utils/zip.ts` module. Library
  now imports `buildZipBlob` from the same place Settings does;
  ~150 LOC of inline code is gone.
- ✓ New "Full agent snapshot" section in Settings → General fans
  out 9 read endpoints in parallel (config, threads, memories,
  skills, knowledge, audit, invocations, artifacts, workflows) and
  bundles each successful response as a top-level `*.json` file in
  the zip. Per-endpoint failures are tolerated — they appear as
  `false` in the manifest's `sections` map so a recipient knows
  what's missing.
- ✓ Each section's body is a pretty-printed JSON dump (2-space
  indent) so a human curator can grep / diff / restore-by-hand
  without unzipping a binary blob. The downloaded filename is
  `<agent>-snapshot-<iso-stamp>.zip`. Useful for migrations,
  legal/compliance "give me everything you have on me" requests,
  and dev-mode backups before wiping.

### Audit log row pin-to-top
- ✓ Each audit row gets a 📍 pin glyph between the relative-time
  pill and the chevron. Click toggles the row into a `pinnedIds`
  Set persisted in `localStorage.openthink:audit-pinned` so it
  survives reload. Pinned rows render under a new "📌 Pinned"
  pseudo-bucket at the top of the list, even if the row's
  underlying day-bucket would put it weeks back.
- ✓ Pinned rows wear a warm-gold left-border + dimmed pin glyph
  flips to filled-pushpin while pinned. The pseudo-bucket header
  has its own subtle yellow-tinted bg so it reads as a distinct
  visual zone above the Today/Yesterday day buckets.
- ✓ Pin button stops event propagation so clicking it doesn't also
  expand the row. Keyboard-accessible (`role="button" tabIndex=0`,
  Enter/Space activate). Same persistence pattern as the existing
  thread-filter and library-density toggles so the user gets
  consistent state-survives-reload behavior across the app.

### Snapshot import
- ✓ Paired with last tick's snapshot export, the General tab now
  exposes an **↑ Import snapshot (zip)** button next to its export
  twin. New `readZipBlob()` in `web/utils/zip.ts` parses a store-only
  PKZip (the same format `buildZipBlob` produces) — walks the EOCD
  back from the file tail, reads each central-directory entry, and
  pulls the raw bytes from the local file header offset. Compressed
  entries are explicitly unsupported (returns empty array → user
  sees a "not a snapshot zip" error) since we never write them.
- ✓ Currently auto-restorable: `config.json` (PUT
  `/api/settings/<agent>` shallow-merge, behind a confirm prompt
  showing the key count). Other sections (threads, memories, skills,
  knowledge, audit, invocations, artifacts, workflows) are detected
  + counted in the toast but stay un-replayed — they need
  dedicated bulk-write endpoints that don't exist yet. Honest UX:
  the toast says "Snapshot has 8 sections — only config auto-restores
  in v1" so users know what's actually happening.

### Settings tab keyboard navigation
- ✓ `]` / `k` advance to the next Settings tab; `[` / `j` go back.
  Wraps at the ends. Skips input/textarea/contentEditable targets
  so the user can still type brackets into the Behavior prompt or
  the Audit search box without triggering tab walks. Modified-key
  presses (⌘/Ctrl/Alt) bypass the handler so palette + browser
  shortcuts still own those.
- ✓ Added to the cheat sheet under a new "Settings" group so the
  shortcut is discoverable via `?`. The tab walks reuse the existing
  `selectTab()` so they keep the URL hash in sync — back-button
  navigation continues to work after using the keys.

### Audit row annotations
- ✓ Each expanded audit row now exposes a note slot. When empty: a
  small "✎ Add note" affordance above the JSON payload tree.
  Clicking opens an inline textarea + Save/Cancel buttons (⌘↵ saves,
  Esc cancels). Once saved, the note renders as a warm-yellow
  sticky-note panel with edit + clear inline actions.
- ✓ Notes persist in `localStorage.openthink:audit-notes` as a
  flat `{[entryId]: text}` map — no backend roundtrip, no race.
  When a row has a note, a small ✎ glyph in the collapsed-row head
  signals it; the glyph's `title` attr surfaces the full note text
  on hover so the user doesn't need to expand to read short notes.
- ✓ Editing state is tracked separately from the persisted value
  (`editingNote: {id, draft}`) so the textarea doesn't write to
  localStorage on every keystroke. Save commits; cancel discards;
  clear deletes the entry from the map outright.

### Memory bulk-restore + snapshot wire
- ✓ New `POST /api/learning/memories/bulk` accepts either
  `{memories: [...]}` (the snapshot shape) or a bare array of items.
  Pre-fetches the existing `(category, content)` set in a single
  query then inserts only new pairs — re-importing the same snapshot
  is idempotent. Returns `{added, skipped, invalid}` counts.
- ✓ Vector index is intentionally skipped during bulk-restore.
  Re-embedding 100+ rows would burn the spend cap on import; the
  Memory Agent's discover-by-default loop re-embeds on first read
  anyway.
- ✓ The snapshot import flow in Settings → General now picks up
  `memories.json` alongside `config.json`. Both are confirm-gated
  ("Restore 47 memories? Duplicates are skipped."). The result
  toast surfaces what was restored, what was skipped (dupes), and
  what other sections sit unreplayed (threads / skills / etc. still
  manual-only).

### Sidebar archived restore
- ✓ The Archived section in the sidebar now shows an "archived
  Xm ago" relative timestamp under each row title so the user knows
  how recent each archive is at a glance.
- ✓ When there are 2+ archived threads, a "↺ Restore all (N)"
  affordance appears at the top of the section — confirm-gated, then
  fires `onRestoreThread(id)` for each. Optimistic local clear of
  the archived list so the user sees the threads pop back into the
  main feed immediately; the parent handler's own optimism un-
  archives them in the active list.
- ✓ The per-row ↺ button stays the primary action; bulk restore is
  the shortcut. Quiet dashed-border ghost styling so the bulk
  affordance doesn't compete visually with the actual row content.

### Knowledge URL bulk-paste
- ✓ The URL form now accepts space / comma / newline / semicolon
  -separated URLs in a single paste. New `parseUrlBatch()` splits,
  normalizes bare domains to `https://`, dedupes, and returns the
  parsed list. Single-URL behavior is preserved (the same code path
  emits a 1-element array).
- ✓ When ≥2 URLs are detected, the submit button label flips from
  "Add URL" to "Add N URLs" and a small chip below the input
  surfaces "✦ N URLs detected — title field will be ignored for
  batch adds". Submit fans out POSTs in cohorts of 4 (matches the
  existing /url POST's live-fetch-per-item cost) and toasts the
  per-batch added/failed counts.
- ✓ For single-URL submissions the title field still threads through
  to the server; for batches the title is omitted (each item gets
  its server-extracted title from the live page fetch).

### Knowledge bulk-import + snapshot wire
- ✓ New `POST /api/knowledge/<agent>/bulk` accepts the export shape
  (`{items: [...]}` or bare array) and inserts every item that
  doesn't collide on `(kind, source)` with an existing entry. URL
  items insert directly (no live fetch — keeps the import cheap +
  offline-capable); file/text items keep their R2 keys (the actual
  bytes would need to be re-uploaded separately, surfaced in the
  UI's confirm prompt). Returns `{added, skipped}`.
- ✓ Snapshot import now restores `knowledge.json` alongside
  `config.json` + `memories.json`. Confirm-gated; failures and
  dup-skips surface in the result toast. The "still manual-only"
  list shrinks to `[threads, skills, audit, invocations, artifacts,
  workflows]`.

### Library tile lazy-load images
- ✓ New `LibraryTileThumb` component replaces the inline thumb div.
  For `type === 'image'` artifacts it renders an `<img>` with
  `loading="lazy"` + `decoding="async"` pointing at the artifact's
  R2 blob — a 200-tile grid no longer fires 200 image requests on
  initial paint. Browser-native intersection observation handles the
  "load when near viewport" gating.
- ✓ Non-image types and stub rows fall back to the existing emoji
  glyph. `onError` toggles a local `failed` flag → the failed image
  also falls back to the glyph so a broken R2 link doesn't leave an
  empty box.
- ✓ Soft fade-in animation (`opacity 0 → 1` over 200ms via
  `library-tile-image-in` keyframe) smooths the moment the image
  decodes; otherwise the swap-in pops visually.

### Destructive-action audit rows
- ✓ Three new "danger" audit kinds wired in from the worker side:
  - `POST /api/learning/memories/reset` writes a `danger` row with
    `{action: 'memories_reset', reset: <count>}`.
  - `POST /api/learning/memories/bulk` writes
    `{action: 'memories_bulk_restore', added, skipped}` when the
    insert count > 0.
  - `POST /api/knowledge/<agent>/bulk` writes
    `{action: 'knowledge_bulk_restore', added, skipped, agentId}`.
  - `DELETE /api/settings/<agent>` writes a final
    `{action: 'agent_deleted', agentId, removed}` row AFTER the
    agent's own rows are wiped — under `__system__` so it survives.
- ✓ Audit `KindEnum` extended to include `'danger'`. UI side adds:
  - A new chip in the kind-filter row so users can isolate
    destructive actions.
  - A red-tinted `.audit__kind--danger` pill style matching the
    Danger Zone color family.
  - An `auditSummary()` branch that renders compact strings like
    `agent_deleted · agent=cottony-paradox · 47 reset · 2 skipped`.
- ✓ The user now has a single audit trail for every
  destructive-or-near-destructive event. The `__system__` agent_id
  is a deliberate sentinel — orchestrator-owned actions stay under
  the agent's real id; only the "I just nuked all this state" rows
  use the sentinel so they survive their own wipes.

### Cross-agent `__system__` audit surfacing
- ✓ `/api/audit/<agent>` now defaults to merging `__system__`-tagged
  rows into the visible list (`?includeSystem=0` opts out for users
  who want strict per-agent scope). The SQL `WHERE` flips from
  `agent_id = ?` to `(agent_id = ? OR agent_id = '__system__')`
  when enabled. Response shape gains an `agentId` field so the UI
  can tell which rows came from the sentinel.
- ✓ Audit UI marks `__system__` rows with a blue "system" mini-pill
  next to the kind pill in the row head + a subtle blue-tinted
  whole-row bg. Hover-titles explain ("Cross-agent system event
  (danger / bulk-restore / agent-delete)"). The danger trail the
  worker writes under `__system__` (last tick's audit rows) now
  reaches the user instead of disappearing into the void.

### Settings tab filter-count badges
- ✓ New `openthink:settings-filter-count` event lets each tab
  broadcast its active-filter count to the Settings parent. Parent
  keeps a `Record<tab, count>` and renders a small accent-tinted
  pill (e.g. "3") next to the tab label when count > 0. Mutually
  exclusive with the dirty-dot — a dirty tab shows the dot;
  filtered-but-clean shows the count badge.
- ✓ Audit tab wired up first: counts `filterKinds.size +
  fromDate? + toDate? + searchQ?`. Future tabs (Library, Knowledge,
  Spending) can opt in by firing the same event.
- ✓ Parent state survives across tab unmount/remount so a user who
  filters audit, navigates away, and comes back still sees their
  count badge.

### Inline snapshot restore summary
- ✓ The snapshot import flow now writes a persistent inline summary
  panel below the export/import buttons in addition to the toast.
  Three sections: **Restored** (green tag per restored section +
  detail like "47 added"), **Skipped** (yellow tag, e.g. "2
  duplicates"), and **Manual-only sections in this snapshot**
  (plaintext list of sections that don't have auto-restore
  endpoints yet).
- ✓ Includes a timestamp + dismiss button so the user can review
  the result after the toast fades and clear it when ready. The
  toast still fires for users who only want the quick read; the
  inline panel is the durable view for multi-section snapshots
  where the toast can't fit the full breakdown.

### Filter-badge click clears its tab's filters
- ✓ The per-tab filter-count badge that lights up next to a Settings
  tab name when it has active filters (kind chips, date range, search
  query, etc.) is now a clickable button: clicking it (or pressing
  Enter / Space while focused) fires a new
  `openthink:settings-clear-filters` custom event scoped to that
  specific tab. The originating tab listens for the event and resets
  its own filter state — kind chips, dates, and search query all
  reset in one click.
- ✓ Visually the badge picks up a hover state that flips it to the
  accent background to telegraph that it's interactive, plus a
  `role="button"` + `tabIndex={0}` for keyboard nav. Click bubbling
  is stopped so pressing the badge doesn't also navigate to the tab
  (it stays where it is in case the user is mid-edit elsewhere). For
  multi-filter tabs like Audit this turns a four-click reset (open
  tab → "Clear all" chip → confirm none missed → switch back) into
  a single click anywhere in the app.

### Audit log cross-agent scope toggle
- ✓ The Audit tab now renders a small switch labeled "Include
  system" / "This agent only" in the filter cluster (alongside From,
  To, and Search). ON (default) ORs in rows tagged with the
  `__system__` sentinel agent_id so destructive-trail events like
  per-agent wipes and bulk restores surface alongside the current
  agent's activity. OFF restricts the SELECT to `agent_id = ?` so
  power users investigating a specific agent see only that agent's
  rows.
- ✓ State is persisted to `localStorage`
  (`openthink:audit-includeSystem` = `'1'` / `'0'`) so the toggle
  survives reloads and tab switches. The worker query string only
  carries `includeSystem=0` when the user has opted out, keeping the
  URL (and KV cache key surface) short for the common case. Switch
  styling uses a custom pill + sliding-knob in the same accent
  palette as the rest of the Settings chrome — no extra dependency,
  pure CSS.

### Library tile grid keyboard navigation
- ✓ The Library tile grid is now fully keyboard-navigable.
  ArrowLeft / ArrowRight move focus between adjacent tiles;
  ArrowUp / ArrowDown move one row up / down respecting the live
  grid column count (computed from `offsetTop` so it works across
  viewport resizes + the CSS `auto-fill` track count). Home / End
  jump to the first / last tile. Enter and Space still activate the
  focused tile (same code path as click — opens the viewer for real
  artifacts, or routes stub rows to the chat).
- ✓ The newly-focused tile calls `scrollIntoView({ block: 'nearest',
  inline: 'nearest' })` so navigating past the viewport scrolls the
  next tile into view without jumping when the target is already
  visible. Skeleton tiles (loading state) aren't focusable, so
  arrow keys don't pull focus into placeholder rows. Combined with
  the existing ⌘A / Esc shortcuts in select mode, the entire screen
  is now usable without a mouse.

### Spending tab per-tool drilldown
- ✓ Each row in the Spending → Per-tool legend is now clickable
  (mouse + keyboard) and toggles an inline drilldown that fetches the
  last 20 `tool_call` audit rows for that specific tool. The fetch
  hits `/api/audit/<agent>?kind=tool_call&q=<tool>&limit=100` (the
  worker's payload LIKE narrows the result set) and then
  strict-equals `payload.tool === expandedTool` client-side to drop
  substring collisions (e.g. `research` matching `researcher.*`).
- ✓ The drilldown panel shows four headline stats (avg cost, min/max
  in cents, avg duration, error count) plus a five-column table —
  When, Cost, Duration, Status, Agent — with the offending rows
  tinted in the danger color when `payload.ok === false` or an
  `error` field is present. A close button and aria-expanded on the
  row make the affordance accessible. Responsive sweep included:
  on ≤600px the stats grid collapses to 2 columns and the table
  trims its padding so the whole drilldown stays usable.

### Workspaces keyboard navigation
- ✓ Each card in the Workspaces list is now a focusable
  `tabIndex={0}` + `role="button"` target with an aria-label that
  conveys active / pinned state. Tab lands on the first card; arrow
  keys walk up / down through the rendered DOM order (respecting the
  user's pinned / activity / created sort); Home / End jump to the
  ends; Enter or Space switches to the workspace; `p` toggles its
  pinned state without leaving the keyboard.
- ✓ The keyboard handler discriminates on `e.target === currentTarget`
  so Tab into a child action button (Switch / Pin / Delete) still
  works normally — arrows only navigate when the li itself owns
  focus. New `:focus-visible` ring uses an accent-tinted box-shadow
  in the same palette as the hover-preview border so the rest of the
  surface chrome feels unchanged.

### Knowledge category tags
- ✓ Knowledge items can now carry user-assigned category tags. New
  `PUT /api/knowledge/<agent>/<id>/tags` accepts `{ tags: string[] }`
  and full-replaces the item's tag list; both the worker and client
  run the same sanitizer (lowercase, alphanum + hyphens, max 24
  chars, max 12 per item) so a paste with spaces / punctuation
  round-trips to a stable canonical slug. Bulk-import schema now
  carries `tags` through too, so snapshot export → restore preserves
  the grouping.
- ✓ The Knowledge tab renders a filter strip above the list listing
  every unique tag with its item count (sorted by frequency); click
  a chip to AND it into the filter, click again to remove it. Each
  item row gets an inline tag-chip strip with an edit affordance
  (`✎` if tagged, `+ tag` if not) that swaps to a textarea on click —
  Enter saves, Esc cancels, blur commits. Clicking an item-row chip
  also adds that tag to the global filter so the user can drill into
  a group with one click. Optimistic update + snapshot revert on
  failure keeps the UI snappy without losing data on the rare worker
  failure.

### Skills tab keyboard navigation
- ✓ Each row in the Skills list is now a `tabIndex={0}` +
  `role="listitem"` target with an aria-label describing the skill's
  name and enabled state. Tab lands on the first row; arrow keys walk
  up / down through the rendered list (which respects the user's
  drag-reorder priority); Home / End jump; Enter / Space toggle the
  skill on/off; `t` opens the inline tester and parks focus on its
  input so the user can start typing a sample message immediately.
- ✓ The handler discriminates on `e.target === currentTarget` so Tab
  into the SkillToggle or tester input still uses native key
  behaviour; only key presses on the row itself trigger the row-level
  shortcuts. `.skill-row:focus-visible` lights up with an
  accent-tinted background + a 2px inset bar so the keyboard target
  stays visible against the existing hover chrome.

### Audit log JSONL export
- ✓ Adds an "Export JSONL ↓" button alongside the existing Export CSV
  in the audit bulk-action row. Writes one JSON object per line
  (`application/x-ndjson`) with the canonical field set —
  `id, kind, timestampMs, timestampIso, agentId, payload` —
  so downstream tools like `jq`, Splunk, or Athena can ingest without
  CSV-cell escaping shenanigans. Same `entries`-as-snapshot rule as
  the CSV export, so kind / date / search / scope filters all carry
  through to whatever the user just looked at.

### Learning memory tags (parity with Knowledge)
- ✓ Memories now carry an explicit user-curated tag layer alongside
  the existing inferred when-to-use tokens. New migration
  `0003_memories_tags.sql` adds a `tags TEXT` column (JSON-encoded
  string, NULL when the list is empty) so SELECTs can short-circuit.
  Bulk-import schema accepts `tags`; new
  `PUT /api/learning/memories/<id>/tags` does the full-replace with
  the same sanitizer the knowledge route uses (lowercase, alphanum +
  hyphens, max 24 chars per tag, max 12 per row). 404 on a missed id
  so the client can surface a cleaner error than "save failed".
- ✓ The Learning tab grows a second tag chip row labeled "custom
  tags" sitting below the existing "when-to-use tags" row. The two
  systems remain visually distinct: derived chips render with a
  transparent background, custom chips use an accent-tinted tint
  while inactive and saturate on click. Each memory row gets a
  per-item tag-strip with an `✎` / `+ tag` edit affordance — Enter to
  save, Esc to cancel, blur commits. Clicking an item-row chip adds
  it to the global filter so the user can drill down with a click.

### Onboarding back navigation + Esc shortcut
- ✓ `OnboardingFrame` now takes an optional `onBack` prop. When
  supplied, it renders a "← Back" link in the topbar AND wires a
  window-level Escape listener that triggers the same handler (with
  a textarea bypass so Esc still blurs multi-line inputs as users
  expect). App.tsx threads explicit back targets through every
  onboarding step that's not step 1: Fork → Identity, Token → Fork,
  Stripe → Fork, Upgrades already had a bottom-of-card Back which
  now also fires from Esc.
- ✓ Topbar variant gets its own selector (`.onboarding__topbar-inner
  .onboarding__back`) that drops the in-card top-margin, adds a
  hover background, and trims down on ≤600px so brand + back +
  progress meter all fit without wrapping. Focus-visible ring uses
  the accent color so the keyboard target stays visible against the
  topbar.

### Library bulk-download progress meter
- ✓ The Library bulk "Zip N ↓" action now drives a real progress bar
  in place of the static "Bundling…" string. `downloadSelected`
  advances `{done, total, failed}` state after each cohort of 6
  parallel fetches; the new `.library__bundle-progress` row sits
  below the bulk action bar and renders an accent-filled bar
  alongside a mono `Bundling X / Y · Z failed` label.
- ✓ Holds at 100% for ~600ms after the zip lands so the user sees a
  clean completion state before the meter auto-dismisses. On ≤600px
  the meter stacks vertically so the label gets its own line under
  the bar; otherwise it stays side-by-side for the desktop layout.

### Mobile sweep on Learning + Knowledge tag UIs
- ✓ At ≤600px the per-memory tag-strip uses larger tap targets
  (font-size 11/12px, padding 3px 10px) so chips clear the 30px
  touch-zone guideline without losing the dense desktop look. The
  memory grid collapses to a single column with the meta row
  spreading across the full width, and the tag-edit input bumps to
  16px font-size to suppress iOS Safari's auto-zoom on focus.
- ✓ Same iOS-zoom suppression + tap-target bump applied to the
  Knowledge per-item tag chips and the inline tags-edit input.
  Knowledge tag-edit container drops its 220px min-width on narrow
  viewports so the input expands to fill the available space
  instead of breaking the row.

### Deploy log copy + bundle download
- ✓ Each expanded deploy step now carries a "⧉ Copy" affordance
  pinned in the top-right corner of its log pane. Click writes the
  full step output (including the error: prefix when present) to the
  clipboard so a user filing a bug report can paste a single
  pre-formatted block without having to select multi-line preformatted
  text manually.
- ✓ Footer now grows a "↓ Bundle" button that concatenates every
  step's logs into a single timestamped `.log` file —
  `=== <label> (state, duration) ===` headers per step, plus a
  header block with `deployId`, `startedAt`, and `elapsedMs`. Hidden
  when nothing has output yet so the footer reads as just "elapsed"
  on a fresh deploy; surfaces the moment the first step writes.

### Audit row id copy affordance
- ✓ The truncated id chip at the end of each expanded audit row is
  now a clickable button — click copies the full UUID to the
  clipboard and pops a toast confirming the first 8 chars. The "⧉"
  glyph is hidden by default and fades in on hover/focus so the
  click affordance is obvious without adding visual noise to a
  resting row. (The existing share + open-in-chat + pin + note
  affordances stay where they were.)

### Composer keyboard shortcut hint + expanded cheat sheet
- ✓ The Shell composer now renders a dim one-line hint below the
  meta row showing the three highest-frequency bindings (`Enter`
  send, `Shift`+`Enter` newline, `/` palette) plus a `?` link that
  opens the full ShortcutsHelp panel via a new
  `openthink:open-shortcuts` custom event so the modal opens without
  prop-drilling. On ≤600px the inline bindings hide and only the
  "?" affordance stays so the composer row stays one-line.
- ✓ ShortcutsHelp catches up with three new sections — Library
  (tile grid arrows, Home/End, Enter/Space, ⌘A in Select mode,
  Esc), Workspaces (Tab + arrows + Enter + P), and Skills (Tab +
  arrows + Enter + T). The Settings group also mentions the
  filter-badge click-to-clear behaviour that landed two ticks ago.

### Sidebar thread keyboard navigation
- ✓ Each thread button in the sidebar now handles ArrowUp / ArrowDown
  to walk the rendered list (pinned + recent in DOM order, ignoring
  the section divider). Home / End jump to the ends; Enter is the
  button's native activate. The handler reads the live DOM via
  `.shell__threads .shell__thread` so the order always matches what
  the user sees post-filter / post-pin without prop-drilling.
- ✓ Focus ring on `.shell__thread:focus-visible` lights up with an
  accent-tinted background + outline so the focused row is obvious
  against the resting + active row tints. ShortcutsHelp picks up the
  new bindings in its Sidebar group (Tab / arrows / Home / End /
  Enter) plus a note that the inline filter surfaces at 3+ threads
  (not the previous "6+" — that was stale).

### Toast Esc dismiss
- ✓ Pressing Esc while any toast is visible now drops the entire
  toast stack in one keystroke. The handler probes the DOM for any
  `[role="dialog"]` element before firing — if a modal is mounted
  (ShortcutsHelp, command palette, artifact viewer, confirm modals)
  Esc still reaches it so the modal close path stays intact and the
  toast stack doesn't poach the keystroke.
- ✓ Skipped when the user is focused on an input/textarea/
  contentEditable so Esc still blurs the field as users expect. Does
  not call `preventDefault` so passive analytics handlers continue
  to see the event.

### Behavior templates focus ring + arrow-key navigation
- ✓ The pill-shaped `.settings__template` chips in the Behavior tab
  now get a strong `:focus-visible` treatment — accent border plus a
  2px accent-tinted box-shadow ring so the small chip's keyboard
  target reads against the resting + active states without relying
  on the dotted browser default.
- ✓ ArrowLeft / ArrowRight walk the chip row, Home / End jump to
  the ends; the handler reads the live DOM (`.settings__template`
  query inside the closest `.settings__template-row`) so it picks up
  both built-in and user-imported templates without state coupling.
  Enter is the button's native activate (still applies the template
  to the system prompt and persists).

### CommandPalette recent-item polish
- ✓ Found the recent-items feature was already shipped (localStorage
  cache, dedup, prepended Recent group). Added two polishes on top:
  recent rows now show a relative-time chip (`2m ago`, `1d ago`)
  pinned flush-right of the row so users can tell at a glance how
  fresh the entry is; and a `clear` button sits inline with the
  "Recent" group label that wipes the localStorage cache plus the
  in-memory snapshot in one click.
- ✓ `recordRecent` now writes a `lastUsedAt` timestamp on every
  navigation so the chip stays accurate without a clock-tick. The
  clear button uses an accent-tinted hover so it reads as
  interactive without crowding the all-caps group label.

### Canvas thumbnail strip keyboard navigation
- ✓ The Canvas thumbnail strip (visible in single mode when there
  are 2+ artifacts) is now fully keyboard-navigable. ArrowLeft /
  ArrowRight walk between thumbs; Home / End jump to the ends.
  Selecting via arrow also swaps the canvas main body so arrow keys
  feel identical to clicking the next thumb. `.thumb:focus-visible`
  uses an accent box-shadow and `.thumb--active:focus-visible` adds
  a thicker outer ring so the keyboard target stays distinct from
  the resting active state.
- ✓ ShortcutsHelp picks up a new Canvas group documenting the
  bindings (Tab → focus thumb, arrows → walk, Home/End → ends).

### SyncPanel diff viewer polish
- ✓ The dry-run DiffViewer dialog grows a header summary
  (`+N −M` total across every file), a new bulk-action cluster with
  "Expand all" / "Collapse all" buttons (multi-file diffs only), a
  "⧉ Copy" button that writes the raw unified diff to the clipboard
  for sharing in a bug report, and Esc-to-close routing so the
  keyboard close path matches every other modal. Esc is gated on
  `applying` so a user can't accidentally bail out mid-deploy.
- ✓ Expand/collapse syncs all `<details>` elements via a ref
  callback driven by an `{open, bump}` state object — bumping the
  counter forces re-render so toggling the same state twice still
  reapplies (user expands all, manually closes one, expands again).
  Stays a no-op when `open === null` so the initial mount defers to
  each file's defaultOpen behaviour.

### Skills tester query history
- ✓ Each skill row's inline match-tester now persists the user's
  test queries to `openthink:skill-tester-hist:<skillId>` in
  localStorage (capped at 8 per skill, deduped by string value). The
  body grows a quiet "recent" chip row below the input — click a
  chip to immediately re-run that query against the skill (saves a
  click vs. populate-then-Run), and a `clear` button wipes the
  history for that skill. ArrowUp on an empty input pops the
  most-recent query in, matching shell-history muscle memory.
- ✓ The history only records queries that produced a real verdict
  (data.ok === true) so transient failures don't fill the row with
  noise. Chips truncate to 30 chars + ellipsis when wider so the row
  stays single-line for typical questions.

### Memory free-text search
- ✓ The Learning tab now ships a free-text search field above the
  category chip row (visible at ≥5 memories so a small dataset
  doesn't show empty chrome). Lowercase substring match across
  content + when-to-use + custom tags; ANDs cleanly with the
  existing category, when-to-use-tag, and custom-tag filters so
  combinations work as expected.
- ✓ The query persists to `openthink:memory-search` localStorage so
  a reload doesn't drop an in-flight filter. Esc clears the query
  without leaving the field (event.stopPropagation prevents the
  global Esc handlers from hijacking the keystroke). Focus ring on
  the input container uses the accent color via `focus-within`.

### Workspaces drag-to-reorder
- ✓ New `PUT /api/workspaces/order` accepts `{ ids: string[] }` and
  rewrites the KV-backed list in that order. Same idempotent
  semantics as the knowledge route's reorder — any workspace id not
  in the supplied list gets appended at the end in its original
  order so a stale client snapshot doesn't drop rows.
- ✓ The Workspaces sort chip row grows a fourth `manual ⠿` mode.
  When selected, each row becomes `draggable` with proper drag
  start/over/leave/drop handlers — the source dims to 0.45 opacity,
  the drop target shows a dashed accent top border + 2px nudge so
  the insertion point is unambiguous. Drop optimistically rewrites
  `list` + fires the PUT in the background (best-effort, catches
  + drops failures silently per the existing pattern).

### Knowledge bulk select + bulk operations
- ✓ The Knowledge tab now ships a Finder-style bulk-select mode. A
  "Select" button in the bulk action bar flips every item into
  multi-select mode — each row swaps its drag handle for a square
  checkbox, click-to-select via the meta button, accent tint on the
  whole row when picked. Bulk actions: Pin / Unpin / Delete with the
  selection count baked into the button label (`Delete 7`).
- ✓ A bulk-tag input appears below the action bar when the user
  has picked ≥1 items — typing space- or comma-separated tags and
  hitting Enter (or the "Add tags" button) UNIONS the new tags into
  each selected item's existing list, preserving prior taxonomy.
  Esc exits select mode + clears the pile so a stale selection
  doesn't survive a tab switch.
- ✓ Drag-to-reorder is disabled while select mode is on so the two
  gestures don't compete. All bulk worker calls fan out in cohorts
  of 4 (matches the library-bulk-download cohort size) so a 30-item
  bulk delete doesn't slam the worker. Snapshot-revert on failure
  keeps optimistic UI safe.

### Spending JSON export sibling
- ✓ Spending tab now offers an "Export JSON ↓" button alongside the
  existing CSV. The JSON variant carries the same per-tool roll-up
  plus structured metadata — capDollars, sharePct, exportedAtIso,
  hourly[] arrays per tool — so dashboards and `jq`-style pipelines
  can ingest without CSV-cell escaping. Same `spend`-as-snapshot
  rule as the CSV path so the export reflects whatever the user
  sees right now.
- ✓ The two buttons sit in a `.spend-header__exports` flex cluster
  that wraps on ≤600px so they stack cleanly on phones; the wider
  layout keeps them inline next to the "Per-tool today" header.

### Sync PR list filter + sort
- ✓ The Sync panel's "Pull requests this agent has opened upstream"
  list now ships state-filter chips (All / Open / Merged / Closed,
  each with a count badge — chips for empty states disable to keep
  the row honest) and a sort dropdown (Newest first / Oldest first /
  Open first then by date). Both controls only render when there
  are 2+ PRs (one row has nothing to filter against).
- ✓ Both preferences persist to localStorage (`openthink:sync-pr-filter`,
  `openthink:sync-pr-sort`) so the user's preferred lens sticks
  across reloads. Sort modes do the right thing: "state" surfaces
  open PRs first (most actionable), then merged, then closed, with
  date as the secondary key within each bucket.

### Workspaces archive / restore
- ✓ Workspace rows now archive (soft-delete) by default instead of
  hard-deleting. New `POST /api/workspaces/<id>/archive` sets an
  `archivedAt` timestamp; `POST /api/workspaces/<id>/restore` clears
  it. `GET /api/workspaces` filters archived rows out by default and
  exposes them only via `?archived=1`, plus an `archivedCount` in
  every response so the UI can render a count badge without a second
  roundtrip. If the user archives their current active workspace,
  the active slot falls back to the next non-archived row.
- ✓ The Workspaces UI grows an "Archived" collapsible section at the
  bottom of the page with a badge showing the count. Expanded rows
  show "archived 3d ago" relative time + Restore / Delete buttons.
  Hard delete is still available from inside the archived section so
  the user can permanently drop a row they're sure they don't want
  back. The "Archive" action replaces "Delete" on the active list to
  surface the safer default first.

### Spending warning threshold toasts
- ✓ Spending tab now fires a toast the first time daily spend crosses
  80% (info-tinted) and 95% (err-tinted) of the cap. The 100% case
  is already covered by the existing `tool-blocked` banner.
- ✓ Fired-bucket state lives in localStorage keyed by `resetAt` so a
  page reload doesn't re-fire the same threshold, and entries older
  than 7 days get GC'd on every write so the cache stays small.
  New day = fresh ladder.

### Settings nav attention badges
- ✓ The Settings nav now supports a third badge dimension alongside
  dirty + filter-count: an `openthink:settings-attention` custom
  event with `{tab, reason}` adds a warning-tinted "!" pulse next to
  the tab name; passing `reason: null` clears it. Useful for
  surfacing problems the user should look at without forcing them
  into the tab to discover them.
- ✓ Two sources wired this tick: the Spending pane broadcasts when
  spend ≥ 80% of cap (cap reached at 100% shows a different message);
  the Sync panel broadcasts when the agent has fallen behind upstream
  with the commit count. Both clear when the condition resolves.
  CSS pulses the badge gently so it catches the eye but doesn't
  thrash — the dirty dot's pulse already had a precedent.

### Audit-tab attention badge for unread danger rows
- ✓ Settings shell now polls `/api/audit/<agent>?kind=danger&limit=1`
  every 30s to detect new danger events arriving in the background.
  Compares the newest danger row's createdAt against a localStorage
  cursor (`openthink:audit-danger-seen`); fires the attention-badge
  custom event when there's something past the cursor. Works
  cross-tab because the poll lives in the shell, not the Audit pane
  (the Audit component only mounts when its tab is active).
- ✓ When the user opens the Audit tab + entries land, the pane
  advances the cursor on a 1.5s delay (long enough to notice the
  badge, short enough to feel natural) and dispatches a
  `openthink:audit-danger-seen-bumped` event so the shell's poll
  re-evaluates immediately rather than waiting up to 30s for the
  badge to clear.

### Behavior system-prompt diff vs default
- ✓ The Behavior pane grows a "⇄ Compare to default" collapsible
  below the system prompt textarea — only renders when the current
  prompt actually differs from the Personal assistant template.
  Inside is a word-level diff (custom LCS-driven walk, O(n*m) which
  is fine for ≤300-word prompts) with added words tinted green,
  removed words tinted red + struck-through, context dimmed.
- ✓ Stats chip at the top of the diff body shows `+N added · −M
  removed` so the user can scan the magnitude before reading. A
  "↺ Reset to default" button at the bottom rolls the prompt back to
  the personal-assistant baseline in one click — same `persist()`
  path the template chips use so saving piggybacks on existing
  debounced-write behaviour.

### Knowledge URL fetch retry tracking
- ✓ Knowledge tab now tracks per-URL refresh failures in
  `openthink:knowledge-url-failures` localStorage (count + last
  timestamp per item id). The single-item Refresh button bumps the
  counter on failure and clears it on success. The bulk
  `refresh-urls` worker route now returns a per-id outcomes array
  (with a `reason` like `http_404`, `timeout`, `no_title`); the
  client folds each outcome into the failure tracker so a batch
  refresh updates every row's chip in one pass.
- ✓ Each URL row that has an active failure shows an inline
  `⚠ failed 2×` warning chip (or `failed once` on the first miss)
  next to the "added" date. Hover tooltip surfaces the last failure
  timestamp + a hint about the page being down or moved. Successful
  refresh hides the chip; clearing the cache via a fresh session
  also drops the chip naturally.

### Skills bulk enable / disable
- ✓ The Skills filter row now ships an "Enable all" / "Disable all"
  pill cluster next to the visible-count chip. The pair only renders
  when there are 2+ visible skills (single-row views don't need
  bulk chrome) and disables itself when every visible skill is
  already on / off respectively. Useful with a source filter active
  — "show me everything from the `cloudflare` pack, disable all of
  them" is two clicks instead of N.
- ✓ Cohorts of 6 parallel POSTs to `/api/skills/<id>/toggle` so a
  40-skill bulk doesn't slam the worker; optimistic local flip plus
  snapshot-revert on failure keeps the UI responsive without losing
  data on the rare worker error. Toast confirms with the count
  ("Enabled 12 skills").

### Invocations filter by tool + thread + model + status
- ✓ Worker `/api/invocations/<agent>` now extracts a deduped `tools`
  array per row from the trajectory payload (`toolCalls[].tool`
  or `.name`, capped at 12 names). Both the primary path and the
  payload-parse fallback emit the field so older schemas + new
  schemas both feed the filter.
- ✓ New free-text filter input in the Invocations stats row matches
  case-insensitively against thread title, model, status, and the
  per-row tools array. Lets the user pin "every turn that called
  `researcher.research`" or "all failed runs in this thread"
  without leaving the tab. Persisted to localStorage; Esc clears
  in-field. On ≤600px the input fills the row and uses 16px font
  to suppress iOS auto-zoom.

### Workspaces JSON snapshot export + import
- ✓ New `POST /api/workspaces/import` accepts either a bare array of
  workspace objects OR the canonical `{workspaces: [...]}` shape the
  GET response uses, so an export → import round-trip is trivial.
  Dedupes by `(name, agentName)` so re-importing the same snapshot
  is idempotent; preserves `archivedAt`, `pinned`, `createdAt`, and
  `description` when present.
- ✓ The Workspaces header grows an Export / Import button pair. Export
  downloads a stamped `workspaces-export-<date>.json` containing
  both active and archived workspaces in one document; Import opens
  a hidden file picker and POSTs the parsed contents to the new
  endpoint, then refreshes the live list. Both buttons hide while
  the user has zero workspaces (nothing to export yet) so first-run
  stays uncluttered.

### Goal workflow run resume (re-run)
- ✓ New `POST /api/goal/<id>/resume` reads a goal run's KV snapshot
  and, when its status is one of cancelled / error / aborted, creates
  a brand-new Workflow run with the same goal text + plan. Workflows
  can't be restarted mid-flight (IDs are unique + ended runs are
  immutable), so this is the cleanest re-entry path — a fresh
  workflow id, original params, with `resumedFrom` tagged onto the
  new snapshot so the lineage is traceable.
- ✓ Returns 409 with `currentStatus` when the run is still in flight
  (the caller should `/cancel` first) and 422 when the original
  snapshot is missing required params. Learning's "Recent workflow
  runs" list grows a `↻ Re-run` button on terminal-state goal rows
  that calls the endpoint and optimistically prepends a new queued
  entry so the user sees the action take effect immediately.

### Skill pack contents preview
- ✓ Clicking a pack tile in Skills now expands a contents preview
  beneath the description — lists the installed skill names from
  that pack with a dot indicator showing enabled / disabled state.
  Sorted enabled-first so a glance at the top tells you what's
  actually live; caps at 8 visible with a "+N more · scroll the
  Installed list below" tail so 30-skill packs don't drown the
  panel.
- ✓ Empty-state copy when nothing from the pack is installed yet,
  pointing the user toward the install action. Dot indicator pulses
  the accent ring when on; quiet rule color when off.

### Behavior sampling sliders
- ✓ Behavior pane grows a "Sampling" group with temperature
  (0 → 2, step 0.05) and top-p (0.1 → 1, step 0.05) sliders.
  Both default to undefined in the persisted state so the
  orchestrator falls back to the provider's default; setting either
  writes through the existing settings persist path. A reset arrow
  next to each slider clears the override.
- ✓ Three-column grid (label, slider, value + reset) for clean
  alignment on desktop; collapses to label-on-its-own-line on
  ≤600px. Inline hint copy below explains the knobs in plain
  English so a user not familiar with sampling math doesn't have to
  guess what they're tweaking.

### Workspaces hover preview pin
- ✓ The hover-preview popover that shows recent threads when the user
  mouses over a workspace card now has a pin button in its header.
  Click it and the popover sticks open after pointer leaves — useful
  for sticking around to read + copy a thread title without losing
  the panel the moment the cursor crosses a sibling card. The pinned
  state swaps the glyph to 📌, paints a stronger accent box-shadow,
  and switches `role` from tooltip to region so screen readers treat
  it as persistent content.
- ✓ Only one workspace can be pinned at a time — clicking pin on
  another card swaps it. The popover also adds `onMouseEnter` /
  `onMouseLeave` listeners on the popover itself so the user can
  hover into the panel without losing it. Esc unpins (skipped while
  typing so inputs still blur normally).

### Audit pinned-only export
- ✓ The Audit bulk-actions row grows a star-prefixed "Export pinned
  (N) ↓" button that only renders when the user has pinned at least
  one row. Click downloads a CSV containing only the pinned subset
  — same column layout as the full Export CSV but filtered to the
  user's curated triage set. Wears an accent tint at rest so the
  curated action stands apart from the generic exports.
- ✓ Button title surfaces the count + a fallback hint when the
  pinned rows are currently off-screen (filtered out by date or kind
  search) so the user knows why the button is disabled.

### Skill author client-side linter
- ✓ The skill authoring panel now runs a client-side linter against
  the compiled workflow + raw source. Surfaces 6 advisory checks:
  missing/short description, missing/short step body, very long
  step title (>60 chars), duplicate step titles, destructive verb
  in a step without `requiresApproval`, leftover TODO/FIXME in the
  source. Plus an info-tinted check for 12+ step workflows that
  suggests splitting.
- ✓ Hints are advisory only — don't block save. Warning rows get an
  amber tint with a `⚠` glyph; info rows stay quiet with `ⓘ`. The
  list renders inline below the compiled-preview title so the user
  sees feedback alongside the live compile output.

### Workspaces pinned-preview source-card cue
- ✓ When the user pins a workspace's hover preview open, the source
  card now picks up an accent-tinted background, a 3px inset
  left-edge bar, and a faint 📌 glyph in the top-right corner. The
  visual anchor makes it clear which card the floating popover
  belongs to when the cursor wanders to a sibling. Reuses the
  `workspaces__item--preview-pinned` class wired in the previous
  tick; only the CSS changed.

### Audit log streaming export
- ✓ New `GET /api/audit/<agent>/export` streams JSONL of every audit
  row in a configurable lookback window (default 30d, server-capped
  at 50k rows + 365d). Honors the same filter parameters as the
  paginated GET: kind comma-list, payload-substring search, system-
  scope toggle. Walks the table in batches of 500 keyed by
  `created_at < lastSeen` so a 50k-row export doesn't blow the
  worker's CPU budget — each batch flushes to the stream as it
  arrives, so the browser starts saving the moment the first batch
  lands.
- ✓ Errors mid-stream emit a final JSONL-shaped sentinel
  (`{error, reason, rowsEmitted}`) so a downstream parser can detect
  truncation without breaking on a malformed last line. Audit bulk
  toolbar grows a "Stream 30d ↓" button that mirrors the visible
  filters into the export URL, so the user gets a deeper window of
  exactly what they're looking at.

### Behavior settings JSON portability
- ✓ The Behavior pane gains a "Portability" group with Export config
  / Import config buttons. Export writes a versioned JSON document
  (`{exportedAt, version: 1, agentName, state}`) containing the full
  BehaviorState — system prompt, model, sub-agent model, extended-
  thinking toggle + budget, response style, code mode, sampling
  (temperature, top-p), and the share-skills-upstream toggle.
- ✓ Import validates each field's type before applying so a corrupt
  or partial file can't poison the persisted settings. Unknown
  fields are silently dropped. `responseStyle` and `codeMode` enum
  values are checked explicitly. Calls the existing `persist()` path
  so the worker settings blob updates through the standard debounced-
  save flow + the dirty-tab indicator fires.

### Memory bulk-clear by category
- ✓ New `POST /api/learning/memories/clear-category` accepts a
  `{category}` body and soft-deletes every memory in that category
  via the existing importance=0 mechanism. The vectorize index stays
  intact so a future iteration could restore. Writes a category-
  specific `danger` audit row (`memories_clear_category` action +
  cleared count) so the trail is precise — distinct from the global
  `memories_reset` event.
- ✓ The Learning category chip row gains a dashed danger-tinted
  "× Forget N" button that only renders when a single-category
  filter is active AND the category has rows. Confirm prompt + soft-
  delete semantics matched to the existing per-row Forget flow.
  Optimistic local drop with snapshot-revert on worker failure.

### Skill author fork from existing
- ✓ New `GET /api/skills/<id>/body` returns the raw SKILL.md body for
  a local-source skill (catalog skills stay read-only). Returns 404
  when the id misses or the R2 blob is gone, so the UI can surface
  a clean error.
- ✓ Each local skill row in the installed list grows a "⤴ Fork"
  button. Click fetches the body, fires a new
  `openthink:fork-skill` custom event with `{body, originalName}`,
  and the SkillAuthor pane catches it — opens itself, replaces the
  source with the forked body, clears any "saved" / "draft restored"
  framing, and scrolls into view. The user can then rename the skill
  + edit before saving as a new entry.

### Library batch tag operation
- ✓ New `PUT /api/artifacts/<key>/tags` accepts `{tags: string[]}`
  and stores the sanitized list under `artifact-tags:<key>` KV.
  Same sanitizer rules as Knowledge + Memory tags so a tag
  round-trips identically across surfaces. List endpoint reads
  tags alongside title overrides + star flags; delete also clears
  the tags KV entry to keep the namespace tidy.
- ✓ Library bulk action bar now grows an inline tag input when the
  user has picked ≥1 artifacts in select mode. Enter (or the "Add
  tags" button) UNIONS the new tags into each selected artifact's
  existing list — additive semantics consistent with the Knowledge
  bulk-tag flow. Cohorts of 6 parallel PUTs so a 30-artifact bulk
  doesn't slam the worker; optimistic local merge + snapshot revert
  on failure.

### Library per-tile tag chips + tag filter
- ✓ Each Library tile now renders up to 4 of its assigned tags as
  small chip buttons beneath the age timestamp, with a `+N` tail
  when there are more. Clicking a chip toggles that tag into the
  global filter (AND semantics) without opening the artifact
  preview — the click event stops propagation so the tile's parent
  click handler doesn't fire.
- ✓ Above the grid, a tag filter strip surfaces every unique tag
  across all rows with its artifact count, sorted by frequency. The
  active tag set serializes through the URL hash as `tags=a,b,c`
  alongside the existing `filter` and `q` params so deep links to
  "every chart tagged Q4 final" survive a reload.

### Behavior preview history
- ✓ The Behavior "Try this prompt" mini-chat now records every
  successful prompt/reply pair into a 6-deep ring buffer keyed by a
  cheap 8-char hash of the system prompt. History persists via
  localStorage so a reload doesn't wipe a session's iteration trail.
  Each row shows the message + reply in a two-column grid with a
  "↻ Run again" button that repopulates the message input and
  re-fires the preview against the *current* system prompt — exactly
  what a user iterating on tone wants.
- ✓ Rows whose stored hash differs from the current prompt hash get
  a subtle "· stale" badge in warning tint so the user knows the
  reply was generated against a different prompt version. "× clear"
  in the history header wipes the cache; on mobile the row collapses
  to a single column with the re-run button right-justified.

### Workspaces markdown descriptions
- ✓ Workspace descriptions now render with lightweight markdown —
  **bold**, *italic*, `inline code`, and `[link](https://…)` (only
  http/https URLs, no `javascript:` smuggling). The renderer
  HTML-escapes input first then walks a single combined regex to
  emit React nodes, so we don't need `dangerouslySetInnerHTML`. Line
  breaks survive via `<br />` insertion.
- ✓ Description input placeholder calls out the supported syntax so
  users know they can use it. The `<code>` tag gets a mono pill
  treatment; links pick up the accent color with a dashed underline
  that solidifies on hover. The whole pane respects `white-space:
  pre-wrap` so paragraph breaks in the description render naturally.

### Library tag rename across artifacts
- ✓ Each tag chip in the Library filter row grows a small ✎ pencil
  that surfaces on hover. Click swaps the chip for an inline input
  pre-populated with the current tag; Enter (or blur with a
  changed value) walks every artifact carrying the tag, replaces
  it with the new name in their list (deduping if the target tag
  was already present), and fires per-artifact PUTs in cohorts of
  6 so a 50-row rename doesn't slam the worker.
- ✓ Active-tag-filter set follows the rename — if the user was
  filtering by the old name, the swap migrates the filter to the
  new name so the visible set doesn't break mid-operation. Esc
  cancels the edit. Snapshot-revert on failure keeps the
  optimistic UI safe.

### Behavior preview history diff
- ✓ Each row in the preview-history list now grows a `⇄ diff` button
  when the latest preview reply differs from that row's reply. Click
  flips the row's reply into a word-level diff against the latest
  (using the existing `diffWords` helper from the prompt-vs-default
  diff) with added words tinted accent-green, removed tinted
  accent-red, context dimmed. Click again (or the "× hide diff"
  variant) restores the plain reply.
- ✓ Diff column shows one row at a time so the comparison stays
  focused. The action cluster gains a second pill below the existing
  "↻ Run again" so the two affordances stack cleanly; on ≤600px the
  whole row collapses to single-column with both buttons
  right-justified.

### Workspace activity heatmap
- ✓ Each workspace card now renders a 14-day activity heatmap below
  its description. One vertical bar per day: today flush-right with
  a faint accent outline, oldest flush-left. Bar height is
  proportional to that day's thread-update count (peak-normalized so
  every workspace's strip uses its full range). Empty days render as
  a 2px baseline so the strip's shape stays legible at a glance.
- ✓ Bucket data fetched as part of the existing per-workspace loop —
  we bumped the threads pull from `limit=1` to `limit=50` so the
  same network round-trip populates both the last-activity sort key
  and the heatmap. Tooltip per cell carries the day label ("today" /
  "yesterday" / "Nd ago") + the absolute count. Strip only renders
  when ≥1 day has activity so a brand-new workspace's card stays
  uncluttered.

### Library tag delete
- ✓ Each tag chip in the Library filter row grows a × delete
  affordance alongside the existing ✎ rename pencil. Hover surfaces
  both buttons (both 0-opacity at rest); the delete tints danger on
  hover for confirmation that this one's destructive. Click prompts
  a window.confirm with the affected count before walking every
  artifact carrying the tag and removing it from their list.
- ✓ Tag stripped artifacts whose tag list goes empty drop the `tags`
  field entirely (mirroring the worker's empty-list short-circuit
  on the KV key). Active-tag-filter drops the tag too so the user
  isn't left filtering by a tag that no longer exists. Cohorts of
  6 PUTs + snapshot-revert on failure.

### Spending cross-workspace breakdown
- ✓ Spending tab now grows an "Across workspaces · today" section
  below the per-tool breakdown when the user has 2+ workspaces.
  One row per workspace, sorted descending by today's spend, each
  with a horizontal bar normalized to the heaviest workspace's
  total so relative usage reads at a glance.
- ✓ Rows are click-targets that switch the active workspace +
  reload the page (matching the existing CommandPalette workspace-
  activate flow). The current workspace is highlighted with a
  `here` pill + click-disabled. Section header shows the rolled-up
  total + workspace count. On ≤600px the bar gets its own row so
  the name + cost columns still fit comfortably.

### Audit pin toast
- ✓ Pinning / unpinning an audit row now fires a quiet toast with
  the new total pinned count. First-pin gets a parenthetical hint
  ("(try Export pinned ↓)") that points at the bulk action button
  added two ticks ago, so users discover the workflow without
  spelunking through every row. Subsequent toggles just show the
  count so the affordance doesn't get noisy.

### Skills tester sample message library
- ✓ The inline `✦ Test match` panel under each skill row now shows
  a curated 3–4 chip "try" strip seeded from the skill's own
  description + `whenToUse`. The derive step extracts the top
  content-bearing keywords (stop-word filter, freq-sorted, stable
  alpha tiebreak so chips don't shuffle on re-open) and templates
  them into realistic user phrasings — "How do I {top_keyword}?",
  "Can you handle {next} for me?", "I need {next} now", plus a
  name-anchored "Help me with {skill}" sanity check. Clicking a
  chip prefills the input rather than auto-running so the user
  can riff before sending; if the description is too thin to yield
  three distinct keywords the row pads with universals ("Show me
  an example", "What does this do?"). Chips sit above the recent
  history strip so seeds + past tries stay visually distinct
  (subtle accent tint vs. neutral pill). Memoized on
  `[name, description, whenToUse]` so editing the skill rebuilds
  the seeds, but typing in the input doesn't churn. On ≤600px the
  chip max-width clamps so a long phrase doesn't shove the input
  off-screen.

### Memory diff vs. saved version
- ✓ Editing a memory in the Learning pane now renders an inline
  word-level diff below the textarea showing exactly which
  tokens the in-flight draft adds and removes vs. the saved
  body. Uses an LCS-driven walk (same algorithm as the system-
  prompt diff in Settings) with O(m*n) DP, capped at 25k token-
  pairs so a runaway paste falls back to a bulk "all old → all
  new" render instead of blocking the UI. The strip only mounts
  when the draft actually differs from the saved content (after
  trim), so opening edit on an unchanged memory and tabbing
  away doesn't flash a stats row. Token classes echo the
  existing prompt-diff palette: added text gets a soft green
  underline + tint, removed text gets a soft red strike-through
  + tint. The container blocks mousedown focus theft so
  clicking the diff to inspect it doesn't fire the textarea's
  blur-commit by accident. Stats row shows `+N added` /
  `−M removed` plus a right-aligned "changes vs. saved
  memory" hint that drops to its own line on ≤600px so the
  diff body keeps full width.

### Sync PR inline merge
- ✓ Ready-state PRs in the SyncPanel's "recent PRs" list now
  carry a "Merge ↩" pill button alongside the state pill. Only
  renders when `state === 'open'` AND `reviewerStatus.kind === 'ready'`
  (draft + pending-reviewers rows still need a GitHub roundtrip
  to clear those gates first, so showing the button there would
  just produce 405s). Click → `window.confirm` →
  `PUT /api/sync/pulls/:number/merge` with `mergeMethod: 'squash'`.
  Backend is a new endpoint that validates the PR number as a
  positive int, accepts an optional commit title/body + merge
  method override, and surfaces GitHub's 405 (not mergeable —
  conflicts / required reviews) and 409 (head SHA changed) as
  structured `{ok: false, error}` results so the UI can render
  a useful inline note. Frontend optimistically flips the PR's
  state to `merged` so the row repaints immediately, then
  re-fetches `/sync/status` to pull the canonical state. On
  failure the optimistic flip rolls back and a per-PR error
  chip surfaces next to the state pill (`⚠ not mergeable — …`
  / `⚠ head SHA changed — refresh and retry` / etc.). The
  merge spinner is per-PR-number keyed so two simultaneous
  clicks across different rows don't conflate, and the button
  is disabled across all rows while any merge is in flight to
  serialize the API calls. Without a `GITHUB_TOKEN` bound the
  endpoint returns a stub-success so dev / pre-secret-deploy
  panels still render the merged state optimistically. On
  ≤600px the merge button trims a hair and the error chip
  wraps to its own row so the PR title stays readable.

### Memory tag autocomplete
- ✓ The inline tag editor on each memory row now surfaces a
  typeahead suggestion strip below the input: 1–6 chips drawn
  from the user's global memory-tag pool (frequency-sorted +
  alpha-tiebreak across `memories`), filtered by the partial
  word the user is currently typing, excluding tags already in
  the draft and tags the memory already carries. Highlight
  navigation via ↑/↓ wraps the active index; Enter on an
  active chip completes it (replaces the partial + appends a
  space so the user can chain another tag), Enter on a bare
  draft saves as before. Tab also completes for keyboard
  conventions parity. Chip click uses `onMouseDown.preventDefault`
  to block focus theft so the input's blur-save doesn't race
  the completion. The global tag pool is memoized on
  `memories` so the typeahead set rebuilds only when the
  underlying corpus changes, not per-keystroke. On ≤600px the
  chip max-width compresses + font bumps a hair so the
  typeahead strip doesn't overflow the row.

### Sync per-commit diff expansion
- ✓ Each row in "Recent upstream commits" is now a clickable
  button (real `<button>`, keyboard-focusable) with a leading
  caret glyph that flips on expansion. Click → fetches
  `GET /api/sync/commits/:sha/diff` (new endpoint that hits
  GitHub's commits API with `Accept: application/vnd.github.diff`),
  caches the response in component state, and renders an
  inline file-level diff body underneath using parseDiff +
  the existing `.sync-file` / `diff--add` / `diff--del` /
  `diff--hunk` rendering vocab DiffViewer already owns. Single
  files default to expanded; multi-file commits keep each
  file collapsed so the user gets a path overview first. The
  fetch is per-SHA cached so collapse-then-reopen doesn't
  burn another request; loading state shows a tiny status
  line; failures surface a soft warning chip with a Retry
  button that re-fires the load without touching the open
  state. Backend validates the SHA shape (`/^[a-f0-9]{6,40}$/i`)
  so a malformed click can't slip through to GitHub. Without
  a token, returns the same SAMPLE_DIFF the dry-run pull uses
  so dev still gets a populated drilldown. On ≤600px the
  commit row collapses the author into a sub-row under the
  message so the caret + sha + message still fit on a phone
  width.

### Library bulk-untag
- ✓ The bulk-tag row in select mode now carries a second,
  danger-tinted "Remove tags" button alongside "Add tags".
  Same parsed-and-sanitized tag list, but the worker side of
  the loop sends a tag-subtracted PUT for every selected row
  that carries at least one of the requested tags (no-op
  rows are skipped client-side so we don't burn round-trips).
  Empty results drop the artifact's `tags` field entirely
  rather than write an empty array, matching the single-row
  tag-delete the Library already has. Click → walks the
  selected set, computes the `affected` count (rows that
  actually carry one of the typed tags), and either toasts
  "None of the selected rows carry those tags" or surfaces
  a `window.confirm` with the exact number of artifacts
  about to be untagged. Cohorts of 6 PUTs with optimistic
  state + rollback on failure, identical to applyBulkTags's
  shape. On ≤600px both buttons stretch full-width under the
  input so the destructive sibling doesn't sit too close to
  the additive one on a thumb-sized screen.

### Skills tester batch run
- ✓ The sample-message strip now carries a "Run all" trigger
  at the end of the row. Click → fires every sample chip
  through `/api/skills/:id/match` sequentially (avoiding a
  4-way fan-out against the same DO), tallies hits +
  failures, and surfaces an aggregate `"X/N activate"` toast
  at the end. Each chip wears a verdict glyph after the run
  completes: ✓ on a green tint for activate, ○ on a neutral
  tint for skip, × on a soft red tint for fetch failure.
  Hover/title on a verdict chip shows the exact score +
  threshold so the user can sanity-check borderline matches.
  Clicking a verdict chip routes through the existing single-
  fire path with the full matched-tokens breakdown, so the
  user can drill into "why didn't this one activate?"
  without retriggering the batch. Disabled while the batch
  is in flight or a single-fire run is busy. Functional-
  update setState in the loop keeps per-chip results
  coherent without stale closure churn.

### Sync PR draft → ready
- ✓ Draft PRs in the recent-PRs list now carry a soft-amber
  "Mark ready ↑" button next to the review chip, mirroring
  the Merge action's shape but tinted to match the
  `sync-pr__review--pending` color family. Click →
  `PUT /api/sync/pulls/:number/ready`. Backend is a new
  two-step endpoint: REST GET the PR by number to pluck its
  `node_id`, then fire the `markPullRequestReadyForReview`
  GraphQL mutation (the REST API doesn't expose this
  transition). Short-circuits with `alreadyReady: true`
  when the lookup shows `draft: false` so the UI's
  optimistic flip lands clean even if upstream raced.
  GraphQL errors surface through the same per-PR error-
  chip slot used by the merge endpoint so the row stays
  consistent. Optimistic client-side `draft: false` flip
  with snapshot-rollback on failure; a successful
  transition fires `refresh()` to pull reviewer-requested
  / CODEOWNERS auto-assignments that GitHub fires when a
  draft becomes ready. The merge + ready spinners share a
  global disable so two simultaneous actions across the
  list can't race. Without a `GITHUB_TOKEN` the endpoint
  returns a stub-success for dev parity. On ≤600px the
  button shrinks a touch in line with the other PR-row
  actions.

### Memory sort by recency
- ✓ The memory filter row now carries a `sort` dropdown
  inline with the search input — 6 lenses: recently updated
  (default — where edits land), least recently updated,
  newest first, oldest first, highest importance, and
  alphabetical. Selection persists to localStorage
  (`openthink:memory-sort`) so a reload keeps the user's
  preferred lens. The comparator is hoisted to a stable
  factory so the sort stays consistent across re-renders;
  the importance-desc lens ties-break on updatedAt-desc so
  equal-importance cohorts still feel coherent. Applied as
  the final step in the filter pipeline (category →
  active-tag → active-memTag → free-text → sort) so all
  narrowing happens first. The dropdown's native caret is
  suppressed in favor of a CSS-drawn glyph so the wrapper
  sits flush with the search row; on ≤600px it drops below
  the search input with a top-rule seam so neither has to
  fight for horizontal space on a phone.

### Audit bulk-pin visible
- ✓ The audit bulk toolbar now carries two new actions that
  cluster with the Export-pinned button: "★ Pin visible (N)"
  pins every entry that survived the current kind / date /
  search filters (already-pinned rows are no-op'd, so the
  count reflects only the rows it'll actually touch), and
  "☆ Unpin all" clears the whole pinned set after a
  `window.confirm`. When exactly one kind filter is active,
  the Pin-visible button's tooltip names the filter
  (`Pin every "danger" row in the current view`) and the
  success toast appends the kind label to the confirmation
  so the user can scan back through the audit log and know
  what cohort they just grabbed. Hidden when there's
  nothing to pin (no unpinned visible rows) so the toolbar
  doesn't fill with dead actions on empty cohorts.

### Settings nav badge pulse
- ✓ The warning-tinted attention dot on each Settings tab
  now flashes through a 3-pulse "I just lit up" animation
  whenever the underlying `openthink:settings-attention`
  event flips on (or its reason changes) — a noticeable
  scale-bump + radiating ring + transient background-fill
  so a fresh alert grabs the user's peripheral vision even
  when they're focused on another pane. The flash burns for
  ~1.65s and then hands off to the existing gentle 2s breath
  animation, so a stale alert doesn't keep bouncing forever.
  Per-tab clear-timers are held in a ref so rapid re-bumps
  reset their own deadline instead of leaking. Active-tab is
  excluded from the pulse (the user is already looking at
  it) and any in-flight pulse is cleared the moment the
  user selects that tab, freeing the timer so it can't fire
  after they've acknowledged the alert. Honors
  `prefers-reduced-motion` with a quieter opacity-only
  variant so vestibular-sensitive users still get a "fresh
  signal" cue without the bouncing.

### Library row duplicate
- ✓ The Library tile right-click context menu now carries a
  "⎘+ Duplicate" item that clones the artifact bytes,
  metadata, and tags as a fresh draft. Stays purely client-
  orchestrated — no new worker endpoint, since the existing
  `GET /api/artifacts/:id` + `PUT /api/artifacts/:id` pair
  already exposes everything needed. New R2 key is the
  source key with `-copy-<6char>` inserted before the
  extension so the directory prefix and inferred type stay
  consistent and the downloaded filename feels right; new
  title gets a "(copy)" suffix. Star flag is intentionally
  dropped (a duplicate is a working draft, not a pinned
  peer), version resets to 1. Tags mirror via a best-effort
  `PUT /api/artifacts/:id/tags` after the bytes land — a
  transient tag-save failure leaves the duplicate tag-less
  rather than rolling back the whole clone. Optimistic
  insert into the grid via `sortArtifacts` so the new tile
  pops to the top of the recent tier immediately; a future
  /list refresh reconciles. Context-menu height estimate
  bumped 248→288 so the menu still clamps cleanly when the
  user right-clicks near the viewport's bottom edge.

### Skills tester negative samples
- ✓ The `✦ Test match` panel now renders a second sample
  strip labeled "shouldn't match" below the positive
  samples — 3 generic phrases drawn from a curated pool
  (weather, jokes, currency conversion, etc.) that don't
  share any 4+ char keyword with the skill's description
  + whenToUse. Selection is deterministic per-skill via an
  FNV-1a name hash → mulberry32 PRNG → partial Fisher-
  Yates, so the displayed trio is stable across re-opens.
  Verdict semantics invert on this strip: ✓ glyph + green
  tint means "skill correctly skipped this unrelated
  prompt", × glyph + red tint means a false-positive
  activation (threshold is too loose). Negative chips rest
  with a dashed border to telegraph "this is a negative
  test seed" before any batch runs; the dashed border
  promotes to solid once a verdict lands. The Run-all
  batch now walks both strips in one pass and the success
  toast carries a two-axis summary: `X/N activate · 0/M
  false-positives` (or `· M false-positives` when the
  threshold misfires, which also flips the toast to err).
  Tooltips on negative chips spell out the desired vs.
  observed outcome so a hover answers "why is this red?"
  without re-deriving the inversion in the user's head.

### Sync diff find-in-diff
- ✓ The DiffViewer header now carries a find input with a
  search glyph + match-count chip + clear ×. Ctrl/Cmd+F
  while focus is anywhere inside the dialog snaps focus to
  the input and selects its current contents (canonical
  browser-find ergonomics). Filter runs per-file: files
  whose lines don't contain the query collapse out of the
  list, surviving files auto-expand so the user doesn't
  have to click each one to see why it survived, and a
  per-file `⌕ N` chip appears in the summary row. Matches
  highlight inline via a yellow `<mark>` wrapper around
  every occurrence; case-insensitive substring match. The
  total-hits chip carries a zero-state warning tint when
  the pattern doesn't appear anywhere, so the user gets a
  "your search isn't in this diff" answer without having
  to spelunk the empty file list. Escape inside the input
  clears the query (and the empty-state pane re-routes
  back to the standard file list). On ≤600px the input
  drops to its own row inside the header so it doesn't
  fight the bulk buttons for horizontal space, and the
  font bumps to 14px to clear iOS's auto-zoom threshold.

### Audit j/k/p keyboard shortcuts
- ✓ The Audit list now drives by keyboard: `j` next row,
  `k` previous row, `p` toggle pin on the focused row,
  Enter/Space toggle expand. Focus tracks the row id (not
  the index) so a filter / sort change doesn't strand the
  highlight on a moved row — and a watch effect drops the
  focus entirely when the focused row falls out of the
  filtered set. Listener bails when the active element is
  a text input / textarea / contentEditable / select so
  shortcut keys don't hijack the search box, and skips
  when a `[role="dialog"]` has captured focus elsewhere.
  Cmd/Ctrl modifiers explicitly excluded so browser
  shortcuts (Ctrl+J downloads, etc.) still work. Wraps at
  both ends so the user can ride the list past its tail to
  start over from the top. Smooth-scroll on every jump
  via `scrollIntoView({ block: 'nearest' })` so the
  focused row is always visible without snapping the
  viewport around. Focused row gets a left-edge accent
  rail + soft accent-tint bg (padding adjusted so the
  border doesn't shift the row content on focus). A small
  `<kbd>j</kbd><kbd>k</kbd> nav · <kbd>p</kbd> pin` hint
  appears next to the entry count in the toolbar so users
  discover the shortcuts; hidden on ≤600px since touch
  users wouldn't benefit.

### Command palette preview pane
- ✓ The Cmd/Ctrl+K palette now renders a dedicated preview
  aside next to the results list — surfaces extended
  context for whichever item the cursor is on so the user
  can hover-scan options without committing. Reads the
  item's tab + kind to derive a "what will Enter do"
  hint, plus a richer body for the Sections tab (each
  section gets a curated one-liner about what's in that
  destination — "Models, automation, spending caps,
  audit log, and the sync panel" for Settings, etc.). The
  pane shows: kind label + group, item title, body /
  subtitle, the navigation target (`#/…` href in a code
  pill, word-broken at slashes for long artifact keys),
  last-used relative time when present, and a hint line
  about how to activate it. A 140ms fade smooths the
  transition when ↑/↓ jumps the cursor between items. On
  ≤720px the pane drops below the result list with its
  own border-top + caps at 35vh so neither feels squeezed
  on phone widths.

### Learning quick-add per category card
- ✓ Each category card in the Learning screen now carries
  an inline `Add to {category}…` input + Add button below
  the body copy + memory count. Enter or click POSTs a
  single-item array to `/api/learning/memories/bulk` with
  `category: c.id, content, importance: 1`, then refreshes
  both `/api/learning/memories` (so the new row appears in
  the list above) AND `/api/learning/summary` (so the
  per-category count flips immediately rather than staying
  stale until the next page load). Per-category draft
  state is keyed by category id so composing across
  multiple cards stays independent — typing into
  "user_facts" doesn't bleed into "preferences". The
  bulk endpoint's dedup gate is honored: a content match
  on the same category surfaces "Already remembered
  (duplicate)" as an `err` toast rather than a misleading
  success. Esc clears the in-flight draft. Disabled state
  on busy + empty drafts. The mount-time memory load was
  also pulled into a `refreshMemories` helper so the
  add-handler can call the same shape rather than
  duplicating the GET. On ≤600px the input bumps to 16px
  (iOS no-zoom threshold) and the Add button grows so
  tap targets clear the 30px guideline.

### Deploy phase elapsed timer
- ✓ The deploy progress per-step row used to show `…` for
  the currently-running step; now it shows a live
  `Xs` pill that ticks every 200ms via the existing
  elapsed-counter setInterval. Start time is captured the
  first time we see a step transition into `running` —
  stored in a ref keyed by step id so a snapshot replay
  (after a stream reconnect or tab reload) doesn't reset
  the clock for steps already past. Pill carries an
  accent tint + a gentle 1.6s breath animation so the
  active row reads as alive without the numeric churn
  becoming visually noisy; the animation drops on
  `prefers-reduced-motion`. Tabular-num font-variant so
  the rolling digits don't jitter horizontally. Retry
  resets the per-step timestamp map so a re-run starts
  the clock fresh from the new attempt's
  running-transition. Errored steps that recorded a
  duration now also show that final timing in the same
  slot (previously only "done" steps showed it).

### Skills tester what-if threshold slider
- ✓ The tester result panel now carries a range slider
  (0.05 → 0.50, step 0.01) that lets the user simulate
  "would this prompt activate at threshold X?" against
  the result's score — pure client-side, no global
  setting touched. Slider snaps to the orchestrator's
  live threshold on every fresh single-fire so the
  starting position matches what the user actually
  sees in production; a what-if drag survives until
  the next test. As the user drags, the verdict glyph
  + label flip live (✓ Would activate / ○ Skipped) and
  the threshold readout in the score line picks up a
  dotted underline + accent color when the position
  drifts from the live value. A small ↺ reset chip
  appears next to the slider when drifted — clicks
  snap back to the live threshold so the user doesn't
  have to remember the original value. Custom thumb
  styling (Webkit + Firefox) gives a tactile dot that
  scales on hover/focus. Mobile wraps the slider to
  its own row + keeps the reset chip flow-anchored
  rather than letting it overflow the result card.

### Library Shift+arrow range select
- ✓ The grid's arrow-key navigation now extends into a
  Finder-style range selection when Shift is held.
  Shift+ArrowLeft/Right/Up/Down (plus Shift+Home/End)
  moves focus AND walks `selectRangeTo` from the
  anchor (last-clicked tile) through the new focus
  target, adding every non-stub tile in between to the
  selection. When no prior click anchor exists, the
  shift-arrow seeds the anchor on the currently-
  focused tile so the next arrow press extends rather
  than no-ops. Resolution from focused-DOM-node to
  artifact id uses a new `data-artifact-id` attribute
  on each tile, so the handler stays decoupled from
  the closure scope of any particular row. Stub tiles
  are still filtered out by selectRangeTo's existing
  filter so a Shift+arrow over a stub-only band
  doesn't pollute the selection. Bulk-bar helper text
  was updated to telegraph the new shortcut alongside
  the existing Shift+click + ⌘A patterns.

### Audit kind chip counts
- ✓ Each filter chip in the Audit kind toolbar now
  carries an inline `(N)` tally chip on its right
  edge — drawn from a new
  `GET /api/audit/:agentId/counts` endpoint that runs
  a single `GROUP BY kind` query against audit_log,
  honoring the user's date / search / system-include
  filters but deliberately excluding the kind filter
  itself (so the chip always shows "how many of THIS
  kind exist in the current window" rather than the
  trivial `0 or all` shape of mirroring the active
  filter). The "all" chip rolls up every kind into
  one total. Zero-cohort chips fade to 55% opacity
  (still interactive — the user might want to widen
  the date range and re-check) and their count chip
  drops a notch in opacity. Active chips lift their
  count chip's tint to match the accent so the count
  reads as part of the active state, not a separate
  region. The counts endpoint falls back to an empty
  map when D1 errors, so the toolbar gracefully hides
  the counts rather than breaking when audit storage
  is unavailable. Counts re-fetch whenever the
  base-filter URL changes (date / search /
  system-include flips), staying in sync without a
  full audit-list re-pull.

### Sync per-commit diff find
- ✓ Each expanded commit row in "Recent upstream commits"
  now carries its own inline find input on the summary
  line (when the commit touches ≥2 files — single-file
  commits already render their full diff and let the
  browser's native Ctrl+F do the work). Filter is
  scoped per commit so a search in one expanded row
  doesn't leak into another. The match logic shares
  the dry-run DiffViewer's `highlightDiffLine` helper
  via a new module-level extraction — same case-
  insensitive substring matching, same yellow `<mark>`
  highlight, same zero-length-guard against infinite
  loops. Files with zero matches collapse out of the
  list; survivors auto-expand so the user doesn't
  have to click each one to spot the hit. A
  per-file `⌕ N` count chip appears alongside the
  +/- stats in each surviving file's summary. Total
  hit count surfaces inline next to the input with a
  soft warning tint when the pattern doesn't appear
  anywhere. Escape inside the input clears the
  query. On ≤600px the input drops to a full-width
  row inside the summary so the +/- chips keep
  their space.

### Spend by provider rollup
- ✓ The per-tool spending section now carries a
  secondary "By provider" rollup beneath the existing
  per-tool legend — aggregates tool entries by their
  leading slug before the first `/` (e.g.
  `workers-ai/llama-3.1-70b-instruct` and
  `workers-ai/llama-3.1-8b-instruct` both fold into
  `workers-ai`). Tools without a slash bucket to
  their full name so infrastructure entries like
  `browser-rendering` and `github-mcp` still render
  under sensible labels. The section reads as the
  vendor-level "where am I burning money" view; the
  more detailed per-tool table sits above as the
  drilldown lens. Hidden when there's only one
  provider since there's nothing to compare. Same
  stacked-bar palette as the per-tool view but with
  rolled-up segments — visually consistent. Compact
  legend grid renders provider name + dollar amount
  + percentage in a single row so the section reads
  at a glance. On ≤600px the grid drops the fixed-
  width columns and auto-sizes around the percent
  chip.

### Library tag chip drag-reorder
- ✓ The tag-filter chip row above the library grid
  is now draggable. Each chip wraps in a `draggable`
  span with full HTML5 drag-and-drop handlers; drop
  on another chip inserts the dragged tag
  immediately before the target. The new order
  persists to localStorage
  (`openthink:library-tag-order`) as a plain string
  array so reloads keep the user's curated sort
  intact. First drag also seeds the order with the
  current frequency baseline so tags the user
  didn't move retain their natural position; new
  tags introduced after a reorder show up at the
  uncurated-frequency tail rather than randomly
  shuffling in. Dragging dims the source chip to
  40% opacity + scales it down 4% so the user has a
  strong "you've picked this up" cue; the drop
  target shows a left-edge accent rail (drawn via
  ::before so it doesn't perturb flex layout) so
  the insertion point is unmistakable. `cursor:
  grab` on the wrap + `grabbing` on active reads
  the affordance without screaming. The chip's
  internal toggle, rename, and delete buttons stay
  fully clickable — drag and click are
  disambiguated by the browser's mousedown→move
  threshold.

### Library tag-order reset
- ✓ Renders an inline "↺ reset order" chip alongside
  the existing × clear filter affordance, but only
  when a curated drag-order is actually persisted
  (`tagOrder.length > 0`). Click prompts via
  `window.confirm`, then clears the order array —
  which also wipes the localStorage entry via the
  existing persistence effect — so tags re-sort by
  pure frequency. Toast confirms the reset.
  Dashed-border + soft accent tint visually separates
  it from the destructive × clear sibling so the user
  reads it as "undo my arrangement" rather than
  "delete data". Hidden when no curated order exists,
  so the chip row doesn't camp on a dead affordance.

### Spend sparkline Catmull-Rom smoothing
- ✓ The 80×18 per-tool sparkline used to render as a
  straight-segment polyline through the 24 hourly
  data points; now each segment becomes a cubic
  bezier whose control points come from the slope at
  both endpoints (derived from neighboring data
  points with tension 1/6 — classic Catmull-Rom to
  Bezier conversion). The curve passes exactly
  through every bucket value so the spike + dip
  shapes stay truthful — only the connecting
  segments smooth out. Boundary segments treat the
  first/last point as their own virtual neighbor so
  the head + tail don't lurch toward zero while the
  middle is curved. Same SVG output shape so the
  existing fill-below-the-line + stroke pair still
  works without CSS changes. Result reads as a much
  more organic shape — tiny chart, big quality
  upgrade.

### Sync commit list j/k navigation
- ✓ Recent-upstream-commits now drives by keyboard:
  `j` next, `k` previous, Enter/Space expand the
  focused commit's inline diff. Focus tracks the SHA
  (not the index) so a status refresh that
  re-orders the list doesn't strand the highlight
  on a moved row — and a watch effect drops the
  focus entirely when the focused commit falls off
  the recent-window tail. Listener bails when focus
  is in a text input / textarea / contentEditable
  / select, when a `[role="dialog"]` has captured
  focus elsewhere, and when modifier keys are held
  (so browser shortcuts like Ctrl+J still work).
  Also gates on `.sync-panel__commits` being
  present in the DOM so the listener doesn't fire
  on tabs that don't mount the sync panel. Wraps
  at both ends. Smooth-scroll on every jump via
  `scrollIntoView({ block: 'nearest' })`. Focused
  row gets a left-edge accent rail + soft bg shift
  (padding compensated so content doesn't shift
  on focus). Header carries a `<kbd>j</kbd>
  <kbd>k</kbd> nav · <kbd>↵</kbd> expand` hint;
  hidden on ≤600px.

### Skills tester global history strip
- ✓ Test prompts that landed a real verdict now mirror
  into a cross-skill `openthink:skill-tester-hist-global`
  localStorage pool (cap 12) alongside the existing
  per-skill bucket. When the user opens a tester that
  has nothing in its per-skill history — typical for
  freshly-forked skills or just-saved skill drafts —
  a second "also across skills" strip renders below
  the per-skill strip with the globally-recent
  prompts that aren't already shown above. Dashed-
  border chip variant telegraphs "this came from a
  different skill" without hindering the click target;
  hover/focus promotes the dashed style to solid for
  feedback parity with the rest of the chip family.
  Clear-clear semantics: the per-skill clear button
  only wipes that skill's bucket; a separate clear
  button on the global strip nukes the cross-skill
  pool. Both push paths fire on every successful
  verdict so the two stores stay coherent without
  cross-coordination.

### Library tile drag-to-tag
- ✓ Library tiles are now draggable (non-stub only);
  drag onto any tag chip in the filter row to apply
  that tag to the artifact. A custom
  `application/x-openthink-tile` MIME type rides the
  dataTransfer so the tag-chip drop targets can
  distinguish a tile drop (apply tag) from a tag-chip
  drop (reorder) — both flows share the same chip
  surface without conflicting. Tile drag sets
  `effectAllowed = 'copy'` so the browser cursor
  reads "add to tag" rather than "move into tag".
  Drop handler bails politely on already-tagged
  artifacts ("Already tagged \"x\"" toast) and on
  the 12-tag cap ("Tag limit reached" toast) so the
  user gets fast feedback when the server-side
  limit would reject anyway. Successful drops show a
  confirmation toast with a truncated artifact title +
  the applied tag so off-screen drops still feel
  acknowledged. Optimistic local row update with
  snapshot rollback on network failure, matching the
  bulk-tag pattern.

### Audit row jump-to-related
- ✓ The expanded-row action cluster now surfaces up
  to 5 context-appropriate destination links per
  audit kind: open-in-chat (existing threadId
  path), spend-by-tool (jumps to Spending tab with
  a new `?tool=` param the Spending component reads
  on mount + seeds into `expandedTool`), open-PR
  (external link to GitHub for pr_back rows with
  `prUrl`/`url`), open-sync (jumps to Sync tab for
  sync rows), and open-skills (Skills tab for
  skill_save rows). Each link is gated on the row's
  payload shape so we never render a dead link —
  `tool_call`/`spend` need a `tool`, `pr_back`
  needs a URL, etc. Skills + sync deep-links keep
  destination-only routing for now (no per-id
  drilldown), but the navigation alone collapses
  the "I see this row, where do I go next?" gap.
  The legacy threadId-only inline JSX block was
  subsumed by the new cluster — single source of
  truth for which jumps render.

### Audit payload tree/raw view toggle
- ✓ The audit bulk toolbar now carries a `tree | raw`
  radio toggle (active button accent-tinted; the
  selection persists to localStorage) that flips
  every expanded entry's payload between the
  existing collapsible `JsonTree` and a new
  `PayloadRaw` block that pretty-prints with
  2-space indent. Raw mode is built for copy/paste
  into bug reports — the block carries a "Copy"
  button (clipboard write + toast feedback) plus a
  line + char count chip so the user can gauge
  payload size before grabbing it. The stringify
  walk soft-replaces BigInt and Symbol values
  (which `JSON.stringify` throws or silently
  drops) so weird payload shapes don't crash the
  render. Body capped at 380px height with native
  scroll so a 10kb tool_call payload doesn't push
  the next row off-screen. Global rather than
  per-row so the user picks once and sticks; the
  default stays `tree` to keep behavior identical
  on first visit.

### Library tile drag-to-tag visual cue
- ✓ While a library tile is being dragged, every
  tag chip in the filter row lights up as a valid
  drop target: soft accent-tinted background +
  subtle border-color shift + a gentle 1.4s breath
  pulse animation (suppressed under
  prefers-reduced-motion). The over-state from the
  existing reorder flow takes priority — the chip
  the cursor is currently over gets a stronger
  accent fill + 3px halo ring, and its animation
  halts so the active drop target stands out from
  the pulsing siblings. State driven by a new
  `tileDragging` boolean set on the tile's
  onDragStart + cleared on onDragEnd, so the
  cross-component cue doesn't need to thread the
  payload through the drag's dataTransfer (which
  is read-only outside the drop handler). Drag-end
  always clears the flag so a cancelled drop
  doesn't leave the chips pulsing.

### Skills tester history import/export
- ✓ The Skills "Installed skills" section header
  now carries `↓ Export tester history` and
  `↑ Import…` buttons that round-trip the agent's
  test-prompt library across OpenThink
  installations. Export bundles the global recent
  pool + every per-skill bucket into a
  schema-tagged JSON (`openthink/tester-history@1`)
  with the agent name + export timestamp. Import
  parses, validates the schema, and merges every
  recognized prompt (from both globalRecent +
  every per-skill bucket — since skill ids
  generally don't match across installations, we
  treat per-skill entries as additional seeds for
  the global pool). Dedup against the current
  global pool reports `Imported N unique prompts
  (M skipped)` so the user knows what landed.
  Schema mismatch + invalid JSON surface
  structured errors via toast. File input is a
  hidden `<input type="file">` wrapped in a
  `<label>` styled as a button so the affordance
  reads as a sibling to Export rather than a raw
  picker. Reset of the input value after each
  pick lets the user re-select the same file
  twice in a row without a confused state. On
  ≤600px the two buttons stretch full-width
  under the section copy.

### Sync PR list search
- ✓ The PR filter controls row now carries a
  free-text search input alongside the existing
  state-filter chips + sort dropdown. Matches the
  PR title (case-insensitive substring) and the
  number (so typing `423` or `auth` both work).
  Persists to localStorage
  (`openthink:sync-pr-search`) so the user's "show
  me only PRs about the auth flow" lens sticks
  across reloads alongside the filter + sort
  preferences. Empty-state copy is now context-
  aware: when search yields zero results, the
  message names the missing query (and which
  state filter, if active) instead of the generic
  "No PRs match the active filter". Escape clears
  the input. On ≤600px the search input claims
  its own row inside the controls cluster so
  neither it nor the chip row gets squeezed.

### Library tile hover preview
- ✓ Hovering a tile for ≥350ms now spawns a
  floating preview popover anchored to the right
  of the tile (flips left when the tile is near
  the viewport's right edge, drops to fit when
  vertical overflow would clip). Shows full
  untruncated title (capped at 3 lines via
  line-clamp), type chip, relative age, exact
  size + version + uploaded-at, the starred
  flag, every tag (not just the first 4 the tile
  renders inline), and the raw R2 key in a
  dashed code pill at the bottom. Hover delay
  prevents a quick sweep across the grid from
  spawning flicker. `pointer-events: none` on
  the popover so the user can sweep tile-to-tile
  without the popover sticking to wherever they
  paused. Suppressed during drag-to-tag, select
  mode, when the context menu is open, and on
  stub tiles (no meaningful metadata). Drag-end
  also explicitly clears any in-flight hover so
  a cancelled drop doesn't strand the popover.
  140ms fade-in animation; hidden entirely on
  ≤600px since hover doesn't apply meaningfully
  on touch.

### Spend cap approach warning
- ✓ When daily spend is ≥85% of the cap (but
  not yet hit), a soft-amber warning banner
  appears beneath the spent-bar with the exact
  percentage used, dollar headroom remaining,
  and a suggested action ("Raise the cap above,
  pause spending, or wait Xh Ym for the reset
  window"). Two severity steps: 85–94% renders
  in the amber palette, 95–99% bumps to a more
  urgent orange-red. Cleanly ducks out at 100%
  so it doesn't stack with the existing
  `blockedNotice` red banner that fires on
  block. Dismissible per-day — the suppression
  is keyed on the YYYY-MM-DD stamp in
  localStorage so today's dismissal doesn't
  carry over to tomorrow. Honors the existing
  `settings-blocked-in` slide-in animation so
  the banner feels like part of the same family
  as the cap-reached notice.

### Library hover preview text snippet
- ✓ The Library tile hover popover now fetches a
  first-4KB range of the artifact's R2 body and
  renders a 700-char text snippet inside the
  preview card. Only fires for text-y types
  (`document`, `code`, `table`, `webpage`);
  binary types render a quiet "(binary — no
  text snippet)" placeholder instead. The
  fetch uses HTTP Range — `bytes=0-4095` — and
  the artifacts endpoint now honors that
  natively via R2's `range: {offset, length}`
  option (responds with 206 + Content-Range
  when ranges are requested, full 200 otherwise).
  Per-artifact snippet cache lives in a ref so
  re-hovering the same tile is a synchronous
  cache hit; AbortController cancels in-flight
  fetches on mouseleave. Snippet truncation
  walks back to the last whole-word boundary
  before 680 chars so the preview doesn't end
  mid-token. Control bytes get stripped so a
  near-binary file with stray bytes doesn't
  render as visible garbage. The popover gets
  a mask-image fade at the bottom so the
  truncation reads as intentional.

### Audit 14-day histogram
- ✓ New `GET /api/audit/:agentId/histogram?days=14`
  endpoint runs a single
  `GROUP BY strftime('%Y-%m-%d', ...)` query
  and backfills empty days so the result is
  always exactly `days` long, oldest→newest.
  Frontend renders an inline 14-bar mini-chart
  above the kind toolbar with bar heights
  normalized to the visible-window max so quiet
  days still register. Each bar is a click-to-
  filter button that scopes `fromDate` + `toDate`
  to that single day; clicking the active day
  again clears the scope (round-trip toggle).
  Empty-day bars render as muted rule-tinted
  stubs with the count hidden so the chart
  isn't noisy on quiet stretches. Tooltip
  carries a human date label (Today / Yesterday
  / "May 14") + entry count. Re-fetches on
  search-query and system-include changes but
  honors no date scope itself (the chart IS the
  date navigator). On ≤600px the per-bar count
  labels hide so the bars stay tappable.

### Skills tester sample pin
- ✓ Shift+click any sample chip in the `try`
  strip to pin it; pinned samples survive
  description edits (which otherwise reshuffle
  the derived set) and always render first.
  Per-skill localStorage
  (`openthink:skill-tester-pinned:${skillId}`)
  with a 12-pin cap so the strip doesn't blow
  out. The chip merge dedupes case-
  insensitively so the same prompt can't appear
  twice as a pinned + derived pair. Pinned
  chips show a 📌 glyph (grayscale-tinted so it
  doesn't pull more attention than the chip
  text) and an accent halo box-shadow. The
  `try` strip label tacks on `· 📌N` when at
  least one sample is pinned so the count is
  visible without inspecting every chip. The
  Shift+click affordance is telegraphed in
  every chip's title attribute + the strip
  label's tooltip so the shortcut is
  discoverable. Single click still prefills /
  re-runs as before — the pin path adds to the
  shortcut family without changing the
  primary action.

### Cloudflare token revalidate
- ✓ The Cloudflare settings tab now carries a
  `Validate token…` button beside the existing
  Rotate-token affordance. Click opens an inline
  password-typed input + Check button; submit
  posts to the existing
  `POST /api/cf-token/validate` endpoint and
  surfaces a structured verdict inline (✓
  Valid · status: <code>active</code>, or ✗
  with the upstream error string + a link to
  rotate the token). Token never persists
  client-side — we only POST it to the worker,
  which in turn hits Cloudflare's
  `/user/tokens/verify` and discards. The panel
  collapses on a second button click; closing
  resets the input + verdict so a re-open
  starts clean. Soft slide-in animation matches
  the existing settings-blocked banner family
  so the surface reads as part of the same
  affordance vocabulary. On ≤600px the input +
  Check button stack so each gets a comfortable
  tap target.

### Library hover-preview keep-alive
- ✓ The Library tile hover popover dropped its
  `pointer-events: none` and gained a 120ms
  grace timer on tile mouseleave — the user
  can now slide the cursor from the tile into
  the popover to interact with its contents
  (select the R2 key for copy, hover a tag).
  Implementation: a separate `hoverGraceRef`
  timer that schedules a deferred clear on
  tile-leave; the popover's own mouseenter
  cancels that timer (keeping the popover
  alive), and the popover's mouseleave fires
  an immediate clear (the user is done with
  it). Re-entering the tile during the grace
  window also cancels the clear naturally
  because the spawn-timer effect already
  resets state. Snippet AbortController gets
  invoked in both clearHover + scheduleClear
  paths so a slow R2 range fetch can't strand
  the cache mid-write.

### Audit histogram weekday colors
- ✓ Each bar in the 14-day audit histogram now
  shows the weekday as a single-letter glyph
  below the count (S M T W T F S pattern) so
  the week's rhythm reads at a glance. Weekend
  bars (Sun/Sat) get a softer fill tinted
  toward `--ot-ink-mute` so the work-week
  stands out; their day-label gets an italic
  treatment too. Today picks up an accent
  underline-dot under its weekday glyph so the
  user can find the current day without
  counting bars. Active filter still wins —
  the click-to-scope-date affordance + accent
  fill override both the weekend and today
  treatments cleanly. Tooltips now include
  the full weekday name ("Sunday · Today · 12
  entries") for screen readers + on-hover
  scanning.

### Audit histogram top-kind tooltip
- ✓ The histogram endpoint now returns per-bucket
  `{date, count, topKind, topKindCount}` via a
  GROUP BY (day, kind) + ORDER BY n DESC query —
  one DB roundtrip, no client-side aggregation.
  Per-day rollup picks the highest-count kind for
  the day plus its share. Frontend tooltip
  surfaces it inline: "Sunday · Today · 12
  entries · top: tool_call (8/12 · 67%)". Screen-
  reader aria-label includes the top-kind name
  too so accessibility parity holds. Bucket
  shape backfills on empty days so the array
  stays exactly `days` long. Bar fill color
  intentionally kept neutral — the chart's
  primary axis is volume; kind belongs in the
  tooltip where the user is asking the question.

### Library tag chip untag-from-selected
- ✓ When in select mode with ≥1 row highlighted,
  each tag chip's button row gains a third
  pill button (⊟ N) that surfaces only when at
  least one of the selected artifacts carries
  that tag. The N is the live count of those
  artifacts. Click fires the existing
  removeBulkTags helper after staging the
  chip's tag into the bulk-tag draft via
  `queueMicrotask` so React's setState flushes
  before the helper reads its inputs. Reuses
  the same confirmation copy + cohort-of-6
  PUT semantics as the bulk-tag toolbar's
  Remove button. Soft-amber tint distinguishes
  it from the existing × delete-all (which
  stays destructive-red); the warning palette
  reads as "scoped subtractive" rather than
  "global sweep". Hidden when the tag isn't
  on any selected row so the chip doesn't
  decay into a dead button.

### Sync PR list j/k navigation
- ✓ The recent-PRs list now drives by keyboard
  alongside the commits list: `j` next, `k`
  prev (both wrap), Enter opens the focused
  PR's URL in a new tab via `window.open`. The
  listener gates on input/textarea/select
  focus, modifier keys (so Ctrl+J still
  works), and the presence of
  `.sync-panel__prs` in the DOM so it doesn't
  fire on tabs that don't mount the panel.
  Honors the active filter + search so
  navigation walks only the visible PRs, not
  the underlying set. When the commit-list
  has a focused row, the PR listener defers —
  user is likely scanning commits, not PRs.
  Focused PR gets a left-edge accent rail +
  soft bg shift (padding compensated to
  avoid content jump) mirroring the commit-
  list focus treatment. Header carries a
  `<kbd>j</kbd><kbd>k</kbd> nav · <kbd>↵</kbd>
  open` hint, same family as the commits one.
  Focus drops cleanly when the focused PR
  falls out of the visible set (filter/search
  change or status refresh).

### Library hover-preview image thumbnail
- ✓ Image-typed artifacts (the existing
  `type === 'image'` discriminator) now render
  an actual `<img>` thumbnail inside the
  hover popover instead of falling through to
  the binary-skipped placeholder. Source is
  the standard `/api/artifacts/<key>` endpoint
  with `loading="lazy"` so hover-spawning a
  tile-grid full of images doesn't burn
  bandwidth on previews the user might never
  hover. Caps at 140px height with
  `object-fit: contain` so portrait + landscape
  ratios both render predictably. A soft
  checkerboard background renders behind the
  image for transparent PNGs so the popover
  surface doesn't bleed through. Decode-error
  handler hides the broken image and lets the
  rest of the popover (metadata, tags, key)
  continue to render. Stubs and non-image
  types fall through to the existing snippet
  / binary-placeholder paths unchanged.

### Audit row inline copy-payload
- ✓ Tree-mode payloads now carry a hover-
  revealed ⧉ Copy button anchored to the top-
  right of the JSON tree (raw mode already
  has its own built-in copy button). Click
  serializes the payload via the same
  BigInt/Symbol-safe `JSON.stringify` walk the
  raw view uses, drops it on the clipboard,
  and toasts confirmation. The button is
  opacity-0 at rest + revealed on
  `.audit__payload-wrap:hover` so the
  expand/collapse glyphs stay the dominant
  visual at scan time. Focus-visible
  reveals too so keyboard users can land on
  it via Tab without a mouse. Soft accent
  border + color on hover/focus matches the
  payload-raw-copy sibling for cross-mode
  consistency.

### Cloudflare token last-validated chip
- ✓ Successful token validations now persist
  to localStorage as `{at, status}` —
  rehydrates on every Cloudflare tab mount
  and renders an inline chip below the API
  Token field: "✓ Last validated 5min ago ·
  status: active". Relative time (just now /
  Xm ago / Xh ago / Xd ago) keeps the chip
  compact; the absolute timestamp lives in
  the title attribute for users who need
  precision. Stale state (>7 days since the
  last successful check) flips the chip to a
  soft-amber tint with a ◐ glyph + "consider
  re-checking" suffix — encourages periodic
  re-validation since Cloudflare can revoke
  tokens silently. Failed validations don't
  clear the previous good timestamp on
  purpose: the user still wants to know when
  the token last looked OK, even if right
  now it doesn't. Quota-safe write (catch
  around localStorage.setItem) so a full
  storage doesn't crash the validate flow.

### Library code snippet syntax highlighting
- ✓ Code-typed artifacts now render their hover-
  popover snippet through a tiny single-pass
  tokenizer (`highlightCodeSnippet`) instead of
  a flat `<pre>`. Coarse classification —
  strings (single/double/backtick with escape
  handling), comments (// or # depending on
  the file extension), numbers, keywords, plain
  — produces enough visual cue to spot
  structure without dragging in an external
  highlighting lib. Keyword set is a curated
  union across JS/TS/Py/Go/Rust/Java/Ruby
  common tokens; languages aren't
  individually detected, just the comment
  syntax via extension sniff. Token classes
  (`.library__code-kw/str/comment/num`) are
  intentionally subtle — the snippet is
  preview chrome, not an editor, so they
  shouldn't scream. Non-code artifacts skip
  the tokenizer and render the existing plain
  `<pre>` path unchanged.

### Audit envelope export (Shift+click)
- ✓ Both the tree-mode and raw-mode payload
  Copy buttons now treat a plain click as the
  payload-only copy (existing behavior) and a
  Shift+click as a full-envelope export. The
  envelope wraps the payload with id, kind,
  createdAt (epoch + ISO), agentId, and the
  payload itself — a self-contained record
  the user can paste into a bug report
  without having to chase down the metadata
  separately. BigInt/Symbol-safe stringify
  pass on both branches so weird payload
  shapes don't crash. PayloadRaw gained an
  optional `entry` prop so the raw view's
  built-in copy button supports the same
  envelope shortcut; the prop is optional so
  the component stays reusable in other
  contexts. Title attributes + toast strings
  spell out the shortcut so the affordance is
  discoverable without rummaging through
  docs.

### Sync PR bulk-merge selected
- ✓ Ready PRs now carry a checkbox-style
  select toggle on the left edge of each row.
  When ≥2 are selected, a bulk-merge action
  bar pops in above the PR list with a "Squash
  + merge N ↩" button and a Clear. Non-ready
  PRs render a dashed placeholder square so
  the row grid stays aligned without
  surfacing a no-op toggle. Selection is
  validated on submit: any selected PRs that
  have flipped out of the ready state (status
  refresh just merged one, reviewer was
  added, etc.) get filtered out, and the
  bar's count + action text reflect what
  would actually fire. The merge loop walks
  the PRs serially (GitHub's merge API
  serializes per-repo anyway) with optimistic
  local state flips; per-PR errors land in
  the existing `mergeError` map so the row's
  inline error chip surfaces them. End-of-
  batch toast: `Bulk merge: N merged · M
  failed`. A final `refresh()` pulls the
  canonical status — reviewer auto-requests +
  upstream-behind count update automatically.

### Library hover image dimensions
- ✓ Image-typed artifacts now report their
  natural W × H + an aspect-ratio descriptor
  inside the hover popover's meta dl, captured
  on the `<img>` onLoad. Ratio classification
  picks human labels for the canonical
  cinematographer ratios (square / 16:9 / 4:3
  / 3:2 / 21:9) within 5% tolerance; anything
  else falls through to "portrait" or
  "landscape". Per-artifact cache via
  `imageDimsRef` so a re-hover reads
  synchronously; a small bump-state forces
  the popover to re-render once the
  dimensions land. Skips EXIF — out of scope
  without a byte-parser; the natural-size +
  ratio cover the "what does this look like?"
  question most users actually have.

### Audit row pair-compare modal
- ✓ Each expanded audit row's action cluster
  now carries a `↔ compare` / `↔ marked`
  toggle. The marked-for-compare set is
  capped at 2 — marking a third drops the
  oldest, so the user can keep moving the
  comparison without an explicit clear step.
  When at least one row is marked a floating
  bar appears above the list with the count,
  the marked chips (click any to drop just
  that one), and a Clear. When both slots
  fill the bar grows a "Compare ↔" button
  that opens a side-by-side modal: two
  pretty-printed JSON pres, each line tinted
  green (right side) or red (left side) when
  it isn't present in the other column.
  Same BigInt/Symbol-safe stringify the copy
  buttons use. Esc / backdrop click / × close.
  On ≤720px the two columns stack so phone
  users can still scan the diff vertically.

### Sync PR bulk-merge progress bar
- ✓ The bulk-merge action bar now shows a live
  progress readout while the serial merge
  loop walks the selection — text flips from
  `N selected for bulk merge` to
  `Merging 2/5 · #421 · 1 failed` as the
  iteration advances, and a horizontal
  progress bar fills 0→100% in lockstep.
  Mid-batch failures tint the fill to a
  warning gradient so the user notices
  without waiting for the end-of-batch
  toast. The final progress frame holds at
  100% for ~800ms so the user sees the
  completed state before the bar collapses
  out of view. Progress state is keyed
  separately from the busy flag so the
  visual stays accurate even when the loop
  is partway through a slow GitHub merge
  API call.

### Audit compare divergence hint
- ✓ The side-by-side compare modal now opens
  with a tone-tinted hint banner above the
  columns calibrating how much the two
  payloads actually share. Computes the
  ratio of unmatched lines across both
  sides; bins to ok (≤25% divergent · ✓
  green · "minor variations"), warn (≤50% ·
  ◐ amber · "structurally similar but
  meaningfully different"), and high (>50% ·
  ⚠ red · "varying call-to-call" when same
  kind, or "different kinds rarely share
  structure" when not). Identical payloads
  get a special "Identical — nothing to diff"
  ok-toned line so the user knows the empty
  middle column isn't a render bug. Helps
  the user calibrate before reading the
  diff columns whether they're looking at
  "two flavors of the same event" or "wholly
  different histories".

### Library hover popover workspace label
- ✓ The hover popover meta dl now surfaces
  the owning workspace when the R2 key
  matches the canonical
  `artifacts/<agentId>/<filename>` shape.
  Renders as a small monospace code pill
  ("Workspace: <code>copper-onion</code>")
  giving useful provenance when the user is
  browsing across workspaces or wonders
  which agent dropped a particular file.
  Closest signal we have to "last-modified
  by" without an explicit author field —
  R2's customMetadata stays unchanged. Falls
  through silently when the key doesn't
  match (stubs, manual uploads with
  non-canonical keys).

### Sync PR row shift-click copy URL
- ✓ Shift+clicking any empty space in a PR
  row now copies that PR's GitHub URL to
  the clipboard. The handler probes the
  click target's nearest interactive
  ancestor (a/button/input/select/textarea
  or `[role="button"]`) and bails if any
  matches — so shift+click on the existing
  Merge / Mark-ready / select-toggle
  buttons (or on the PR # link itself)
  still fires their primary handlers
  unchanged. Plain click on the # link or
  title still opens the PR via the
  anchor's default behavior; this just
  gives keyboard-light users a one-gesture
  copy-URL path without right-click→copy.
  Row title attribute spells out the
  shortcut so the affordance is
  discoverable.

### Audit compare-pair envelope export
- ✓ The side-by-side compare modal header
  now carries a `⧉ Copy pair` button beside
  the × close. Click bundles both rows into
  a single JSON envelope keyed
  `audit-compare@1` with `exportedAt`,
  `divergencePct`, and `left` + `right`
  sub-objects (each carrying id, kind,
  createdAt epoch+ISO, agentId, and the
  full payload). Same BigInt/Symbol-safe
  stringify the per-row copy buttons use.
  Toast confirms. Reads as a "drop this in
  a bug report" affordance — the user
  doesn't have to copy both payloads
  separately + manually pair them up.

### Library hover popover Esc + Tab navigation
- ✓ Esc anywhere closes the hover popover
  (skipping text inputs / `[role="dialog"]`
  contexts so it doesn't steal Esc from
  the artifact preview modal). Tab on the
  popover's source tile now redirects
  focus into the popover's first
  focusable child instead of walking to
  the next tile. The popover gained a
  small `⧉ Copy key` button next to the
  R2 key pill — gives Tab a concrete
  landing target + lets keyboard users
  grab the key with one keystroke instead
  of selecting text by hand. Listener
  scope is gated on the popover being
  open + the tile being the source of
  the active popover, so Tab from
  unrelated tiles continues to walk the
  grid naturally.

### Sync PR merge-method picker
- ✓ The PR controls row now carries a
  `merge as: squash | merge commit | rebase`
  dropdown that persists to localStorage
  (`openthink:sync-merge-method`,
  defaulting to squash). The selected
  method propagates to: the single-row
  Merge button's label ("Merge ↩" /
  "Rebase ↩" / "Merge commit ↩"), the
  single-row merge confirm dialog
  ("Squash + merge PR #421?"), the bulk-
  merge action button + its confirm
  prompt, and the actual API request body
  (`mergeMethod` field on each
  `PUT /api/sync/pulls/:n/merge`). A
  shared `mergeVerb` helper renders the
  human label everywhere so updates stay
  consistent. Default squash is right for
  agent-authored single-purpose patches;
  teams with linear-history or merge-
  commit conventions flip once and never
  touch it again.

### Library popover tag-as-button filtering
- ✓ Tags rendered in the hover popover are
  now real `<button>` elements that toggle
  the global `activeTagFilter` set when
  clicked. Active tags pick up an accent
  fill so the user can see at a glance
  which filters are already on. Clicking
  closes the popover since the filter
  change is the meaningful effect — staying
  hovered over a now-filtered grid feels
  weird. Pairs with the existing
  Tab-into-popover keyboard nav so a user
  can hover, Tab, then Tab-Tab through the
  tag buttons to filter without ever
  touching the mouse. Hover/focus
  treatments mirror the rest of the chip
  family for visual coherence.

### Audit compare modal arrow-key navigation
- ✓ When the compare modal is open and the
  pair is filled, ←/→ walks the RIGHT side
  through adjacent rows in the visible
  entries list (left stays as the
  baseline). Shift+←/→ walks the LEFT side
  instead so the user can scan from either
  end. Wraps at both ends; auto-hops one
  more step in the same direction if the
  candidate would collide with the other
  slot (prevents `left === right` deadlock).
  Header tacks on a `<kbd>←</kbd><kbd>→</kbd>
  shift right · <kbd>⇧</kbd>+arrow shifts
  left` hint (hidden on ≤720px since touch
  users don't benefit). Listener gates on
  the modal being open + a filled pair +
  no text-input focus so the keys don't
  hijack any future modal-internal input.

### Sync PR row inline diff preview
- ✓ Open-state PR rows now carry a
  `Preview ▾` / `Hide diff ▴` toggle pill
  beside the merge actions. New backend
  endpoint
  `GET /api/sync/pulls/:number/diff`
  fetches the PR's diff via GitHub's
  `application/vnd.github.diff` Accept
  header (same pattern as the existing
  per-commit diff route). Frontend uses
  the existing `CommitDiffBody` renderer
  — same file-level collapse-by-default
  grouping with the parseDiff helper —
  so the visual vocabulary stays
  consistent between commits and PRs. Per-
  PR cache keyed by number so toggle-
  collapse-reopen doesn't refetch; soft
  error chip with a Retry that re-fires
  the load. Stub-success when
  `GITHUB_TOKEN` is unset so dev sees the
  shape. Diff body spans the full PR row
  width (flex-wrap row layout), nests
  visually under the row via 24px left
  indent + a top dashed separator.
  Closed/merged PRs don't get the toggle
  — their diff would be stale and the
  user would be looking at the wrong
  artifact for the question they're
  asking.

### Library hover Cmd+Enter to open
- ✓ The hover popover now responds to
  Cmd/Ctrl+Enter (Cmd on Mac, Ctrl
  elsewhere) by opening the source
  artifact in the standard preview pane —
  closing the popover first so the
  transition reads clean. Stub rows
  route through `onOpen` instead of
  `setViewing` to match the tile-click
  behavior. A new small `<kbd>` hint row
  at the bottom of the popover spells out
  the shortcut alongside Esc-to-close so
  users discover both without rummaging
  through docs. Listener already lives in
  the popover's keydown effect from the
  earlier Esc + Tab work — Cmd+Enter is
  just one more branch in the same
  handler, gated on the popover being
  open + a non-input focus context.

### Audit compare chip jump-to-row
- ✓ The compare-pair chip used to be a
  single button that removed the entry
  on click; now it's a two-button pair
  inside a unified pill outline. The
  label button scrolls the audit list to
  that row, auto-expands it (matching the
  `?id=` deep-link behavior), and flashes
  the highlight ring for 1.6s — same
  treatment the existing deep-link
  surface uses. The × button drops the
  entry from the pair. The two gestures
  no longer collide: users can navigate
  back to a marked row without
  accidentally losing the pair. Hover/
  focus tint surfaces on both buttons
  independently so the click affordance
  is clear; × picks up a red tint when
  active to signal the destructive
  intent.

### Sync PR preview pill diff stats
- ✓ Once a PR's diff has loaded into the
  cache, the Preview pill renders an
  inline `+N −M` chip via parseDiff so
  the user can size up the change at a
  glance without expanding. Stats compute
  on every render but only when the diff
  is already cached — no extra fetch, no
  memo plumbing (parseDiff is O(lines)
  on the already-loaded blob). Hidden
  while loading + on rows whose Preview
  hasn't been clicked yet. Title attr
  on the pill also extends with a
  detailed `· N files · +X −Y` summary
  once stats are available so a hover
  reads the full picture. Mirrors the
  shape of `.sync-file__add` / `__del`
  used in the dry-run diff so the
  color language stays consistent across
  the panel.

### Audit multi-kind filter summary chip
- ✓ When the user has ≥2 kinds selected in
  the audit kind toolbar, an inline
  "Filtered by N kinds: <code>tool_call,
  danger</code>" status chip renders above
  the chip row. Single-kind selections
  stay implicit (the active chip's accent
  fill already telegraphs it). Kinds list
  is alpha-sorted + comma-joined inside a
  code pill so the active set reads as
  one cohesive label. A right-aligned
  `clear` link clears the kind filter
  entirely. Same soft-accent palette as
  the existing compare-bar so the two
  status surfaces feel like a family.

### Library popover Cmd+C copies title
- ✓ When the popover is open and the
  cursor focus is inside it (or on the
  source tile), Cmd/Ctrl+C copies the
  artifact's title to the clipboard —
  but only when there's no active text
  selection. If the user has selected
  something inside the popover, the
  browser's native copy handler wins
  (that's what they expect). Toast
  confirms with a truncated preview
  (`Copied "Pitch deck — v3"`). The
  popover's <kbd> hint row extends to
  surface this alongside the existing
  Cmd+Enter / Esc shortcuts so the
  affordance is discoverable. Listener
  branch sits in the same keydown
  effect as the other shortcuts; the
  selection check + focus-context
  guard prevent it from hijacking
  normal copy-paste anywhere else in
  the app.

### Sync PR Preview pill file-count chip
- ✓ The Preview pill's stats trio now
  includes a `Nf` file-count chip
  alongside the existing `+M / −K` line-
  count chips, drawn from the cached
  parseDiff. Renders with a muted color
  so files reads as secondary context to
  the loud green/red of line counts.
  Tabular-num + monospace so a row's
  three numbers don't wobble when the
  diff is fetched. Stat trio still gated
  on the diff being already cached — no
  extra fetch.

### Audit kind-summary expand popover
- ✓ `apps/platform/src/web/screens/Settings.tsx`
  — the "Filtered by N kinds" status chip
  (only renders once ≥2 kinds are active)
  now wraps a real `<button>` toggle that
  expands into an inline per-kind
  breakdown. Each row carries the kind
  label, a percentage-of-active bar, an
  exact count (locale-formatted), a `%`
  reading, and a one-click `✕` to drop
  that kind from the filter without
  collapsing the popover. Footer chimes
  in with the summed total so the user
  knows what the visible window adds up
  to. State auto-collapses if the filter
  set drops back below two kinds — no
  orphaned popover floating without a
  chip to anchor it. The toggle button is
  fully keyboard-reachable
  (`aria-expanded` + `aria-controls`) and
  the caret flips ▸/▾ to match. Source of
  truth is the same `kindCounts` map
  already feeding the per-chip badges, so
  the popover numbers can never disagree
  with what the user sees when toggling
  individual chips.
- ✓ `apps/platform/src/web/screens/Settings.css`
  — companion styles for the expand
  button (no native chrome, focus-visible
  outline), caret glyph (accent on
  hover/expanded), popover surface
  (`var(--ot-bg-card)` + soft border with
  140ms fade-in), per-row grid
  (`110px / 80-2fr / auto / auto`),
  accent-fill bar with 220ms width
  transition, danger-tinted hover on the
  drop button, dashed-rule footer. Mobile
  breakpoint at 720px reflows the row to
  a 2-line stack (label + count + drop on
  top, full-width bar below) so the
  bar stays readable on narrow screens.

### Library popover Cmd+Shift+C copies R2 key
- ✓ `apps/platform/src/web/screens/Library.tsx`
  — added a deeper variant alongside the
  existing Cmd+C title-copy. Cmd/Ctrl+Shift+C
  now grabs the artifact's R2 key while
  the hover preview popover is open
  (focus must be inside the popover or on
  the source tile; an active text
  selection still defers to the browser's
  native copy). Stubs — which don't have
  a real R2 object yet — get an
  explanatory toast instead of silently
  failing. Toast confirmation truncates
  long keys to the trailing 36 chars with
  a leading ellipsis so the user can
  recognize what landed without the
  toast turning into a wall of text. The
  popover's footer hint line picks up
  `⌘ ⇧ C key` between the existing title
  and `esc` markers so the shortcut is
  discoverable, not folklore.

### Sync PR Preview loading spinner
- ✓ `apps/platform/src/web/screens/SyncPanel.tsx`
  — the per-PR `Preview ▾` pill now
  surfaces a spinning glyph + `Loading…`
  text while the GitHub diff fetch is in
  flight. We only paint the spinner on
  the very first fetch (cached re-toggles
  stay instant), so the indicator is an
  honest signal that something is
  actually round-tripping — not a
  flicker on every collapse. `aria-busy`
  + `disabled` on the button block
  duplicate-click queueing, and the title
  attribute swaps to "Fetching the diff
  from GitHub…" so screen readers and
  hover tooltips agree.
- ✓ `apps/platform/src/web/screens/SyncPanel.css`
  — companion `.sync-pr__preview--loading`
  + `.sync-pr__preview-spinner` styles.
  Loading pill warms to a 6%-accent fill
  with a 50%-accent border so it reads
  as "busy on this row" without a layout
  shift; cursor flips to `progress`.
  Spinner is a 10×10 ring with a
  30%-accent rest border and a solid
  accent top, rotating at 700ms linear
  infinite. `prefers-reduced-motion`
  slows it to 1800ms so motion-sensitive
  users still get a signal without the
  pulse. Margin nudges the spinner left
  of the label so the pill's overall
  width stays roughly stable across the
  loading → loaded transition.

### Esc collapses kind-summary popover
- ✓ `apps/platform/src/web/screens/Settings.tsx`
  — added an Esc-listener bound only
  while the popover is open. Honors the
  same "don't interfere with typing
  surfaces" rule used everywhere else on
  this screen: if the user is in an
  `<input>` / `<textarea>` / `<select>` /
  contentEditable when Esc fires, the
  handler bails so Esc still clears that
  field. Title hint on the expand-toggle
  now reads "(Esc)" so the shortcut is
  documented without a separate help
  popover. Pairs naturally with the
  click-to-toggle behaviour from tick 43
  — keyboard users get a parity
  collapse path that doesn't require a
  trip back to the chip.

### Library tile Cmd+Shift+Click copies R2 key
- ✓ `apps/platform/src/web/screens/Library.tsx`
  — Cmd/Ctrl+Shift+Click on any
  Library tile now copies its R2 key
  directly, parity with the
  Cmd+Shift+C shortcut that already
  worked from the hover popover. The
  chord intercepts at the very top of
  the tile click handler so it doesn't
  fight selectMode (no accidental
  range-toggle) or the open/setViewing
  branch (no surprise preview pane).
  Stub rows still fall through to the
  "no R2 key yet" toast. Truncates long
  keys in the toast to trailing 36 chars
  with a leading ellipsis so the
  confirmation stays scannable. Lets
  power users grab keys for wrangler
  scripts / debugging / sharing without
  having to hover into the popover
  first.

### Sync PR stale badge
- ✓ `apps/platform/src/worker/routes/sync.ts`
  — extended the open-PRs fetch to
  capture `base.sha` from GitHub's list
  endpoint (already in the payload, so
  zero extra round-trips). Per-PR
  `staleBehind` boolean compares full
  base.sha against the upstream HEAD —
  truthy when main has moved forward
  since the PR was last synced. Undefined
  when we can't determine (missing
  base.sha) so the UI can render
  "unknown" rather than a wrong negative.
  `SyncStatus` interface gains the new
  field; the client-side mirror picks it
  up via the same name. Cache TTL is
  unchanged (60s in-memory + 5min KV);
  stale signal refreshes naturally with
  the rest of the panel.
- ✓ `apps/platform/src/web/screens/SyncPanel.tsx`
  — renders a `↺ stale` pill beside the
  open-state pill on any PR with
  `staleBehind`. Tooltip explains the
  "needs a rebase before merging
  cleanly" rationale so users know what
  the badge is asking them to do. Sits
  next to (not replacing) the state pill
  so the row reads as a single phrase:
  "open, stale."
- ✓ `apps/platform/src/web/screens/SyncPanel.css`
  — companion `.sync-pr__stale` styles.
  Warning amber (`#8a5c1a` on a
  12%-amber fill, 40%-amber border) —
  not danger red, since the PR is
  mergeable in principle, just behind.
  4-second box-shadow pulse catches the
  eye without nagging; honors
  `prefers-reduced-motion`. ↺ glyph
  reads as "needs re-alignment" without
  prescribing rebase vs merge-from-main
  (the user's call). Tabular monospace
  matches the existing state pill's
  letterspacing so the two pills hang
  together as a single visual unit.

### Library tile chord discoverability
- ✓ `apps/platform/src/web/screens/Library.tsx`
  — added a context-aware `title`
  attribute on every Library tile. The
  hint reads
  "`<row title> · ⌘/Ctrl+Shift+Click
  copies R2 key`" on real artifacts so
  the chord we wired in tick 44 is
  actually discoverable from the grid
  (until now only the hover-popover
  hint mentioned it). Stubs fall back
  to just the row title (no key
  available). Select-mode swaps the
  hint to
  "`Shift+click to range-select`"
  since Shift is overloaded for
  Finder-style range selection in
  that mode — telling the user about
  the wrong chord would be worse than
  saying nothing. Tooltip-only, no
  CSS or layout change, so it can
  never make the grid feel busier.

### Bulk-merge skips stale PRs
- ✓ `apps/platform/src/web/screens/SyncPanel.tsx`
  — the bulk-merge action bar now
  detects PRs flagged `staleBehind`
  inside the selection and filters
  them out of the merge POST burst.
  Counter chip switches from
  "`5 selected for bulk merge`" to
  "`5 selected · 2 stale will be
  skipped`" the moment any stale PR
  is in the set, so the user knows
  what to expect before clicking the
  button. The button label tracks the
  mergeable subset
  (e.g. "`Squash 3 ↩`" not "`Squash
  5 ↩`") so the count matches reality.
  On click: if at least one PR is
  mergeable, we surface an info-toast
  listing the skipped numbers
  (capped at 5 + "+N more" overflow)
  and proceed with the filtered list.
  If everything is stale, we bail
  loudly with an err-toast and don't
  fire an empty request that would
  silently no-op. Button is
  `disabled` when the mergeable
  count is zero, with the same
  reasoning surfaced in its `title`.

### Kind-summary rows accept Del/Backspace
- ✓ `apps/platform/src/web/screens/Settings.tsx`
  — the per-row ✕ drop button on the
  audit kind-summary popover now
  treats Delete and Backspace as
  click-equivalent shortcuts. Tab
  through the rows, hit Del →
  current row drops; focus advances
  to the next row's drop button so
  repeated Del presses keep walking
  the list. Falls back to the
  previous sibling when you drop
  the last row, so focus never
  ends up orphaned on a detached
  node. Refocus is deferred via
  `requestAnimationFrame` so React's
  rerender has settled before the
  query runs. Title attribute on
  the button picks up
  "(Del/Backspace)" so the shortcut
  is documented in-UI. Enter/Space
  are unchanged — the browser already
  treats them as button activations,
  so we don't need to handle them
  ourselves.

### SyncPanel m-key merges focused PR
- ✓ `apps/platform/src/web/screens/SyncPanel.tsx`
  — pressing `m` while a PR row is
  keyboard-focused now fires the
  inline merge, parity with j/k
  (navigate), Enter (open on GitHub),
  and the existing `r` mark-ready
  chord. The shortcut re-derives the
  PR's state from current `status`
  (not a stale closure on the row
  that was focused N renders ago)
  and gates merge through five
  cause-specific bailout toasts:
  "no longer in list", "is closed",
  "is a draft", "has reviews
  pending", and "is stale". Stale
  PRs route to a dedicated message
  ("rebase before merging") so the
  user knows what to do next.
  `handleMergePr` owns its own
  confirm() prompt, so we don't
  double-confirm via the chord. The
  effect's deps grew to include
  `mergingPr` so the in-flight gate
  reads the current value instead of
  a stale closure — without that, two
  quick `m` presses could fire a
  duplicate merge.

### Library popover ext+size chip
- ✓ `apps/platform/src/web/screens/Library.tsx`
  — the hover-preview footer now
  carries a compact
  `<code>` chip between the Copy-key
  button and the R2-key chip,
  surfacing the file extension + a
  human-readable size (e.g.
  ".png · 124.3 KB"). Extension is
  parsed from the R2 key's trailing
  `\.([A-Za-z0-9]{1,8})$` segment;
  falls back to the row's `type`
  label when there's no recognizable
  extension. Stubs (size === 0)
  render just the extension, with a
  "(stub — not yet on R2)" tooltip
  so the user knows why the size is
  missing. Reuses the existing
  `formatBytes` helper so the size
  formatting matches the canvas
  meta-row everywhere else in the
  app.
- ✓ `apps/platform/src/web/screens/Library.css`
  — companion `.library__hover-
  preview-meta` styles. Solid border
  (vs the R2 key's dashed border) so
  the eye reads it as a distinct
  facet of the same metadata strip.
  `flex: 0 0 auto` keeps the chip
  fixed-width while the wrappable key
  chip absorbs any extra row width.
  Tabular-num so two-digit + decimal
  sizes line up cleanly.

### Audit jump-to-cluster count badge
- ✓ `apps/platform/src/web/screens/Settings.tsx`
  — added a useMemo over `entries`
  that pre-tallies cluster sizes by
  destination (thread:<id>,
  tool:<name>, kind:sync,
  kind:skill_save). Each jump link
  now reads its size in O(1) from
  this map instead of walking
  entries per render → cuts the
  per-row jumps lambda from O(N²) to
  O(N) total. When a cluster has ≥2
  rows, the link grows a quiet
  count badge ("→ open in chat 5")
  so the user can see how many
  siblings will land at the
  destination before clicking. Title
  attribute also surfaces the count
  ("5 audit rows share it") for
  screen-reader users. Single-row
  clusters render the link as-is —
  no badge, no clutter.
- ✓ `apps/platform/src/web/screens/Settings.css`
  — companion `.audit__entry-jump-
  count` styles. Pill-shaped, sized
  to the link's letter height so it
  reads as a quiet superscript, not
  a competing UI element. Accent-
  tinted (16%-fill on a 30%-border)
  with a hover-state lift to 26%-
  fill so the chip tracks the
  link's hover. Tabular-num so
  multi-digit counts align cleanly
  when a single row carries two
  destinations.

### SyncPanel ? help overlay
- ✓ `apps/platform/src/web/screens/SyncPanel.tsx`
  — `?` (Shift+/) anywhere on the Sync
  panel now opens a modal-style
  overlay listing every chord
  shortcut (j/k nav, Enter open, m
  merge, r mark-ready, ? toggle, esc
  close). Special-cased before the
  input/dialog gates so the help is
  reachable even when the user is
  confused about why other shortcuts
  aren't firing. Esc dismisses,
  click on the backdrop dismisses,
  click on the card preserves
  selection/scroll. `role="dialog"`
  + `aria-modal` + an explicit
  Close ✕ button so the overlay is
  screen-reader-correct. The PRs-
  head hint strip picks up an inline
  "`?` more" launcher that's
  click-equivalent — discoverable
  without having to know the chord
  exists. `showShortcutsHelp` is in
  the keydown effect's deps so the
  toggle action is a single
  listener, not a separate effect.
- ✓ `apps/platform/src/web/screens/SyncPanel.css`
  — companion overlay styles.
  Backdrop is a 22%-ink scrim so the
  PR list dims to "background." Card
  is centered with a 460px max-
  width, soft shadow, and a
  staggered 160ms fade-in + 180ms
  pop animation (skipped under
  `prefers-reduced-motion`).
  `<kbd>` glyphs share the existing
  body-font monospace + 1px rule so
  the overlay reads as native to
  the rest of the app, not a
  bolted-on modal. Dashed top + bottom
  rules on the dl frame the shortcut
  list as a discrete reference card.
  Sub-480px breakpoint collapses the
  two-column grid so the dt/dd pairs
  read top-to-bottom on mobile.

### Library context menu Copy ext+size
- ✓ `apps/platform/src/web/screens/Library.tsx`
  — the tile right-click context
  menu gains a "Copy ext+size" entry
  between Copy R2 key and Duplicate.
  Reuses the same ext-parsing logic
  the hover popover chip uses, so
  the menu entry copies the
  identical string the user already
  saw on hover ("`.png · 124.3 KB`"
  in the regular case, just the ext
  on stubs). Trailing chip on the
  menu row shows the exact string
  that'll land on the clipboard —
  no need to click and then double-
  check. Toast confirms with the
  copied value quoted in full so
  the user has a fast sanity check.
- ✓ `apps/platform/src/web/screens/Library.css`
  — added `.library__ctxmenu-
  shortcut` styles for the trailing
  preview chip. Margin-left:auto
  pushes it flush with the menu's
  trailing edge, monospace +
  tabular-num lines sizes up
  across sibling entries, muted ink
  color so the chip reads as
  metadata (not a competing
  affordance).

### Kind-summary row label click filters
- ✓ `apps/platform/src/web/screens/Settings.tsx`
  — the per-kind row's label span
  is now a real `<button>`: a single
  click drills the audit filter
  down to just that kind, dropping
  every sibling kind from the
  active set. Faster than tab-then-
  ✕ through every sibling, and
  matches the per-chip toolbar's
  "click a single chip → filter to
  just it" pattern. Tooltip
  surfaces the destination row
  count + how many siblings will be
  dropped ("Drill down to 1,247
  spend rows — drops the other 3
  kinds from the filter"). Popover
  auto-collapses via the existing
  size-1-collapse effect — no new
  cleanup path.
- ✓ `apps/platform/src/web/screens/Settings.css`
  — `.audit__kind-summary-row-
  label--button` variant strips the
  native button chrome and adds an
  8%-accent hover/focus tint with a
  -6px negative margin so the
  clickable region extends past the
  text's visual edge (Fitts's law).
  Color flips to accent on hover so
  the user knows it's interactive
  before they commit the click.

### Bulk-merge chord + help overlay row
- ✓ `apps/platform/src/web/screens/SyncPanel.tsx`
  — added a `space` chord that
  toggles the focused PR in/out of
  the bulk-merge selection. Same
  ready-state gating as the `m`
  chord — drafts, pending-review,
  and stale PRs surface their
  cause-specific bailout toast
  instead of accumulating into a
  selection the bulk action would
  then drop. The `?` help overlay
  gains a dedicated row explaining
  the space chord + the equivalent
  click on the row's ☐ checkbox, so
  users discovering the panel learn
  the bulk-merge flow without
  having to find the action bar
  (which only pops when ≥2 are
  selected — until you know about
  it, the affordance is invisible).
  Combined with the existing
  click-on-checkbox path this gives
  three discoverable ways to build
  a bulk selection: ☐ click, space
  chord, or read the help and pick.

### Tile thumbnail file-extension badge
- ✓ `apps/platform/src/web/screens/Library.tsx`
  — non-image tiles now carry a
  small uppercase ext badge in the
  thumbnail's bottom-right corner
  (`JSON`, `PDF`, `CSV`, `MD`, ...).
  Surfaced from the R2 key's
  trailing `\.([A-Za-z0-9]{1,8})$`
  segment so the badge is precise
  — the type-glyph alone tells you
  "this is code-ish" but not which
  flavor. Image tiles render the
  actual image (no need for a
  badge), and stubs skip the badge
  entirely (no R2 object yet, so
  any ext would be a lie).
- ✓ `apps/platform/src/web/screens/Library.css`
  — companion `.library__tile-ext`
  styles. Absolute-positioned bottom-
  right with 6px insets so it
  doesn't visually fight the
  starred-corner glyph (which lives
  top-right). Monospace + uppercase
  + 0.06em letterspacing so it
  reads as a "tag" not a word.
  Backdrop-blur(2px) + 84%-card
  background so the badge stays
  readable over a busy glyph;
  pointer-events:none so it doesn't
  intercept the tile's click
  surface. `max-width: calc(100% -
  12px)` + ellipsis so a
  hypothetical 8-char extension
  doesn't overflow the tile.

### Kind-summary drill-down scrolls feed
- ✓ `apps/platform/src/web/screens/Settings.tsx`
  — clicking a kind-summary row
  label now also scrolls the audit
  list back to the top after the
  filter changes. Without this,
  drilling from the bottom of a
  long popover left the freshly-
  filtered results out of view —
  the user would have to scroll
  back up to see what they just
  asked for. Uses
  `requestAnimationFrame` to defer
  the scroll until the popover's
  collapse animation has started,
  so the audit list is in its post-
  collapse position when we
  measure. `behavior: 'smooth'` so
  the page transition reads as
  intentional, not a jolt. Tooltip
  on the label picks up
  "(scrolls feed to top)" so the
  side effect is documented in-UI.

### SyncPanel c-key copies PR URL
- ✓ `apps/platform/src/web/screens/SyncPanel.tsx`
  — pressing `c` on a focused PR
  row now copies the PR's GitHub
  URL to the clipboard, parity
  with the existing Shift+click
  mouse chord on the title.
  Reaches into the rendered DOM
  for the anchor's href instead of
  re-deriving from status, so a
  stale focusedPrNumber across a
  status refetch can't copy the
  wrong PR's URL. Toast confirms
  with the PR number ("Copied PR
  #1234 URL"). The `?` help
  overlay gains a row documenting
  the chord + its mouse-equivalent.

### Library context menu keyboard nav
- ✓ `apps/platform/src/web/screens/Library.tsx`
  — the right-click context menu
  now auto-focuses its first item
  on open (via rAF so React has
  rendered the menu DOM before
  the focus call), and binds
  Arrow Up/Down for forward/back
  cycling with wraparound,
  Home/End to jump to the
  extremes. Enter/Space activate
  the focused item via native
  button behavior — no extra
  handling needed. Esc still
  closes the menu (this was the
  originally-announced item, but
  the path already existed; we
  picked up the higher-value
  keyboard-nav upgrade instead).
  Combined with the existing Esc
  exit and outside-click dismiss,
  the menu is now fully usable
  from the keyboard.

### Kind-summary total row clears filter
- ✓ `apps/platform/src/web/screens/Settings.tsx`
  — the popover's "Total: N rows"
  footer is now a real `<button>`:
  a single click clears the kind
  filter entirely, parity with the
  `clear` link in the chip header
  but closer to the user's eye
  after they've finished reading
  the per-kind breakdown. Tooltip
  picks up the destination row
  count for context ("return to N
  rows across every kind"). Inline
  hint "· click to clear ↺"
  appears on the row body so the
  affordance is discoverable
  without a hover. The popover's
  size-1-collapse effect handles
  the dismiss naturally (filter
  drops to 0 kinds → chip vanishes
  → popover collapses).
- ✓ `apps/platform/src/web/screens/Settings.css`
  — companion `.audit__kind-
  summary-foot-clear` styles
  matching the per-row-label
  button pattern. Negative
  margin/padding pair extends the
  clickable region past the
  text's visual edge (Fitts's
  law); 8%-accent hover/focus
  tint with strong + hint color
  flips so the whole row reads as
  active. Hint chip
  (`.audit__kind-summary-foot-
  hint`) lifts from 70% to 100%
  opacity on hover so the user
  knows interaction is committed.

### Help overlay rhythm + ext tooltip + stale-first sort (final pre-handoff tick)
- ✓ `apps/platform/src/web/screens/SyncPanel.css`
  — tightened the `?` help overlay
  to absorb the new rows added in
  ticks 47–49 (Space, c, ?) without
  growing the modal height. Row
  gap goes 8px → 5px; the dt
  column shrinks 110px → 88px
  (still covers `space` at 62px
  with breathing room, frees ~22px
  per row for the dd description).
  Note line-height tightens to 1.35
  and the foot margin trims from
  10px → 8px. Net effect: 8 rows
  now fit roughly the same screen
  space the 5-row version used.
- ✓ `apps/platform/src/web/screens/Library.tsx`
  — the tile ext badge's title
  attribute now surfaces the
  human-readable size too
  (`.json · 124.3 KB` instead of
  just `.json`). Parity with the
  hover-preview footer chip — same
  string both places. Stubs still
  fall back to "(stub — not yet on
  R2)" since they have no size
  yet.
- ✓ `apps/platform/src/web/screens/SyncPanel.tsx`
  — added a "stale first" entry to
  the PR sort dropdown. Surfaces
  stale-base PRs at the top so the
  rebase queue is one click away
  on a busy panel. Three-tier
  comparator: stale-bucket first
  (open + staleBehind=true),
  state-order next (open > merged
  > closed), then newest-first
  inside each bucket — grouping
  stays stable across status
  refreshes that flip individual
  PRs' stale flag. localStorage
  persistence covers the new
  value so the chosen sort sticks
  across reloads. Type widened on
  the `prSort` state + the
  setPrSort cast in the dropdown
  onChange handler.

### Continuous deployment
- ✓ `.github/workflows/agent-deploy.yml` — every push to `main` in the
  user's fork: install → typecheck → build:web → apply D1 migrations → 
  wrangler deploy → bind any new secrets idempotently → smoke
  `/api/health` against the live worker → bump the
  `sync:local-sha` KV key to the deployed SHA so `/api/sync/status` reports
  "caught up". Cancels in-flight deploys for the same branch via
  `concurrency.group`.
- ✓ `.github/workflows/agent-update.yml` — daily at 09:00 UTC + manual
  `workflow_dispatch`. Adds the upstream remote (configurable via
  `vars.OPENTHINK_UPSTREAM_REPO`), fetches `main`, computes `behind`/`ahead`
  counts, and when there's drift creates `agent/upstream-sync-<run>` via a
  3-way merge (commits with `WIP:` prefix if conflicts surface) and opens a
  draft PR with the upstream commit list in the body. The user reviews,
  merges, and `agent-deploy.yml` ships the result.
- ✓ Live `Spending` tab fetches `/api/stripe/spend/<agent>` every 5s, renders
  the spent / cap progress bar, the reset countdown, and a per-tool table
  with `tool`/`spent`/`share` columns sourced from D1 audit_log aggregation
  (or the stub when D1 is empty).

### Verification
- ✓ 24/24 verify checks pass (22 HTTP + 2 WS) against `wrangler dev --local`
- ✓ `wrangler deploy --dry-run` resolves all bindings, bundle 418 KiB /
  87 KiB gzip
- ✓ Typecheck: web + worker projects both clean
- ✓ CI workflow runs on Node 22

## What's stubbed (functional shape, real implementation pending)

These have **shape-correct** endpoints, UI, and types so the rest of the
system can integrate against them, but the live integration is dry-run.

| Surface | Stub | Real impl needed |
|---|---|---|
| Researcher DO | **REAL + persists results** — fetches with SSRF guards, strips HTML, summarizes via Workers AI. Successful summaries are now written to R2 under `artifacts/<agent>/research/<callId>.md` with `customMetadata.{title, sourceUrl, turnId}` so the Library auto-shows them and the tool-call result chip surfaces a "Library → <filename>" link. | Swap fetch() for Browser Rendering on JS-heavy pages. |
| Coder DO | **REAL** — `review` does a real Workers AI code review (structured `{summary, issues[severity/line/note], suggestions, riskScore 0..1}`). `exec` dynamic-imports `@cloudflare/sandbox` (optionalDependency) — when both the package and a `SANDBOX` binding are present, writes the snippet to `/tmp/snippet.<ext>`, runs `python3` / `npx ts-node` / `go run` / `gcc && /tmp/snippet` / `node` per detected language, returns `{stdout, stderr, exitCode, durationMs}`. Falls back to a review pass with `sandbox: 'unavailable'` otherwise. | Bind `SANDBOX` in wrangler.toml when the Container is provisioned. |
| MemoryAgent | **REAL** — RPC methods `ingest` / `search` / `list` / `remove`. Writes to D1 `memories` + `memories_fts` (FTS5) for keyword recall. When `MEMORIES` Vectorize binding is bound, also embeds via `@cf/baai/bge-base-en-v1.5` and upserts; queries merge FTS + vector results via Reciprocal Rank Fusion (k=60). Soft-delete sets importance to 0; vector index is also pruned. **Now connected to the Learning page** — `POST /api/learning/pending/:id/accept` of a `memory` suggestion dispatches into `MemoryAgent.ingest` via DO RPC. | none. |
| Judge | **REAL** — three-dimensional rubric: deterministic `schema` heuristics + Workers AI `relevancy` + Workers AI `faithfulness`. `overall = 0.45·f + 0.35·r + 0.2·s`. Writes scores back to D1 `trajectories`. RetrainingWorkflow now consumes the low-score turns (< threshold, default 0.6) and **writes `pending_suggestions` rows** with kind=`memory` — payload includes the headline ("Watch grounding" vs "Stay on topic"), category, content, importance, whenToUse. Dedup'd by `trajectory_turn_id` so re-runs don't pile up. Learning page accept-flow already dispatches these into `MemoryAgent.ingest`. | Tune rubric weights from user feedback. |
| Sync pull | **REAL** — GitHub Compare API returns the unified diff between the persisted local SHA and `main`. Falls back to the sample diff when `GITHUB_TOKEN` is unbound. | Move the merge phase into a Sandbox so the user gets a 3-way merge preview before redeploying. |
| Sync propose-pr | **REAL** — creates a branch off `main`, optionally PUTs file patches via the Contents API, opens a draft PR. Returns the live `prUrl` + `prNumber`. Stub URL only when `GITHUB_TOKEN` is missing. | Wire the commit author rule (committer = user, author = agent) once the deployment writes its agent identity to KV. |
| Sync status | **REAL** — GitHub Commits API gives upstream HEAD; behind-count comes from local SHA position in the 5 most recent commits; open PRs surface in `recentPRs`. 60-second KV cache. | none — production-ready as long as the token has `repo` scope. |
| Stripe webhook | **REAL** — full Stripe-Signature HMAC-SHA256 verify with constant-time compare + 5-minute freshness window when `STRIPE_WEBHOOK_SECRET` is bound. On `checkout.session.completed`, parks the raw payload in KV under `pending-deploy:<sessionId>` and kicks `GoalWorkflow` with `kind: 'stripe_provisioning'`. **The provisioning branch is now real** — 7-step pipeline (identity → cf-account → domain → workers-paid → deploy-worker → configure-access → ready) writes progress to `provision:<sessionId>` in KV after every step and mirrors a `provision` row into `audit_log`. The `configure-access` step calls the shared `provisionAccess()` helper when `CLOUDFLARE_API_TOKEN` is bound. | Wire the partner CF account-creation API once the Stripe Projects credentials are issued. |
| Stripe checkout | **REAL** — when `STRIPE_API_KEY` is bound, hits `POST /v1/checkout/sessions` with form-encoded line items (domain + Workers Paid), customer email, metadata for `agent_name`, `monthly_cap_cents`, `domain`. Returns the live `url` + `id` + `client_secret`. Falls back to the deterministic stub when the key is missing (dev) or the live call fails. Price IDs configurable via `STRIPE_PRICE_DOMAIN` / `STRIPE_PRICE_WORKERS_PAID` so each deployment can map its own SKUs. | Persist the session id → agent mapping in KV so the webhook can correlate. |
| CF Access | **REAL** — `configure-access` deploy step now calls `provisionAccess()` inline: resolves the user's CF account id from `/accounts`, creates a self-hosted Access app for the agent's hostname (24h session), attaches an allow-list policy with owner email + any extra emails the user added during onboarding. Result lives in KV under `access:<agent>` so Settings → Access surfaces app id, policy id, and any provisioning errors. The token never lives past the deploy. | none — production-ready when token has `access:edit` scope. |
| BrowserSession | **REAL canvas integration** — `BrowserSessionArtifact` now opens a real WS to `/api/browser/<sid>/ws`, renders incoming `frame` messages as base64 PNGs, and sends `pause` / `resume` / `takeover` back through the socket on button click. Placeholder copy switches to "Browser Rendering binding offline — install @cloudflare/puppeteer + uncomment [browser]" when the DO emits the `binding_unavailable` placeholder. `@cloudflare/puppeteer` is an `optionalDependency`. | None — production-ready when the user uncomments the `[browser]` binding and runs `pnpm install`. |
| MPP runtime | **REAL END-TO-END** — orchestrator gates every tool call + the LLM run through `checkSpend`, rolls the daily counter lazily at local midnight, and emits `tool-blocked` WS frames when cap is hit. Each `chargeSpend(cents, tool)` writes a `tool_call` row to `audit_log` (D1). `/api/stripe/spend/<agent>` aggregates the last 24h of audit rows by tool, returns `source: 'd1'` when real data is present, falls back to the stub when empty. | none — production-ready. |

## Spec gaps (not yet covered)

These are explicit spec items where neither UI nor backing endpoint exists:

1. ~~Workspace concept~~ — **DONE**. `/api/workspaces` route (list / create /
   activate / pin / delete) backed by KV, `Workspaces` screen reachable
   from the sidebar identity row, switching activates the workspace and
   threads its `agentName` through `flow` so all subsequent surfaces
   (chat, settings, knowledge, invocations) target the new Orchestrator
   DO instance. **Each workspace card now shows a per-workspace 24h
   spend rollup** (`$X.YZ · N runs today`) fetched from
   `/api/invocations/<agent>/summary`.
2. **Vectorize binding** (PRD §5.5 — shared semantic memory). Declared in
   wrangler.toml but commented out for local dev (miniflare doesn't
   emulate Vectorize). Uncomment + `wrangler vectorize create` to enable
   in prod.
3. ~~Settings missing tabs from PRD §7~~ — Behavior, Knowledge, and
   Invocations tabs landed; prompt editor + Extended thinking toggle + token
   budget slider + sub-agent model + response style + code-mode toggle are
   all wired and persisted.
4. **Executor.sh MCP gateway integration** (PRD §5). The spec calls for
   `https://executor.sh/mcp` over WorkOS JWT for sandboxed exec. We use
   the in-Worker DO RPC pattern instead (same-account specialists, no
   public internet hop) which the spec actually prefers — see the
   §5.4 RPC-transport comparison table. So this is intentional, not a
   gap, but the executor.sh option could be added as a "remote
   specialists" feature later.
5. **PR-back to upstream** (PRD §6) via GitHub MCP. The route shape and
   UI are wired; the live MCP dispatch with a user PAT is pending.
6. **Self-evolution rubric scoring loop** (PRD §6). RetrainingWorkflow
   exists and the cron triggers it, but the Workflow body is a no-op
   until the Judge DO is wired.

## How to deploy for real

Local end-to-end is fully working. Production deploy requires:

```sh
# 1. Create the CF resources (one-time per user account)
wrangler d1 create openthink
wrangler kv namespace create SETTINGS
wrangler r2 bucket create openthink-artifacts
wrangler queues create openthink-trajectories
wrangler vectorize create openthink-memories --preset @cf/baai/bge-base-en-v1.5

# 2. Edit apps/platform/wrangler.toml:
#    - Replace the placeholder UUID/hex IDs with the values from step 1
#    - Uncomment the [[vectorize]] block
#    - Uncomment the [browser] block

# 3. Apply migrations
wrangler d1 migrations apply openthink

# 4. Ship
pnpm --filter @openthink/platform run deploy

# 5. Smoke-test the deployed worker
pnpm verify --base=https://openthink-platform.<subdomain>.workers.dev
```

The verify suite is base-URL agnostic — it'll happily smoke a remote
deployment and report any 5xx or shape regression.
