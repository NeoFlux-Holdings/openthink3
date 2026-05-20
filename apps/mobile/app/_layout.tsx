/* Root layout — wires:
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

  // Try to load Geist fonts but never block startup on them — the font
  // assets are user-supplied (license-restricted) so we ship the app
  // without them by default and fall back to platform sans-serif. The
  // require() call is wrapped so a missing asset doesn't crash bundling.
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
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <ThemeProvider>
          <SessionProvider>
            <ThemedShell />
          </SessionProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
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
      />
    </View>
  );
}

function loadOptionalFonts(): Record<string, number> {
  // Each require() is wrapped because Metro evaluates them at bundle time —
  // a missing file would otherwise break the build. We guard with try/catch
  // inside an IIFE so missing assets degrade gracefully to system fonts.
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
