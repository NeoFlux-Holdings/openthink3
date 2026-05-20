/* Thin wrapper over expo-haptics that swallows errors on the simulator
 * (no haptic engine) and matches the four cadences we use across the app:
 *
 *   tap()      — light tactile click; FAB tap, tab change
 *   confirm()  — medium impact; Send button, "do it" actions
 *   warning()  — notification warning; Skip / Cancel
 *   success()  — notification success; Approval done, deploy ready
 *
 * Imported lazily so a missing native module on web doesn't crash.
 */
import { Platform } from 'react-native';

type HapticsModule = typeof import('expo-haptics');

let cached: HapticsModule | null = null;
async function load(): Promise<HapticsModule | null> {
  if (Platform.OS === 'web') return null;
  if (cached) return cached;
  try {
    cached = await import('expo-haptics');
    return cached;
  } catch {
    return null;
  }
}

export function tap(): void {
  void load().then((h) => h?.impactAsync(h.ImpactFeedbackStyle.Light).catch(() => undefined));
}

export function confirm(): void {
  void load().then((h) => h?.impactAsync(h.ImpactFeedbackStyle.Medium).catch(() => undefined));
}

export function warning(): void {
  void load().then((h) => h?.notificationAsync(h.NotificationFeedbackType.Warning).catch(() => undefined));
}

export function success(): void {
  void load().then((h) => h?.notificationAsync(h.NotificationFeedbackType.Success).catch(() => undefined));
}

export function selection(): void {
  void load().then((h) => h?.selectionAsync().catch(() => undefined));
}
