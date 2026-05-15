// Library screen — grid of all artifacts across threads. PRD §11.
// First pass: pulls from the seed dataset and renders thumbnail cards. Real
// pagination + filters arrive when the artifact registry (D1 + R2) is wired.

import { SEED_ARTIFACTS } from '../shell/seed-artifacts';
import './Library.css';

interface Props {
  agentName: string;
  onOpen: (id: string) => void;
}

export function Library({ agentName, onOpen }: Props) {
  return (
    <div className="library">
      <header className="library__header">
        <h2>Library</h2>
        <p className="library__lede">Every artifact {agentName} has ever made.</p>
      </header>
      <div className="library__filters">
        <button className="library__filter library__filter--active">All</button>
        <button className="library__filter">Documents</button>
        <button className="library__filter">Code</button>
        <button className="library__filter">Browser sessions</button>
        <button className="library__filter">Slides</button>
        <button className="library__filter">Charts</button>
        <input className="ot-input library__search" placeholder="Search…" />
      </div>
      <div className="library__grid">
        {SEED_ARTIFACTS.map((a) => (
          <button key={a.id} className="library__tile" onClick={() => onOpen(a.id)}>
            <div className="library__tile-thumb">
              <span className="library__tile-glyph" aria-hidden>
                {GLYPHS[a.type] ?? '◇'}
              </span>
            </div>
            <div className="library__tile-meta">
              <span className="library__tile-title">{a.title}</span>
              <span className="library__tile-sub">
                {a.type} · v{a.version}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

const GLYPHS: Record<string, string> = {
  document: '📄',
  code: '⟨ ⟩',
  table: '⌗',
  chart: '◧',
  image: '🖼',
  slides: '▤',
  webpage: '◰',
  'browser-session': '🌐',
};
