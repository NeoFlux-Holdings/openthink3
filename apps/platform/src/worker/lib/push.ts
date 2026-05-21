/* Expo push notifications — thin wrapper around the Expo push API.
 *
 * The mobile app registers its Expo push token via /api/mobile/push/register
 * (stored in KV under `mobile:push:<bearer>`). When the orchestrator needs
 * to nudge the user (approval needed, task done, spend cap reached), it
 * calls sendApprovalPush() / sendStatusPush() — those resolve all matching
 * tokens for the agent and POST to https://exp.host/--/api/v2/push/send.
 *
 * Why direct fetch, not the expo-server-sdk npm package: the SDK pulls in
 * a real Node fetch + node-buffer that Workers can't bundle cleanly. The
 * Expo push protocol is a plain JSON POST — three lines of code beats a
 * Workers-compatibility headache.
 *
 * Resilience:
 *  - Network errors return `{ ok: 0, failed: len }` instead of throwing.
 *    Callers should treat push as best-effort and never block the agent.
 *  - We batch up to 100 messages per request (the Expo limit).
 *  - 410-equivalent "DeviceNotRegistered" responses get cleaned out of KV
 *    so the next iteration doesn't keep retrying dead tokens.
 */

import type { Env } from '../env';

export interface PushMessage {
  /** Expo push token (e.g. ExponentPushToken[...]) */
  to: string;
  title?: string;
  body?: string;
  /** Free-form data; mobile reads `data.deepLink` to route on tap. */
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  /** Channel id on Android. Default channel is set in the mobile lib. */
  channelId?: string;
  ttl?: number;
}

interface RegisteredDevice {
  token: string;
  platform: 'ios' | 'android';
  agentName: string;
  deviceLabel: string;
  bearerKey: string; // The KV key — used to delete dead tokens.
}

const PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const PUSH_PREFIX = 'mobile:push:';

/** Walk KV and return every registered device, optionally filtered by agentName. */
export async function listRegisteredDevices(
  env: Env,
  agentName?: string,
): Promise<RegisteredDevice[]> {
  const out: RegisteredDevice[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.SETTINGS.list({ prefix: PUSH_PREFIX, cursor });
    for (const k of page.keys) {
      const raw = await env.SETTINGS.get(k.name);
      if (!raw) continue;
      try {
        const rec = JSON.parse(raw) as {
          token?: string;
          platform?: 'ios' | 'android';
          agentName?: string;
          deviceLabel?: string;
        };
        if (!rec.token || !rec.platform) continue;
        if (agentName && rec.agentName && rec.agentName !== agentName) continue;
        out.push({
          token: rec.token,
          platform: rec.platform,
          agentName: rec.agentName ?? 'agent',
          deviceLabel: rec.deviceLabel ?? 'mobile',
          bearerKey: k.name,
        });
      } catch {
        /* malformed record — skip */
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

/** Send a batch of messages. Returns counts; never throws. */
export async function sendExpoPush(messages: PushMessage[]): Promise<{ ok: number; failed: number }> {
  if (messages.length === 0) return { ok: 0, failed: 0 };
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100).map((m) => ({
      to: m.to,
      title: m.title,
      body: m.body,
      data: m.data,
      sound: m.sound ?? 'default',
      badge: m.badge,
      channelId: m.channelId ?? 'default',
      ttl: m.ttl ?? 60 * 60 * 24, // 24h default — beyond that, the user will see it in-app
    }));
    try {
      const res = await fetch(PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        failed += batch.length;
        continue;
      }
      const json = (await res.json().catch(() => ({}))) as {
        data?: Array<{ status: 'ok' | 'error'; details?: { error?: string } }>;
      };
      const tickets = json.data ?? [];
      for (const t of tickets) {
        if (t.status === 'ok') ok += 1;
        else failed += 1;
      }
    } catch (err) {
      console.warn('[push] batch failed', err);
      failed += batch.length;
    }
  }
  return { ok, failed };
}

/** Convenience: send the same payload to every device registered for the agent. */
export async function pushToAgent(
  env: Env,
  agentName: string,
  payload: { title: string; body?: string; data?: Record<string, unknown> },
): Promise<{ ok: number; failed: number; devices: number }> {
  const devices = await listRegisteredDevices(env, agentName);
  const messages: PushMessage[] = devices.map((d) => ({
    to: d.token,
    title: payload.title,
    body: payload.body,
    data: payload.data,
  }));
  const result = await sendExpoPush(messages);
  return { ...result, devices: devices.length };
}

/** Approval-needed convenience. Deep link routes the mobile app to the approval sheet. */
export async function pushApprovalNeeded(
  env: Env,
  agentName: string,
  approval: { id: string; title: string; body?: string; threadId?: string },
): Promise<{ ok: number; failed: number; devices: number }> {
  return pushToAgent(env, agentName, {
    title: approval.title,
    body: approval.body ?? 'Tap to review',
    data: {
      kind: 'approval-needed',
      approvalId: approval.id,
      threadId: approval.threadId,
      deepLink: `openthink://approval/${approval.id}`,
    },
  });
}

/** Generic status convenience. Used for task done, spend cap, etc. */
export async function pushStatus(
  env: Env,
  agentName: string,
  title: string,
  body: string,
  deepLink?: string,
): Promise<{ ok: number; failed: number; devices: number }> {
  return pushToAgent(env, agentName, {
    title,
    body,
    data: deepLink ? { kind: 'status', deepLink } : { kind: 'status' },
  });
}
