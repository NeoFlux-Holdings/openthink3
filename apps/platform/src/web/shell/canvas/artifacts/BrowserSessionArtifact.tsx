import { useEffect, useState } from 'react';

interface Payload {
  sessionId: string;
  url: string;
  title?: string;
  status: 'idle' | 'navigating' | 'streaming' | 'paused' | 'closed';
  takenOver: boolean;
  framePngBase64?: string;
  recentActions?: string[];
}

interface Props {
  payload: Payload;
  compact?: boolean;
}

export function BrowserSessionArtifact({ payload, compact }: Props) {
  const [takeover, setTakeover] = useState(payload.takenOver);
  const [paused, setPaused] = useState(payload.status === 'paused');

  // Iteration 5 wires this to the real BrowserSession DO WS feed.
  // For now we show the static frame, the chrome bar, and the controls that
  // will drive the live session — see worker/agents/browser-session.ts.
  useEffect(() => {
    setTakeover(payload.takenOver);
    setPaused(payload.status === 'paused');
  }, [payload.takenOver, payload.status]);

  return (
    <div className={`artifact-browser${compact ? ' artifact-browser--compact' : ''}`}>
      {!compact && (
        <div className="artifact-browser__chrome">
          <div className="artifact-browser__nav">
            <button aria-label="Back">◀</button>
            <button aria-label="Forward">▶</button>
            <button aria-label="Reload">🔄</button>
          </div>
          <div className="artifact-browser__url">{payload.url}</div>
          <div className="artifact-browser__actions">
            <button aria-label="Screenshot">📷</button>
            <button
              className={paused ? 'is-on' : ''}
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? '▶ resume' : '⏸ pause'}
            </button>
            <button
              className={takeover ? 'is-on' : ''}
              onClick={() => setTakeover((t) => !t)}
            >
              {takeover ? '↪ hand back' : '☝ take over'}
            </button>
          </div>
        </div>
      )}
      <div className="artifact-browser__viewport">
        {payload.framePngBase64 ? (
          <img src={`data:image/png;base64,${payload.framePngBase64}`} alt={payload.title ?? payload.url} />
        ) : (
          <div className="artifact-browser__placeholder">
            <div className="artifact-browser__placeholder-glyph">🌐</div>
            <div className="artifact-browser__placeholder-url">{payload.url}</div>
            <div className="artifact-browser__placeholder-state">
              {payload.status === 'closed' ? 'Session closed' : 'Waiting for first frame…'}
            </div>
          </div>
        )}
        {takeover && <div className="artifact-browser__takeover-banner">you have control · click "hand back" to resume agent</div>}
      </div>
      {!compact && (
        <div className="artifact-browser__statusbar">
          <span>
            {payload.recentActions?.[payload.recentActions.length - 1] ??
              `agent is ${payload.status}`}
          </span>
          <span className="ot-micro">session {payload.sessionId}</span>
        </div>
      )}
      <style>{`
        .artifact-browser { display: flex; flex-direction: column; height: 100%; background: #2b2825; color: #e5e0d3; }
        .artifact-browser__chrome { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; padding: 8px 12px; background: #1f1c19; border-bottom: 1px solid #38332e; align-items: center; }
        .artifact-browser__nav { display: inline-flex; gap: 4px; }
        .artifact-browser__nav button { width: 24px; height: 24px; border-radius: 4px; color: #beb8aa; font-size: 11px; }
        .artifact-browser__nav button:hover { background: rgba(255,255,255,0.06); color: #fff; }
        .artifact-browser__url { background: #2b2825; padding: 4px 12px; border-radius: 12px; font-family: var(--ot-font-mono); font-size: 11px; color: #d6cebd; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .artifact-browser__actions { display: inline-flex; gap: 4px; }
        .artifact-browser__actions button { padding: 4px 10px; border-radius: 4px; font-size: 11px; color: #beb8aa; }
        .artifact-browser__actions button:hover { background: rgba(255,255,255,0.06); color: #fff; }
        .artifact-browser__actions button.is-on { background: var(--ot-accent); color: white; }
        .artifact-browser__viewport { flex: 1; position: relative; background: #15140f; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .artifact-browser__viewport img { width: 100%; height: 100%; object-fit: contain; background: white; }
        .artifact-browser__placeholder { text-align: center; color: #6d6960; }
        .artifact-browser__placeholder-glyph { font-size: 40px; margin-bottom: 8px; }
        .artifact-browser__placeholder-url { font-family: var(--ot-font-mono); font-size: 12px; margin-bottom: 4px; }
        .artifact-browser__placeholder-state { font-size: 11px; color: #4f4c46; }
        .artifact-browser__takeover-banner { position: absolute; top: 12px; left: 12px; right: 12px; background: rgba(232,93,74,0.9); color: white; padding: 6px 10px; border-radius: 6px; font-size: 12px; text-align: center; }
        .artifact-browser__statusbar { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; background: #1f1c19; border-top: 1px solid #38332e; font-size: 11px; color: #beb8aa; }
        .artifact-browser--compact .artifact-browser__viewport { min-height: 120px; }
      `}</style>
    </div>
  );
}
