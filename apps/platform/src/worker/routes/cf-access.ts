import { Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../env';

export const cfAccess = new Hono<{ Bindings: Env; Variables: Variables }>();

// Cloudflare Access provisioning. Two surfaces:
//
//   POST /api/access/provision  →  during deploy, called once with the
//      user's verified CF token + email allowlist. Creates a self-hosted
//      Access application targeting the agent's hostname, plus a single
//      email-list policy that allows the owner + any extras.
//
//   GET  /api/access/status     →  Settings → Access tab reads from this to
//      render the current policy + allowed identities. Reads back from KV
//      so the page never blocks on the CF API.
//
// Auth: the token is the per-user CF token verified at onboarding/token. We
// don't store it server-side; the provision endpoint accepts it in the
// request body, uses it once, and forgets. Production-class flow.

const ProvisionBody = z.object({
  agentName: z.string().min(2),
  hostname: z.string().min(3),
  ownerEmail: z.string().email(),
  extraEmails: z.array(z.string().email()).default([]),
  cloudflareToken: z.string().min(20),
  accountId: z.string().optional(),
});

interface AccessAppState {
  agentName: string;
  hostname: string;
  appId?: string;
  policyId?: string;
  allowedEmails: string[];
  provisionedAt?: number;
  source: 'cf' | 'stub' | 'pending';
  lastError?: string;
}

function key(agentId: string): string {
  return `access:${agentId}`;
}

async function readState(env: Env, agentId: string): Promise<AccessAppState | null> {
  const raw = await env.SETTINGS.get(key(agentId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AccessAppState;
  } catch {
    return null;
  }
}

async function writeState(env: Env, agentId: string, state: AccessAppState): Promise<void> {
  await env.SETTINGS.put(key(agentId), JSON.stringify(state));
}

cfAccess.get('/:agentId/status', async (c) => {
  const state = await readState(c.env, c.req.param('agentId'));
  return c.json(
    state ?? {
      agentName: c.req.param('agentId'),
      hostname: '',
      allowedEmails: [],
      source: 'pending',
    },
  );
});

cfAccess.post('/provision', async (c) => {
  const parsed = ProvisionBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const result = await provisionAccess(c.env, parsed.data);
  return c.json(result, result.ok ? 200 : 502);
});

// Local-only edit to the allow-list. Updates the KV-stored Access state
// so Settings → Access reflects the change immediately. The live CF
// Access policy doesn't roll until the next `provisionAccess()` call —
// surfaced via a `pendingSync: true` flag in the response so the UI can
// warn the user.
const EmailBody = z.object({ email: z.string().email() });

cfAccess.post('/:agentId/emails', async (c) => {
  const parsed = EmailBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_email' }, 400);
  }
  const agentId = c.req.param('agentId');
  const state = (await readState(c.env, agentId)) ?? {
    agentName: agentId,
    hostname: '',
    allowedEmails: [],
    source: 'pending' as const,
  };
  const email = parsed.data.email.toLowerCase();
  if (state.allowedEmails.includes(email)) {
    return c.json({ ok: true, state, pendingSync: false, alreadyMember: true });
  }
  const next: AccessAppState = {
    ...state,
    allowedEmails: [...state.allowedEmails, email],
  };
  await writeState(c.env, agentId, next);
  return c.json({ ok: true, state: next, pendingSync: next.source === 'cf' });
});

cfAccess.delete('/:agentId/emails/:email', async (c) => {
  const agentId = c.req.param('agentId');
  const email = decodeURIComponent(c.req.param('email')).toLowerCase();
  const state = await readState(c.env, agentId);
  if (!state) {
    return c.json({ ok: false, error: 'no_state' }, 404);
  }
  const next: AccessAppState = {
    ...state,
    allowedEmails: state.allowedEmails.filter((e) => e.toLowerCase() !== email),
  };
  await writeState(c.env, agentId, next);
  return c.json({ ok: true, state: next, pendingSync: next.source === 'cf' });
});

export interface ProvisionInput {
  agentName: string;
  hostname: string;
  ownerEmail: string;
  extraEmails: string[];
  cloudflareToken: string;
  accountId?: string;
}

export interface ProvisionResult {
  ok: boolean;
  state: AccessAppState;
  error?: string;
}

// Standalone provision function so the deploy SSE stream can call it
// in-process during the `configure-access` step without going over the wire.
export async function provisionAccess(
  env: Env,
  input: ProvisionInput,
): Promise<ProvisionResult> {
  const { agentName, hostname, ownerEmail, extraEmails, cloudflareToken } = input;
  let { accountId } = input;
  const allowed = unique([ownerEmail, ...extraEmails]);

  // Resolve the account id when not provided — token verify endpoint returns
  // it as part of `result.id`. Fast and avoids forcing the client to track
  // which CF account the token lives under.
  let resolvedAccount = accountId;
  if (!resolvedAccount) {
    try {
      const acctRes = await fetch('https://api.cloudflare.com/client/v4/accounts', {
        headers: { Authorization: `Bearer ${cloudflareToken}` },
      });
      if (acctRes.ok) {
        const data = (await acctRes.json()) as {
          result?: Array<{ id: string }>;
        };
        resolvedAccount = data.result?.[0]?.id;
      }
    } catch {
      /* fall through */
    }
  }

  if (!resolvedAccount) {
    const state: AccessAppState = {
      agentName,
      hostname,
      allowedEmails: allowed,
      source: 'stub',
      lastError: 'no_account_id',
      provisionedAt: Date.now(),
    };
    await writeState(env, agentName, state);
    return { ok: false, state, error: 'no_account_id' };
  }

  try {
    // 1. Create the Access application.
    const appRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${resolvedAccount}/access/apps`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cloudflareToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `OpenThink — ${agentName}`,
          domain: hostname,
          type: 'self_hosted',
          session_duration: '24h',
          allowed_idps: [],
          auto_redirect_to_identity: false,
          app_launcher_visible: false,
        }),
      },
    );
    if (!appRes.ok) {
      const errText = await appRes.text();
      throw new Error(`access_app_${appRes.status}: ${errText}`);
    }
    const appData = (await appRes.json()) as { result?: { id: string } };
    const appId = appData.result?.id;
    if (!appId) throw new Error('access_app_no_id');

    // 2. Attach a single allow-list policy. CF Access policy "include" is an
    //    OR — any email in the list grants access.
    const policyRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${resolvedAccount}/access/apps/${appId}/policies`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cloudflareToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'OpenThink allow-list',
          decision: 'allow',
          include: allowed.map((email) => ({ email: { email } })),
          precedence: 1,
        }),
      },
    );
    if (!policyRes.ok) {
      const errText = await policyRes.text();
      throw new Error(`access_policy_${policyRes.status}: ${errText}`);
    }
    const policyData = (await policyRes.json()) as { result?: { id: string } };
    const policyId = policyData.result?.id;

    const state: AccessAppState = {
      agentName,
      hostname,
      appId,
      policyId,
      allowedEmails: allowed,
      provisionedAt: Date.now(),
      source: 'cf',
    };
    await writeState(env, agentName, state);
    return { ok: true, state };
  } catch (err) {
    console.error('[cf-access] provision failed', err);
    const state: AccessAppState = {
      agentName,
      hostname,
      allowedEmails: allowed,
      source: 'stub',
      lastError: err instanceof Error ? err.message : String(err),
      provisionedAt: Date.now(),
    };
    await writeState(env, agentName, state);
    return { ok: false, state, error: 'provision_failed' };
  }
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
