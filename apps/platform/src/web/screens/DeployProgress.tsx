import { useEffect, useRef, useState } from 'react';

import type { AppFlowState } from '../App';
import type { DeployState, DeployStep } from '@shared/types';
import './DeployProgress.css';

interface Props {
  flow: AppFlowState;
  merge: (patch: Partial<AppFlowState>) => void;
  next: () => void;
}

const STATE_GLYPH: Record<DeployStep['state'], string> = {
  pending: '○',
  running: '◐',
  done: '●',
  error: '⊗',
};

export function DeployProgress({ flow, next }: Props) {
  const [state, setState] = useState<DeployState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!flow.deployId) return;
    const url = `/api/deploy/${flow.deployId}/stream`;
    const es = new EventSource(url);

    es.addEventListener('snapshot', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as DeployState;
      setState(data);
      startRef.current = data.startedAt;
    });

    es.addEventListener('step', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { index: number; state: DeployStep };
      setState((prev) =>
        prev
          ? {
              ...prev,
              steps: prev.steps.map((s, i) => (i === data.index ? data.state : s)),
            }
          : prev,
      );
    });

    es.addEventListener('done', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as DeployState;
      setState(data);
      setFinished(true);
      es.close();
    });

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [flow.deployId]);

  useEffect(() => {
    if (finished) return;
    const id = window.setInterval(() => setElapsed(Date.now() - startRef.current), 200);
    return () => window.clearInterval(id);
  }, [finished]);

  const hostname = state?.hostname ?? `${flow.agentName}.workers.dev`;
  const elapsedSec = (elapsed / 1000).toFixed(elapsed > 10_000 ? 0 : 1);
  const filledPct = state
    ? (state.steps.filter((s) => s.state === 'done').length / state.steps.length) * 100
    : 0;

  return (
    <div className="deploy">
      <header className="ot-topbar">
        <div className="ot-container ot-topbar-inner">
          <a href="#" className="ot-brand">
            <span className="ot-brand-dot" /> OpenThink
          </a>
          <span className="ot-micro">deploying · {flow.agentName}</span>
        </div>
      </header>

      <main className="deploy__main">
        {!finished ? (
          <div className="deploy__card" aria-live="polite">
            <h2 className="deploy__title">Deploying {flow.agentName}</h2>
            <div className="deploy__timeline">
              <div className="deploy__rail" style={{ '--filled': `${filledPct}%` } as React.CSSProperties}>
                <div className="deploy__rail-fill" />
              </div>
              <ol className="deploy__steps">
                {state?.steps.map((s) => (
                  <li key={s.id} className={`deploy__step deploy__step--${s.state}`}>
                    <span className="deploy__glyph" aria-hidden>
                      {STATE_GLYPH[s.state]}
                    </span>
                    <span className="deploy__label">{s.label}</span>
                    <span className="deploy__dur">
                      {s.state === 'done' && s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : ''}
                      {s.state === 'running' ? '…' : ''}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="deploy__footer">
              <span className="ot-micro">Live logs ▾</span>
              <span className="ot-micro">{elapsedSec}s elapsed</span>
            </div>
          </div>
        ) : (
          <div className="deploy__card deploy__card--done">
            <h2 className="deploy__title">Your agent is live.</h2>
            <div className="deploy__hostname">
              <code>{hostname}</code>
              <button
                className="deploy__copy"
                onClick={() => navigator.clipboard.writeText(hostname).catch(() => undefined)}
                aria-label="Copy hostname"
              >
                ⧉ copy
              </button>
            </div>
            <button className="ot-btn" onClick={next} style={{ marginTop: 16 }}>
              Say hi to your agent →
            </button>
            <div className="deploy__try">
              <h4>What to try first</h4>
              <ul>
                <li>"Plan my week"</li>
                <li>"Research the agent ecosystem in 2026"</li>
                <li>"Build me a personal homepage"</li>
              </ul>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
