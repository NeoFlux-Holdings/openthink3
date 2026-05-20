/* Mobile pairing — shown to a signed-in user on their laptop when their
 * phone wants to connect. They tap "Authorize this device", see a 6-letter
 * code, and type it into the Expo app. The mobile app trades the code for a
 * bearer token via /api/mobile/session/exchange.
 *
 * Reached via `https://<agent>.openthink.run/mobile/pair?device=<label>`.
 */
import { useCallback, useEffect, useState } from 'react';

import type { AppFlowState } from '../App';
import { Icon } from '../shell/Icon';

interface Props {
  flow: AppFlowState;
}

export function MobilePair({ flow }: Props) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? window.location.search);
  const deviceLabel = params.get('device') ?? 'mobile device';
  const [code, setCode] = useState<string | null>(null);
  const [expiresInSec, setExpiresInSec] = useState<number | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const issue = useCallback(async () => {
    setIssuing(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch('/api/mobile/pair/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName: flow.agentName }),
      });
      const data = (await res.json()) as { code?: string; expiresInSec?: number; error?: string };
      if (!res.ok || !data.code) {
        setError(data.error ?? 'pair_failed');
      } else {
        setCode(data.code);
        setExpiresInSec(data.expiresInSec ?? 300);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network');
    } finally {
      setIssuing(false);
    }
  }, [flow.agentName]);

  // Countdown tick — visual only, the actual expiry happens in KV TTL.
  useEffect(() => {
    if (!expiresInSec) return;
    const t = window.setInterval(() => {
      setExpiresInSec((s) => (s == null ? null : Math.max(0, s - 1)));
    }, 1000);
    return () => window.clearInterval(t);
  }, [expiresInSec]);

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* fail quietly */
    }
  };

  return (
    <div className="onb" style={{ gridTemplateColumns: '1fr' }} data-screen-label="Mobile pair">
      <main className="onb-main scroll">
        <div className="onb-content" style={{ maxWidth: 460 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>pair a device</div>
          <h1>Authorize {deviceLabel}.</h1>
          <p className="lead">
            Your mobile app is asking to connect to <strong>{flow.agentName || 'your agent'}</strong>.
            Make sure this came from you — then issue a one-time code below.
          </p>

          {!code && (
            <div className="info-note" style={{ marginTop: 24 }}>
              <div className="icw"><Icon name="shield" size={12} /></div>
              <div className="body">
                <strong>Codes expire in 5 minutes.</strong>
                The code lets your phone exchange it for a long-lived bearer token. We never see
                the token — it&apos;s stored in your Worker&apos;s KV.
              </div>
            </div>
          )}

          {!code && (
            <button className="btn brand lg" type="button" onClick={issue} disabled={issuing}>
              {issuing ? 'Issuing…' : 'Issue a pairing code'} <Icon name="arrow_right" size={13} />
            </button>
          )}

          {code && (
            <div className="card" style={{ padding: 28, marginTop: 24, textAlign: 'center' }}>
              <div className="eyebrow" style={{ marginBottom: 12 }}>your code</div>
              <button
                type="button"
                onClick={copyCode}
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 42,
                  letterSpacing: '0.32em',
                  color: 'var(--ink)',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--rule)',
                  borderRadius: 12,
                  padding: '18px 12px',
                  width: '100%',
                  cursor: 'pointer',
                }}
                title="Copy to clipboard"
              >
                {code}
              </button>
              <div className="muted" style={{ marginTop: 12, fontSize: 12.5 }}>
                {copied ? 'Copied to clipboard.' : 'Type or paste this in the OpenThink mobile app.'}
              </div>
              {expiresInSec != null && (
                <div className="mono muted" style={{ marginTop: 16, fontSize: 11 }}>
                  expires in {Math.floor(expiresInSec / 60)}:
                  {(expiresInSec % 60).toString().padStart(2, '0')}
                </div>
              )}
              <div style={{ marginTop: 22, display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button className="btn sm" type="button" onClick={issue} disabled={issuing}>
                  Issue a new code
                </button>
                <a className="btn sm" href="#/settings">Done</a>
              </div>
            </div>
          )}

          {error && (
            <div className="chip red" style={{ marginTop: 16 }}>
              <Icon name="x" size={11} /> {error}
            </div>
          )}

          <div className="muted" style={{ fontSize: 12, marginTop: 28, lineHeight: 1.55 }}>
            See the device on your phone you didn&apos;t expect? Don&apos;t issue a code — revoke
            any active tokens from <a href="#/settings" style={{ color: 'var(--brand)' }}>Settings → Devices</a>.
          </div>
        </div>
      </main>
    </div>
  );
}
