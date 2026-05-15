import { useState } from 'react';
import './PlanCard.css';

export interface PlanStep {
  id: string;
  title: string;
  body: string;
  tool?: string;
  requiresApproval?: boolean;
  status?: 'pending' | 'running' | 'done' | 'error';
}

interface Props {
  steps: PlanStep[];
  showAsJsx?: boolean;
  onApproveAll: () => void;
  onStepByStep: () => void;
  onCancel: () => void;
  onEdit: (id: string, patch: Partial<PlanStep>) => void;
  onDelete: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onAddStep: () => void;
  onToggleJsx: () => void;
}

export function PlanCard({
  steps,
  showAsJsx = false,
  onApproveAll,
  onStepByStep,
  onCancel,
  onEdit,
  onDelete,
  onReorder,
  onAddStep,
  onToggleJsx,
}: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  if (showAsJsx) {
    return (
      <div className="plan-card plan-card--jsx">
        <header className="plan-card__header">
          <h3>Plan as Smithers JSX</h3>
          <button className="plan-card__view-toggle" onClick={onToggleJsx} aria-pressed="true">
            &lt;/&gt; JSX
          </button>
        </header>
        <pre className="plan-card__jsx">{renderAsJsx(steps)}</pre>
        <footer className="plan-card__actions">
          <button className="ot-btn" onClick={onApproveAll}>
            Approve all
          </button>
          <button className="ot-btn ot-btn--ghost" onClick={onStepByStep}>
            Step-by-step
          </button>
          <button className="plan-card__cancel" onClick={onCancel}>
            Cancel
          </button>
        </footer>
      </div>
    );
  }

  return (
    <div className="plan-card">
      <header className="plan-card__header">
        <h3>
          Plan <span className="plan-card__count">{steps.length} steps</span>
        </h3>
        <button className="plan-card__view-toggle" onClick={onToggleJsx} aria-pressed="false">
          &lt;/&gt; JSX
        </button>
      </header>
      <ol className="plan-card__steps">
        {steps.map((s, i) => (
          <li
            key={s.id}
            className={`plan-step plan-step--${s.status ?? 'pending'}${over === s.id ? ' plan-step--over' : ''}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              setDragging(s.id);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(s.id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging && dragging !== s.id) {
                const ordered = steps.map((x) => x.id).filter((id) => id !== dragging);
                const targetIdx = ordered.indexOf(s.id);
                ordered.splice(targetIdx, 0, dragging);
                onReorder(ordered);
              }
              setDragging(null);
              setOver(null);
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
          >
            <span className="plan-step__num">{circled(i + 1)}</span>
            <div className="plan-step__body">
              <div className="plan-step__title">{s.title}</div>
              <div className="plan-step__desc">{s.body}</div>
              {s.tool && <div className="plan-step__tool">→ {s.tool}</div>}
              {s.requiresApproval && (
                <div className="plan-step__pill">
                  <span className="ot-pill ot-pill--accent">approval required</span>
                </div>
              )}
            </div>
            <div className="plan-step__controls">
              <button
                className="plan-step__icon"
                aria-label="Edit step"
                onClick={() => {
                  const next = prompt('Edit step', s.title);
                  if (next) onEdit(s.id, { title: next });
                }}
              >
                ✎
              </button>
              <button
                className="plan-step__icon"
                aria-label="Delete step"
                onClick={() => onDelete(s.id)}
              >
                ×
              </button>
              <span className="plan-step__handle" aria-hidden>
                ☰
              </span>
            </div>
          </li>
        ))}
      </ol>
      <div className="plan-card__add">
        <button className="plan-card__add-btn" onClick={onAddStep}>
          + Add step
        </button>
      </div>
      <footer className="plan-card__actions">
        <button className="ot-btn" onClick={onApproveAll}>
          Approve all
        </button>
        <button className="ot-btn ot-btn--ghost" onClick={onStepByStep}>
          Step-by-step
        </button>
        <button className="plan-card__cancel" onClick={onCancel}>
          Cancel
        </button>
      </footer>
    </div>
  );
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫'];
function circled(n: number): string {
  return CIRCLED[n - 1] ?? `${n}.`;
}

function renderAsJsx(steps: PlanStep[]): string {
  // Surface the steps in their JSX-component form. This matches the
  // workflow.tsx shape emitted by saved skills (see packages/workflows). The
  // round-trip from prose plan → JSX → Cloudflare Workflow lands in iteration 7.
  const indented = steps
    .map(
      (s) => `      <Task id="${s.id}" agent={researcher}>
        {\`${s.body.replace(/`/g, '\\`')}\`}
      </Task>`,
    )
    .join('\n');
  return `import { Sequence, Task } from "smithers-orchestrator";

export default smithers((ctx) => (
  <Workflow name="trained-plan" cache>
    <Sequence>
${indented}
    </Sequence>
  </Workflow>
));
`;
}
