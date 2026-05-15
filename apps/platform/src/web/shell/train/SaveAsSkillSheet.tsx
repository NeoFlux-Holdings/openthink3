import { useState } from 'react';
import './SaveAsSkillSheet.css';

interface Props {
  defaultName: string;
  defaultSummary: string;
  diffText: string;
  onSave: (name: string, summary: string) => void;
  onDismiss: () => void;
}

export function SaveAsSkillSheet({
  defaultName,
  defaultSummary,
  diffText,
  onSave,
  onDismiss,
}: Props) {
  const [name, setName] = useState(defaultName);
  const [summary, setSummary] = useState(defaultSummary);

  return (
    <div className="save-skill-sheet" role="dialog" aria-modal="true" aria-labelledby="save-skill-title">
      <div className="save-skill-sheet__head">
        <span className="save-skill-sheet__spark">✦</span>
        <h3 id="save-skill-title">Save this as a skill?</h3>
      </div>
      <div className="save-skill-sheet__fields">
        <label className="ot-label" htmlFor="skill-name">
          Suggested name
        </label>
        <input
          id="skill-name"
          className="ot-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="ot-label" htmlFor="skill-summary" style={{ marginTop: 12 }}>
          Summary
        </label>
        <input
          id="skill-summary"
          className="ot-input"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </div>
      <div className="save-skill-sheet__diff">
        <span className="ot-label">What will change</span>
        <pre>
          {diffText.split('\n').map((line, i) => {
            const cls = line.startsWith('+')
              ? 'diff--add'
              : line.startsWith('-')
                ? 'diff--del'
                : 'diff--ctx';
            return (
              <span key={i} className={cls}>
                {line + '\n'}
              </span>
            );
          })}
        </pre>
      </div>
      <footer className="save-skill-sheet__footer">
        <button className="ot-btn" onClick={() => onSave(name, summary)}>
          Save skill
        </button>
        <button className="ot-btn ot-btn--ghost" onClick={onDismiss}>
          Not now
        </button>
      </footer>
    </div>
  );
}
