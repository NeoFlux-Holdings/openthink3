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
  const [liveFrame, setLiveFrame] = useState<string | null>(payload.framePngBase64 ?? null);
  const [liveStatus, setLiveStatus] = useState<Payload['status']>(payload.status);
  const [liveActions, setLiveActions] = useState<string[]>(payload.recentActions ?? []);
  const [placeholderReason, setPlaceholderReason] = useState<string | null>(null);
  // Rolling filmstrip of recent frames. Capped at 8 entries; the
  // viewport renders `liveFrame` (always the latest unless the user
  // has clicked a thumbnail, in which case we show the picked frame
  // until they click "live" to resume). Each entry holds the base64
  // PNG + the timestamp it landed for the hover-title.
  const [frameHistory, setFrameHistory] = useState<
    Array<{ png: string; at: number }>
  >(payload.framePngBase64
    ? [{ png: payload.framePngBase64, at: Date.now() }]
    : []);
  const [viewedFrame, setViewedFrame] = useState<number | null>(null);
  const FRAME_CAP = 8;

  useEffect(() => {
    setTakeover(payload.takenOver);
    setPaused(payload.status === 'paused');
  }, [payload.takenOver, payload.status]);

  // Real-time WS feed from BrowserSession DO. Frames come in as base64 PNG
  // strings; takeover/pause commands flow back out the same socket. When
  // the BROWSER binding is unbound (local miniflare), the DO emits
  // `{placeholder: 'binding_unavailable', pngBase64: null}` frames instead,
  // which we use to surface a friendlier "Browser Rendering offline" note.
  useEffect(() => {
    if (!payload.sessionId) return;
    const url = new URL(`/api/browser/${payload.sessionId}/ws`, window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.warn('[browser-session] ws construct failed', err);
      return;
    }
    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(typeof evt.data === 'string' ? evt.data : '') as {
          type: string;
          pngBase64?: string | null;
          placeholder?: string;
          state?: { status?: Payload['status']; recentActions?: string[] };
        };
        if (data.type === 'frame') {
          if (data.pngBase64) {
            setLiveFrame(data.pngBase64);
            setPlaceholderReason(null);
            // Append to the filmstrip; capped at the most recent N.
            // Drop near-identical consecutive frames so a static page
            // doesn't fill the strip with duplicates (cheap heuristic:
            // first 64 chars of base64 match).
            setFrameHistory((prev) => {
              const png = data.pngBase64 as string;
              const last = prev[prev.length - 1];
              if (last && last.png.slice(0, 64) === png.slice(0, 64)) {
                return prev;
              }
              const next = [...prev, { png, at: Date.now() }];
              return next.length > FRAME_CAP
                ? next.slice(next.length - FRAME_CAP)
                : next;
            });
          } else if (data.placeholder) {
            setPlaceholderReason(data.placeholder);
          }
        } else if (data.type === 'state' && data.state) {
          if (data.state.status) setLiveStatus(data.state.status);
          if (Array.isArray(data.state.recentActions)) setLiveActions(data.state.recentActions);
        }
      } catch {
        /* drop malformed frames */
      }
    };
    return () => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };
  }, [payload.sessionId]);

  const sendControl = (type: 'pause' | 'resume' | 'takeover', extra?: Record<string, unknown>) => {
    try {
      const url = new URL(`/api/browser/${payload.sessionId}/ws`, window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const probe = new WebSocket(url);
      probe.onopen = () => {
        probe.send(JSON.stringify({ type, ...extra }));
        probe.close();
      };
    } catch {
      /* offline */
    }
  };

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
              onClick={() => {
                setPaused((p) => {
                  const next = !p;
                  sendControl(next ? 'pause' : 'resume');
                  return next;
                });
              }}
            >
              {paused ? '▶ resume' : '⏸ pause'}
            </button>
            <button
              className={takeover ? 'is-on' : ''}
              onClick={() => {
                setTakeover((t) => {
                  const next = !t;
                  sendControl('takeover', { takeover: next });
                  return next;
                });
              }}
            >
              {takeover ? '↪ hand back' : '☝ take over'}
            </button>
          </div>
        </div>
      )}
      <div className="artifact-browser__viewport">
        {(() => {
          // Choose what to render: the user's picked-from-strip frame
          // when set, otherwise the latest live frame.
          const shownFrame =
            viewedFrame !== null && frameHistory[viewedFrame]
              ? frameHistory[viewedFrame]!.png
              : liveFrame;
          if (!shownFrame) {
            return (
              <div className="artifact-browser__placeholder">
                <div className="artifact-browser__placeholder-glyph">🌐</div>
                <div className="artifact-browser__placeholder-url">{payload.url}</div>
                <div className="artifact-browser__placeholder-state">
                  {placeholderReason === 'binding_unavailable'
                    ? 'Browser Rendering binding offline — install @cloudflare/puppeteer + uncomment [browser]'
                    : liveStatus === 'closed'
                      ? 'Session closed'
                      : 'Waiting for first frame…'}
                </div>
              </div>
            );
          }
          return (
            <img
              src={`data:image/png;base64,${shownFrame}`}
              alt={payload.title ?? payload.url}
            />
          );
        })()}
        {viewedFrame !== null && (
          <button
            type="button"
            className="artifact-browser__live-jump"
            onClick={() => setViewedFrame(null)}
            title="Return to live view"
          >
            ↻ live
          </button>
        )}
        {takeover && <div className="artifact-browser__takeover-banner">you have control · click "hand back" to resume agent</div>}
      </div>
      {!compact && frameHistory.length > 1 && (
        <div
          className="artifact-browser__filmstrip"
          role="listbox"
          aria-label="Recent browser frames"
        >
          {frameHistory.map((f, i) => {
            const isLatest = i === frameHistory.length - 1;
            const isPicked =
              viewedFrame === null ? isLatest : viewedFrame === i;
            return (
              <button
                key={`${f.at}-${i}`}
                type="button"
                role="option"
                aria-selected={isPicked}
                className={`artifact-browser__filmstrip-thumb${isPicked ? ' is-picked' : ''}`}
                onClick={() => setViewedFrame(isLatest ? null : i)}
                title={`Frame from ${new Date(f.at).toLocaleTimeString()}`}
              >
                <img src={`data:image/png;base64,${f.png}`} alt="" />
              </button>
            );
          })}
        </div>
      )}
      {!compact && (
        <div className="artifact-browser__statusbar">
          <span>
            {liveActions[liveActions.length - 1] ?? `agent is ${liveStatus}`}
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
        .artifact-browser__filmstrip { display: flex; gap: 4px; padding: 6px 8px; background: #1f1c19; border-top: 1px solid #38332e; overflow-x: auto; }
        .artifact-browser__filmstrip-thumb { flex: 0 0 auto; width: 64px; height: 40px; padding: 0; border-radius: 4px; border: 1px solid transparent; background: #15140f; overflow: hidden; cursor: pointer; transition: border-color 120ms ease-out, transform 120ms ease-out; }
        .artifact-browser__filmstrip-thumb:hover { border-color: rgba(232,93,74,0.45); transform: translateY(-1px); }
        .artifact-browser__filmstrip-thumb.is-picked { border-color: var(--ot-accent); }
        .artifact-browser__filmstrip-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .artifact-browser__live-jump { position: absolute; top: 10px; right: 12px; background: rgba(0,0,0,0.6); color: white; padding: 4px 10px; border-radius: 999px; font-size: 11px; cursor: pointer; }
        .artifact-browser__live-jump:hover { background: var(--ot-accent); }
      `}</style>
    </div>
  );
}
