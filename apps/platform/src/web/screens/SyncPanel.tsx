import { useEffect, useState } from 'react';
import './SyncPanel.css';

export interface SyncStatus {
  upstreamSha: string;
  localSha: string;
  ahead: number;
  behind: number;
  summary: string;
  lastChecked: number;
  commits: Array<{
    sha: string;
    author: string;
    message: string;
    ts: number;
  }>;
  recentPRs: Array<{
    number: number;
    title: string;
    url: string;
    state: 'open' | 'merged' | 'closed';
    openedAt: number;
  }>;
}

export function SyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [pulling, setPulling] = useState(false);
  const [dryRun, setDryRun] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/sync/status')
      .then((r) => r.json())
      .then((s: SyncStatus) => setStatus(s))
      .catch(() => setStatus(FALLBACK_STATUS));
  }, []);

  const handlePull = async () => {
    setPulling(true);
    try {
      const res = await fetch('/api/sync/pull', { method: 'POST' });
      const data = (await res.json()) as { ok: boolean; diff?: string };
      if (data.ok && data.diff) {
        setDryRun(data.diff);
      }
    } catch (err) {
      console.error('[sync] pull failed', err);
    } finally {
      setPulling(false);
    }
  };

  if (!status) {
    return (
      <div className="sync-panel">
        <p className="ot-micro">Checking upstream…</p>
      </div>
    );
  }

  const inSync = status.behind === 0 && status.ahead === 0;
  return (
    <div className="sync-panel">
      <header className="sync-panel__head">
        {inSync ? (
          <span className="ot-pill ot-pill--good">up to date</span>
        ) : (
          <span className="ot-pill ot-pill--accent">{status.behind} behind upstream</span>
        )}
        <span className="ot-micro">
          last checked {Math.round((Date.now() - status.lastChecked) / 60_000)} min ago
        </span>
      </header>

      <p className="sync-panel__summary">{status.summary}</p>

      {status.commits.length > 0 && (
        <div className="sync-panel__commits">
          <span className="ot-label">Recent upstream commits</span>
          <ul>
            {status.commits.map((c) => (
              <li key={c.sha} className="sync-commit">
                <code className="sync-commit__sha">{c.sha.slice(0, 7)}</code>
                <span className="sync-commit__msg">{c.message}</span>
                <span className="sync-commit__author">{c.author}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="sync-panel__actions">
        <button className="ot-btn" disabled={inSync || pulling} onClick={handlePull}>
          {pulling ? 'Running dry-run…' : 'Pull latest'}
        </button>
        <button className="ot-btn ot-btn--ghost">Configure schedule</button>
      </div>

      {dryRun && (
        <div className="sync-panel__diff" role="dialog" aria-label="Dry-run diff">
          <header>
            <span className="ot-label">Dry-run · what will change</span>
            <button className="sync-panel__close" onClick={() => setDryRun(null)} aria-label="Close diff">
              ×
            </button>
          </header>
          <pre>
            {dryRun.split('\n').map((line, i) => {
              const cls = line.startsWith('+++')
                ? 'diff--file'
                : line.startsWith('---')
                  ? 'diff--file'
                  : line.startsWith('+')
                    ? 'diff--add'
                    : line.startsWith('-')
                      ? 'diff--del'
                      : line.startsWith('@@')
                        ? 'diff--hunk'
                        : 'diff--ctx';
              return (
                <span key={i} className={cls}>
                  {line + '\n'}
                </span>
              );
            })}
          </pre>
          <footer>
            <button className="ot-btn">Apply &amp; redeploy</button>
            <button className="ot-btn ot-btn--ghost" onClick={() => setDryRun(null)}>
              Cancel
            </button>
          </footer>
        </div>
      )}

      <div className="sync-panel__prs">
        <span className="ot-label">Pull requests this agent has opened upstream</span>
        {status.recentPRs.length === 0 ? (
          <p className="ot-micro">None yet. Run a Train-mode session that produces a generic skill to surface a contribution candidate.</p>
        ) : (
          <ul>
            {status.recentPRs.map((pr) => (
              <li key={pr.number} className={`sync-pr sync-pr--${pr.state}`}>
                <a href={pr.url} target="_blank" rel="noreferrer">
                  #{pr.number}
                </a>
                <span>{pr.title}</span>
                <span className="ot-pill">{pr.state}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const FALLBACK_STATUS: SyncStatus = {
  upstreamSha: 'e593b06',
  localSha: 'e593b06',
  ahead: 0,
  behind: 0,
  summary: 'You are on the latest upstream version of openthink3.',
  lastChecked: Date.now(),
  commits: [],
  recentPRs: [],
};
