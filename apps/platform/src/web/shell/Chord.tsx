/* Platform-aware keyboard helpers.
 *
 * Renders shortcuts the way the host OS expects:
 *   <Chord mod>K</Chord>          → ⌘K on Mac, Ctrl+K on Windows/Linux
 *   <Chord mod shift>N</Chord>    → ⌘⇧N / Ctrl+Shift+N
 *
 * The `flattenKey` helper accepts string or React children so callers can pass
 * either `"K"` or `<>K</>` and we still produce a clean single-character key.
 */
import type { ReactNode } from 'react';

export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';
export const SHIFT_KEY = IS_MAC ? '⇧' : 'Shift';
export const ALT_KEY = IS_MAC ? '⌥' : 'Alt';
export const RET_KEY = IS_MAC ? '↵' : 'Enter';

function flattenKey(node: ReactNode): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenKey).join('');
  if (typeof node === 'object' && 'props' in node && (node as { props?: { children?: ReactNode } }).props?.children !== undefined) {
    return flattenKey((node as { props: { children: ReactNode } }).props.children);
  }
  return '';
}

export function Kbd({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={['kbd', className].filter(Boolean).join(' ')}>{children}</span>;
}

export function Chord({
  mod,
  shift,
  alt,
  children,
  className = '',
}: {
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const key = flattenKey(children);
  if (IS_MAC) {
    return (
      <span className={['kbd', className].filter(Boolean).join(' ')}>
        {mod ? '⌘' : ''}
        {shift ? '⇧' : ''}
        {alt ? '⌥' : ''}
        {key}
      </span>
    );
  }
  const parts: string[] = [];
  if (mod) parts.push('Ctrl');
  if (shift) parts.push('Shift');
  if (alt) parts.push('Alt');
  parts.push(key);
  return (
    <span className={['kbd', className].filter(Boolean).join(' ')}>{parts.join('+')}</span>
  );
}
