/* Root layout — wires:
 *   - GestureHandlerRootView (required for bottom-sheet gestures)
 *   - ThemeProvider (light/dark)
 *   - SessionProvider (the agent the user signed into)
 *   - QueryClient (TanStack Query)
 *   - Custom fonts (Geist + Geist Mono — optional; degrade to system sans-serif
 *     if the asset files haven't been dropped into apps/mobile/assets/fonts yet)
 *   - Splash gating until everything's ready
 *
 * Inside, expo-router handles routing via the file tree under `app/`.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Font from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider, useTheme } from '../src/theme/ThemeContext';
import { SessionProvider } from '../src/lib/session-store';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await Font.loadAsync(loadOptionalFonts()).catch(() => undefined);
      } finally {
        if (!cancelled) {
          setReady(true);
          void SplashScreen.hideAsync();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <ThemeProvider>
            <SessionProvider>
              <ThemedShell />
            </SessionProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

function ThemedShell() {
  const { theme, colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'fade',
        }}
      >
        {/* Sheet routes use a transparent presentation so the BottomSheet
            can draw its own backdrop without the navigator drawing one
            underneath. iOS gets formSheet on iPad-sized screens; phone gets
            the same vertical reveal. */}
        <Stack.Screen
          name="sheets/new-task"
          options={{
            presentation: 'transparentModal',
            animation: 'fade',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="sheets/approval"
          options={{
            presentation: 'transparentModal',
            animation: 'fade',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="sheets/theme"
          options={{
            presentation: 'transparentModal',
            animation: 'fade',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        {/* Browser session uses a normal push so swipe-back works. */}
        <Stack.Screen
          name="browser/[id]"
          options={{
            animation: 'slide_from_right',
            gestureEnabled: true,
          }}
        />
        <Stack.Screen
          name="settings/[key]"
          options={{
            animation: 'slide_from_right',
            gestureEnabled: true,
          }}
        />
        <Stack.Screen
          name="threads/[id]"
          options={{
            animation: 'slide_from_right',
            gestureEnabled: true,
          }}
        />
      </Stack>
    </View>
  );
}

function loadOptionalFonts(): Record<string, number> {
  const map: Record<string, number> = {};
  const safeRequire = (name: string, loader: () => number) => {
    try {
      map[name] = loader();
    } catch {
      /* asset missing — fall back to system font */
    }
  };
  /* eslint-disable @typescript-eslint/no-require-imports */
  safeRequire('Geist-Regular', () => require('../assets/fonts/Geist-Regular.ttf'));
  safeRequire('Geist-Medium', () => require('../assets/fonts/Geist-Medium.ttf'));
  safeRequire('Geist-SemiBold', () => require('../assets/fonts/Geist-SemiBold.ttf'));
  safeRequire('GeistMono-Regular', () => require('../assets/fonts/GeistMono-Regular.ttf'));
  safeRequire('GeistMono-Medium', () => require('../assets/fonts/GeistMono-Medium.ttf'));
  /* eslint-enable @typescript-eslint/no-require-imports */
  return map;
}
