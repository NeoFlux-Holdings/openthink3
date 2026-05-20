/* Mobile session storage.
 *
 * The mobile app is a thin client for an existing agent. The user pastes
 * (or QR-scans) their agent's URL + a magic-link token issued by the web
 * app's /api/mobile/session endpoint. We keep this in expo-secure-store so
 * it survives reboots and isn't readable by other apps.
 */
import * as SecureStore from 'expo-secure-store';

const KEY_URL = 'openthink.agent.url';
const KEY_TOKEN = 'openthink.agent.token';
const KEY_AGENT_NAME = 'openthink.agent.name';

export interface Session {
  /** Base URL of the agent — e.g. `https://flannel-arroyo.openthink.run` */
  agentUrl: string;
  /** Long-lived bearer token issued by /api/mobile/session */
  token: string;
  /** Display name for the agent ("flannel-arroyo"). */
  agentName: string;
}

export async function loadSession(): Promise<Session | null> {
  try {
    const [agentUrl, token, agentName] = await Promise.all([
      SecureStore.getItemAsync(KEY_URL),
      SecureStore.getItemAsync(KEY_TOKEN),
      SecureStore.getItemAsync(KEY_AGENT_NAME),
    ]);
    if (!agentUrl || !token) return null;
    return { agentUrl, token, agentName: agentName || extractAgentName(agentUrl) };
  } catch {
    return null;
  }
}

export async function saveSession(s: Session): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEY_URL, s.agentUrl),
    SecureStore.setItemAsync(KEY_TOKEN, s.token),
    SecureStore.setItemAsync(KEY_AGENT_NAME, s.agentName),
  ]);
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_URL),
    SecureStore.deleteItemAsync(KEY_TOKEN),
    SecureStore.deleteItemAsync(KEY_AGENT_NAME),
  ]);
}

/** "flannel-arroyo" from "https://flannel-arroyo.openthink.run". */
export function extractAgentName(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.split('.')[0] || 'agent';
  } catch {
    return 'agent';
  }
}

export function normalizeAgentUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Accept "flannel-arroyo" (subdomain) → expand to openthink.run.
  if (/^[a-z0-9-]+$/.test(trimmed)) {
    return `https://${trimmed}.openthink.run`;
  }
  // Accept "flannel-arroyo.openthink.run" or full URL.
  if (/^https?:\/\//.test(trimmed)) return trimmed.replace(/\/+$/, '');
  return `https://${trimmed.replace(/\/+$/, '')}`;
}
