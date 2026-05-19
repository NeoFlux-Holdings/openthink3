// Keyboard shortcuts cheat sheet — opens on `?` from anywhere outside an
// input. Esc dismisses. Single source of truth for the shortcuts the rest
// of the app implements; if a binding changes elsewhere, update the entry
// here so the help stays honest.

import { useEffect } from 'react';
import './ShortcutsHelp.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

// Detect Mac so we render ⌘ vs Ctrl correctly. Falls back to Ctrl on
// platforms we can't sniff (server-rendered, exotic browsers).
const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl';

interface ShortcutGroup {
  title: string;
  rows: Array<{ keys: string[]; desc: string }>;
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Global',
    rows: [
      { keys: [mod, 'K'], desc: 'Open command palette' },
      { keys: ['/'], desc: 'Open command palette (alt)' },
      { keys: [mod, 'Shift', 'N'], desc: 'New thread (from anywhere)' },
      { keys: ['?'], desc: 'This shortcuts panel' },
      { keys: ['Esc'], desc: 'Close any modal / go back in onboarding' },
    ],
  },
  {
    title: 'Chat',
    rows: [
      { keys: ['Enter'], desc: 'Send the message' },
      { keys: ['Shift', 'Enter'], desc: 'Newline in composer' },
      { keys: ['/goal', 'text'], desc: 'Kick off a long-running goal' },
      { keys: ['@'], desc: 'Autocomplete a skill name' },
      { keys: ['↑', '↓'], desc: 'Walk autocomplete suggestions' },
    ],
  },
  {
    title: 'Canvas',
    rows: [
      { keys: ['Tab'], desc: 'Focus the thumbnail strip' },
      { keys: ['←', '→'], desc: 'Walk between artifacts (single mode)' },
      { keys: ['Home', 'End'], desc: 'First / last artifact' },
    ],
  },
  {
    title: 'Library',
    rows: [
      { keys: ['Tab'], desc: 'Focus a tile' },
      { keys: ['←', '→', '↑', '↓'], desc: 'Walk the tile grid (column-aware)' },
      { keys: ['Home', 'End'], desc: 'First / last tile' },
      { keys: ['Enter', 'Space'], desc: 'Open the focused tile' },
      { keys: [mod, 'A'], desc: 'Select every visible tile (in Select mode)' },
      { keys: ['Esc'], desc: 'Close artifact viewer / exit Select mode' },
    ],
  },
  {
    title: 'Workspaces',
    rows: [
      { keys: ['Tab'], desc: 'Focus a workspace card' },
      { keys: ['↑', '↓'], desc: 'Walk the list' },
      { keys: ['Home', 'End'], desc: 'First / last workspace' },
      { keys: ['Enter', 'Space'], desc: 'Switch to focused workspace' },
      { keys: ['P'], desc: 'Toggle pin on the focused workspace' },
    ],
  },
  {
    title: 'Skills',
    rows: [
      { keys: ['Tab'], desc: 'Focus a skill row' },
      { keys: ['↑', '↓'], desc: 'Walk the list' },
      { keys: ['Enter', 'Space'], desc: 'Toggle the skill on/off' },
      { keys: ['T'], desc: 'Open the inline match-tester' },
    ],
  },
  {
    title: 'Sidebar',
    rows: [
      { keys: ['Tab'], desc: 'Focus the first thread' },
      { keys: ['↑', '↓'], desc: 'Walk threads (pinned + recent in order)' },
      { keys: ['Home', 'End'], desc: 'First / last thread' },
      { keys: ['Enter'], desc: 'Open the focused thread' },
      { keys: ['Click +'], desc: 'New thread' },
      { keys: ['Click ×'], desc: 'Archive thread (on hover)' },
      { keys: ['Type to filter'], desc: 'When 3+ threads' },
    ],
  },
  {
    title: 'Settings',
    rows: [
      { keys: [']'], desc: 'Next tab (also: k)' },
      { keys: ['['], desc: 'Previous tab (also: j)' },
      { keys: ['Click filter badge'], desc: 'Clear that tab\'s filters' },
    ],
  },
];

export function ShortcutsHelp({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="shortcuts" role="dialog" aria-label="Keyboard shortcuts">
      <button
        type="button"
        className="shortcuts__scrim"
        aria-label="Close shortcuts"
        onClick={onClose}
      />
      <div className="shortcuts__panel">
        <header className="shortcuts__head">
          <h3>Keyboard shortcuts</h3>
          <button type="button" className="shortcuts__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="shortcuts__body">
          {GROUPS.map((g) => (
            <section key={g.title} className="shortcuts__group">
              <h4 className="shortcuts__group-title">{g.title}</h4>
              <ul>
                {g.rows.map((r, i) => (
                  <li key={i}>
                    <span className="shortcuts__keys">
                      {r.keys.map((k, j) => (
                        <span key={j}>
                          {j > 0 && <span className="shortcuts__plus">+</span>}
                          <kbd className="shortcuts__kbd">{k}</kbd>
                        </span>
                      ))}
                    </span>
                    <span className="shortcuts__desc">{r.desc}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <footer className="shortcuts__foot">
          <span className="ot-micro">
            Press <kbd className="shortcuts__kbd shortcuts__kbd--inline">?</kbd> anytime to re-open this panel.
          </span>
        </footer>
      </div>
    </div>
  );
}
