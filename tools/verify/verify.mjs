#!/usr/bin/env node
// tools/verify/verify.mjs — smoke-test every public surface against a running
// openthink-platform worker. Use against `wrangler dev --local` or a real
// deploy (pass --base=https://your-agent.workers.dev).
//
//   pnpm verify
//   pnpm verify --base=http://127.0.0.1:8787       (default)
//   pnpm verify --base=https://drift-wombat.workers.dev
//
// Exits non-zero on any failure. Designed to be wired into CI.

const args = process.argv.slice(2);
const base =
  args.find((a) => a.startsWith('--base='))?.slice('--base='.length) ?? 'http://127.0.0.1:8787';
const agentId = args.find((a) => a.startsWith('--agent='))?.slice('--agent='.length) ?? 'verify-agent';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[90m';
const BOLD = '\x1b[1m';

const results = [];
let failed = 0;

function pad(s, n) {
  return s + ' '.repeat(Math.max(0, n - s.length));
}

async function http(name, opts) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}${opts.path}`, {
      method: opts.method ?? 'GET',
      headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers ?? {}) },
      body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
    });
    const ms = Date.now() - t0;
    const ok = opts.expectStatus ? res.status === opts.expectStatus : res.ok;
    const text = await res.text();
    let preview = text.replace(/\s+/g, ' ').slice(0, 80);
    if (text.length > 80) preview += '…';
    const status = ok ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
    console.log(`${status} ${pad(name, 32)} ${DIM}${pad(opts.method ?? 'GET', 4)}${RESET} ${pad(String(res.status), 4)} ${DIM}${pad(`${ms}ms`, 6)}${RESET} ${preview}`);
    if (!ok) failed++;
    results.push({ name, ok, status: res.status, ms, body: text });
    return { ok, status: res.status, text, json: safeJson(text) };
  } catch (err) {
    const ms = Date.now() - t0;
    console.log(`${RED}FAIL${RESET} ${pad(name, 32)} ${DIM}${pad(opts.method ?? 'GET', 4)} ERR  ${pad(`${ms}ms`, 6)}${RESET} ${err.message}`);
    failed++;
    results.push({ name, ok: false, error: err.message });
    return { ok: false, error: err };
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function ws(name, path, send, expectFrames = 1) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const url = `${base.replace(/^http/, 'ws')}${path}`;
    const sock = new WebSocket(url);
    let frames = 0;
    let settled = false;
    const finish = (ok, info) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      const ms = Date.now() - t0;
      const status = ok ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
      console.log(`${status} ${pad(name, 32)} ${DIM}WS   ${pad(String(frames), 4)}${RESET}  ${pad(`${ms}ms`, 6)} ${info}`);
      if (!ok) failed++;
      results.push({ name, ok, frames });
      try {
        sock.close();
      } catch {
        /* noop */
      }
      resolve({ ok, frames });
    };
    sock.addEventListener('open', () => {
      if (send) sock.send(JSON.stringify(send));
    });
    sock.addEventListener('message', () => {
      frames++;
      if (frames >= expectFrames) finish(true, 'received expected frames');
    });
    sock.addEventListener('error', () => finish(false, 'socket error'));
    const deadline = setTimeout(
      () => finish(frames >= expectFrames, frames === 0 ? 'no frames received' : 'timeout-but-frames-received'),
      4500,
    );
    // Don't let the deadline keep the Node event loop alive after the promise
    // settles — settled finish() clears it, but we also unref as a belt.
    if (typeof deadline.unref === 'function') deadline.unref();
  });
}

console.log(`${BOLD}OpenThink verification${RESET}  ${DIM}base=${base} agent=${agentId}${RESET}`);
console.log();

// ----- HTTP -----
await http('health', { path: '/api/health' });

// Chat / Orchestrator DO
await http('chat: list threads', { path: `/api/chat/${agentId}/threads` });
const created = await http('chat: create thread', {
  path: `/api/chat/${agentId}/threads`,
  method: 'POST',
  body: { title: 'verify-run' },
});
const threadId = created.json?.id;
if (threadId) {
  await http('chat: get thread', { path: `/api/chat/${agentId}/threads/${threadId}` });
}

// Skills
await http('skills: list', { path: '/api/skills' });
await http('skills: toggle', { path: '/api/skills/agents-sdk/toggle', method: 'POST', body: {} });

// Learning
await http('learning: summary', { path: '/api/learning/summary' });
await http('learning: pending', { path: '/api/learning/pending' });

// Settings (KV round-trip)
await http('settings: put', {
  path: `/api/settings/${agentId}`,
  method: 'PUT',
  body: { mode: 'smart_auto', spend_cap: 500 },
});
await http('settings: get', { path: `/api/settings/${agentId}` });

// Onboarding helpers
await http('onboarding: suggest-name', { path: '/api/onboarding/suggest-name' });

// CF token URL
await http('cf-token: url', { path: '/api/cf-token/url?name=verify' });
await http('cf-token: validate (expect 400)', {
  path: '/api/cf-token/validate',
  method: 'POST',
  body: { token: 'deliberately-bogus-token-for-validate-path' },
  expectStatus: 400,
});

// Sync
await http('sync: status', { path: '/api/sync/status' });
await http('sync: pull', { path: '/api/sync/pull', method: 'POST', body: {} });
await http('sync: apply', { path: '/api/sync/apply', method: 'POST', body: {} });
await http('sync: propose-pr', {
  path: '/api/sync/propose-pr',
  method: 'POST',
  body: { skillId: 'morning-inbox-triage', title: 'Verify-run candidate' },
});

// Stripe
await http('stripe: checkout', {
  path: '/api/stripe/checkout',
  method: 'POST',
  body: { agentName: agentId, email: 'verify@example.com' },
});
await http('stripe: webhook (signed)', {
  path: '/api/stripe/webhook',
  method: 'POST',
  body: { type: 'checkout.session.completed', data: { object: { client_reference_id: 'ref_verify' } } },
  headers: { 'Stripe-Signature': 't=1,v1=stub' },
});
await http('stripe: spend', { path: `/api/stripe/spend/${agentId}` });

// Artifacts (R2 round-trip)
await http('artifacts: put', {
  path: `/api/artifacts/verify-${Date.now()}.txt`,
  method: 'PUT',
  body: 'hello from verify.mjs',
  headers: { 'Content-Type': 'text/plain' },
});

// Deploy SSE start
await http('deploy: start', {
  path: '/api/deploy/start',
  method: 'POST',
  body: { agentName: 'verify-deploy', email: 'verify@example.com', accessEmails: [] },
});

// ----- WebSocket round-trips -----
await ws(
  'ws: orchestrator chat',
  `/agents/${agentId}/ws`,
  { type: 'send', threadId: threadId ?? 'verify-thread', content: 'verify ping' },
  2, // expect user-echo + assistant-stub
);

await ws(
  'ws: browser session',
  `/api/browser/verify-session/ws`,
  { type: 'spawn', url: 'https://example.com' },
  2, // state on connect + ack of spawn
);

console.log();
if (failed > 0) {
  console.log(`${RED}${BOLD}${failed} check(s) failed.${RESET}`);
  process.exit(1);
}
console.log(`${GREEN}${BOLD}All ${results.length} checks passed.${RESET}`);
process.exit(0);
