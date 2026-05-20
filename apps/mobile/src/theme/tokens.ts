/* Design tokens for the OpenThink mobile app.
 *
 * Mirrors the web's CSS variables (apps/platform/src/web/styles/tokens.css)
 * so the two apps share the same visual DNA. The mapping is intentional —
 * if a token changes on the web side, mirror it here and vice versa.
 */
import { Appearance } from 'react-native';

export type Theme = 'light' | 'dark';

interface Palette {
  bg: string;
  bg2: string;
  surface: string;
  surface2: string;
  surface3: string;

  ink: string;
  ink2: string;
  ink3: string;
  mute: string;
  soft: string;
  faint: string;

  rule: string;
  rule2: string;
  ruleStrong: string;

  brand: string;
  brand2: string;
  brandSoft: string;
  brandSoft2: string;
  brandInk: string;

  coral: string;
  coralSoft: string;
  coralInk: string;

  green: string;
  greenSoft: string;
  greenInk: string;

  amber: string;
  amberSoft: string;
  amberInk: string;

  red: string;
  redSoft: string;
  redInk: string;

  blue: string;
  blueSoft: string;
  blueInk: string;
}

const LIGHT: Palette = {
  bg: '#FBF8F2',
  bg2: '#F4EFE4',
  surface: '#FFFFFF',
  surface2: '#F7F2E6',
  surface3: '#EFE8D6',

  ink: '#0E0F12',
  ink2: '#2A2C32',
  ink3: '#4A4D55',
  mute: '#6C707A',
  soft: '#9CA0AB',
  faint: '#C7CAD3',

  rule: 'rgba(14, 15, 18, 0.08)',
  rule2: 'rgba(14, 15, 18, 0.14)',
  ruleStrong: 'rgba(14, 15, 18, 0.22)',

  brand: '#F38020',
  brand2: '#D86A12',
  brandSoft: '#FEF1E0',
  brandSoft2: '#FDDDB8',
  brandInk: '#8A4109',

  coral: '#E54B2C',
  coralSoft: '#FCE0D9',
  coralInk: '#962E14',

  green: '#2BAA68',
  greenSoft: '#DDF3E6',
  greenInk: '#146636',

  amber: '#E0A012',
  amberSoft: '#FBEFD0',
  amberInk: '#7C5409',

  red: '#DA3232',
  redSoft: '#FCE2E2',
  redInk: '#841C1C',

  blue: '#2675E5',
  blueSoft: '#DDEBFB',
  blueInk: '#0E4B9C',
};

const DARK: Palette = {
  bg: '#0A0B0E',
  bg2: '#101116',
  surface: '#15171D',
  surface2: '#1B1E25',
  surface3: '#232730',

  ink: '#F2F3F6',
  ink2: '#D6D9DF',
  ink3: '#A3A8B3',
  mute: '#7E8390',
  soft: '#5C6170',
  faint: '#3D4150',

  rule: 'rgba(255, 255, 255, 0.08)',
  rule2: 'rgba(255, 255, 255, 0.14)',
  ruleStrong: 'rgba(255, 255, 255, 0.24)',

  brand: '#FAAD3F',
  brand2: '#F38020',
  brandSoft: 'rgba(243, 128, 32, 0.18)',
  brandSoft2: 'rgba(243, 128, 32, 0.32)',
  brandInk: '#FFD9A3',

  coral: '#FF7A52',
  coralSoft: 'rgba(255, 122, 82, 0.18)',
  coralInk: '#FFB89E',

  green: '#4FCB89',
  greenSoft: 'rgba(79, 203, 137, 0.16)',
  greenInk: '#B5E9CC',

  amber: '#F2BE52',
  amberSoft: 'rgba(242, 190, 82, 0.18)',
  amberInk: '#F5D998',

  red: '#F26060',
  redSoft: 'rgba(242, 96, 96, 0.18)',
  redInk: '#FAB4B4',

  blue: '#6FA8F4',
  blueSoft: 'rgba(111, 168, 244, 0.16)',
  blueInk: '#B7D2F9',
};

export const PALETTES: Record<Theme, Palette> = { light: LIGHT, dark: DARK };

export const space = {
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s5: 20,
  s6: 24,
  s7: 32,
  s8: 40,
  s9: 56,
  s10: 80,
} as const;

// Slightly larger radii on mobile for the iOS feel (per the design handoff
// note: "Mobile screens tend to use slightly larger radii (12 → 14, 16 → 18)").
export const radius = {
  r1: 4,
  r2: 8,
  r3: 10,
  r4: 14,
  r5: 18,
  r6: 24,
  pill: 999,
} as const;

export const type = {
  display: 'Geist-SemiBold',
  display500: 'Geist-Medium',
  body: 'Geist-Regular',
  bodyMedium: 'Geist-Medium',
  mono: 'GeistMono-Regular',
  monoMedium: 'GeistMono-Medium',
} as const;

export const fontSize = {
  caption: 11.5,
  micro: 12,
  body: 14,
  bodyLg: 15,
  lead: 16,
  h3: 18,
  h2: 22,
  h1: 28,
  display: 44,
} as const;

export function getSystemTheme(): Theme {
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}
