/* Theme state — `data-theme` attribute on <html>, persisted to localStorage,
 * plus a small `useTheme()` hook that any surface can use to read & flip it.
 * The whole app shares one theme; the sidebar, marketing nav, and settings
 * page all call into this so they stay in lock-step.
 */
import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'openthink.theme';

function getStoredTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark') return raw;
  } catch {
    /* localStorage unavailable; ignore */
  }
  return null;
}

function getSystemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

// Apply theme synchronously on first JS execution so we never flash the wrong
// palette. Called once from main.tsx-side import order, but safe to re-run.
const initial = getStoredTheme() ?? getSystemTheme();
if (typeof document !== 'undefined') applyTheme(initial);

const listeners = new Set<(t: Theme) => void>();
let current: Theme = initial;

export function setTheme(theme: Theme) {
  current = theme;
  applyTheme(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(theme));
}

export function getTheme(): Theme {
  return current;
}

export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setLocal] = useState<Theme>(current);
  useEffect(() => {
    const onChange = (next: Theme) => setLocal(next);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);
  return [theme, setTheme];
}
