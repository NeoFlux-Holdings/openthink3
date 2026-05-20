/* Mobile push notifications via expo-notifications.
 *
 * Registers the device with APNs / FCM on first launch, exchanges the
 * Expo push token for a real APNs/FCM token, then pushes it up to the
 * agent so it can deliver approvals + status updates.
 */
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

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
