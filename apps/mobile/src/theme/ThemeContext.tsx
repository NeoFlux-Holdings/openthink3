/* Theme provider — persists choice to SecureStore, exposes a `useTheme()` hook
 * that returns the current palette. The whole app re-renders on theme change.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { getSystemTheme, PALETTES, type Theme } from './tokens';

interface ThemeValue {
  theme: Theme;
  colors: typeof PALETTES.light;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
}

const STORAGE_KEY = 'openthink.theme';

const ThemeCtx = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => getSystemTheme());

  // Hydrate persisted theme on mount. We start with the system theme so
  // first paint matches the OS; once SecureStore answers we flip to the
  // user's saved preference if any.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await SecureStore.getItemAsync(STORAGE_KEY);
        if (!cancelled && (raw === 'light' || raw === 'dark')) {
          setThemeState(raw);
        }
      } catch {
        /* swallow — fall back to system */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Honor OS-level theme flips as long as the user hasn't picked one
  // explicitly. After they do, we ignore system flips. We track this via
  // whether the storage is populated.
  useEffect(() => {
    const sub = Appearance.addChangeListener(async () => {
      const stored = await SecureStore.getItemAsync(STORAGE_KEY).catch(() => null);
      if (stored === 'light' || stored === 'dark') return;
      setThemeState(getSystemTheme());
    });
    return () => sub.remove();
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    void SecureStore.setItemAsync(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === 'light' ? 'dark' : 'light';
      void SecureStore.setItemAsync(STORAGE_KEY, next).catch(() => undefined);
      return next;
    });
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({ theme, colors: PALETTES[theme], setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeValue {
  const v = useContext(ThemeCtx);
  if (!v) throw new Error('useTheme must be called inside <ThemeProvider>');
  return v;
}
