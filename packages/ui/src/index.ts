// @openthink/ui — shared React primitives + design tokens contract.
// Real components (Button, Pill, Card, Sheet, DiffView wrapper around @pierre/diffs)
// land in iteration 3 when we extract them from the platform app.

export const TOKENS = {
  bg: 'var(--ot-bg)',
  bgCard: 'var(--ot-bg-card)',
  bgSoft: 'var(--ot-bg-soft)',
  ink: 'var(--ot-ink)',
  inkSoft: 'var(--ot-ink-soft)',
  inkMute: 'var(--ot-ink-mute)',
  accent: 'var(--ot-accent)',
  accentDeep: 'var(--ot-accent-deep)',
} as const;

export type TokenName = keyof typeof TOKENS;
