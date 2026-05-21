/* Mobile push notifications via expo-notifications.
 *
 * Registers the device with APNs / FCM on first launch, exchanges the
 * Expo push token for a real APNs/FCM token, then pushes it up to the
 * agent so it can deliver approvals + status updates.
 *
 * Deep-link mapping (handled by attachPushListeners below):
 *   data.deepLink = "openthink://approval/<id>"  →  /sheets/approval?id=<id>
 *   data.deepLink = "openthink://thread/<id>"    →  /threads/<id>
 *   data.deepLink = "openthink://updates"        →  /updates
 *   data.deepLink = "openthink://you"            →  /you
 *
 * The worker constructs the deepLink in `lib/push.ts` (pushApprovalNeeded,
 * pushStatus). Anything else lands as a plain notification with no route.
 */
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Router } from 'expo-router';

import type { Session } from './session';
import { registerPushToken } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function ensurePushPermission(): Promise<boolean> {
  if (!Device.isDevice) return false;
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const req = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return req.granted ?? false;
}

/** Best-effort registration. Returns silently on simulator or rejected permissions. */
export async function registerForPush(session: Session): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const ok = await ensurePushPermission();
    if (!ok) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'OpenThink alerts',
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: '#F38020',
      });
    }

    const tokenResp = await Notifications.getExpoPushTokenAsync();
    const platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android';
    await registerPushToken(session, tokenResp.data, platform);
  } catch {
    /* swallow — failed permission/registration shouldn't block the app */
  }
}

/** Parse a push deep link into a router pathname + optional params.
 *  Returns null when the link doesn't match a known surface so we can
 *  log + bail instead of routing nowhere. */
export function parseDeepLink(link: string): { pathname: string; params?: Record<string, string> } | null {
  // Be lenient about scheme casing — both `openthink://` and `OPENTHINK://`
  // are fine. Strip the scheme and split on `?` for any query string.
  const stripped = link.replace(/^[a-zA-Z]+:\/\//, '');
  const [pathPart] = stripped.split('?');
  if (!pathPart) return null;
  const segments = pathPart.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const [head, ...rest] = segments;
  if (head === 'approval') {
    const id = rest[0];
    if (!id) return null;
    return { pathname: '/sheets/approval', params: { id } };
  }
  if (head === 'thread' || head === 'threads') {
    const id = rest[0];
    if (!id) return { pathname: '/threads' };
    return { pathname: `/threads/${id}` };
  }
  if (head === 'browser') {
    const id = rest[0];
    return { pathname: id ? `/browser/${id}` : '/today' };
  }
  if (head === 'updates') return { pathname: '/updates' };
  if (head === 'you') return { pathname: '/you' };
  if (head === 'today') return { pathname: '/today' };
  return null;
}

/** Attach notification-response listeners that route on tap.
 *  Pair with `useEffect` in the root layout — returns a teardown fn that
 *  removes both subscriptions when the component unmounts. */
export function attachPushListeners(router: Router): () => void {
  // User tapped a notification (foreground or background) — route to the
  // matching screen if the data has a deepLink we recognize.
  const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
    try {
      const data = response.notification.request.content.data as
        | { deepLink?: string; approvalId?: string }
        | undefined;
      const link = data?.deepLink;
      if (typeof link !== 'string' || link.length === 0) return;
      const route = parseDeepLink(link);
      if (!route) return;
      if (route.params) {
        router.push({ pathname: route.pathname as never, params: route.params });
      } else {
        router.push(route.pathname as never);
      }
    } catch (err) {
      console.warn('[notifications] tap routing failed', err);
    }
  });

  // Also handle the "app was killed, user tapped" case. The OS surfaces the
  // last response via getLastNotificationResponseAsync(). We do this once on
  // attach; if the response was already consumed by the foreground listener
  // we skip it.
  let handledColdStart = false;
  void (async () => {
    try {
      const last = await Notifications.getLastNotificationResponseAsync();
      if (!last || handledColdStart) return;
      handledColdStart = true;
      const data = last.notification.request.content.data as
        | { deepLink?: string }
        | undefined;
      const link = data?.deepLink;
      if (typeof link !== 'string' || link.length === 0) return;
      const route = parseDeepLink(link);
      if (!route) return;
      if (route.params) {
        router.push({ pathname: route.pathname as never, params: route.params });
      } else {
        router.push(route.pathname as never);
      }
    } catch {
      /* no last response — fresh install */
    }
  })();

  return () => {
    responseSub.remove();
  };
}
