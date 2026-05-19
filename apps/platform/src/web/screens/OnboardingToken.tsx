import { useCallback, useEffect, useState } from 'react';

import { OnboardingFrame } from './OnboardingIdentity';
import type { AppFlowState } from '../App';

interface Props {
  flow: AppFlowState;
  merge: (patch: Partial<AppFlowState>) => void;
  next: () => void;
  back?: () => void;
}

export function OnboardingToken({ flow, merge, next, back }: Props) {
  const [token, setToken] = useState(flow.cloudflareToken ?? '');
  const [subdomain, setSubdomain] = useState(flow.subdomain ?? flow.agentName);
  const [accessEmailsRaw, setAccessEmailsRaw] = useState(flow.accessEmails.join(', '));
  // Bubble local edits up to the parent's `flow` on every change so
  // hash-back to /fork (or any later forward navigation) doesn't lose
  // a half-typed token, subdomain, or extras list. `flow` lives in
  // the App and survives unmount — but it only gets these values via
  // `merge()`, so without this we drop them on remount.
  useEffect(() => {
    merge({ cloudflareToken: token || undefined });
    // We only persist the token when the user has actually typed
    // something so an empty draft doesn't trash a previously-saved
    // cloudflareToken value. eslint-disable to keep merge out of deps
    // (the parent's `merge` closure changes every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => {
    if (subdomain !== undefined) merge({ subdomain });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subdomain]);
  useEffect(() => {
    const arr = accessEmailsRaw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    merge({ accessEmails: arr });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessEmailsRaw]);
  const [tokenUrl, setTokenUrl] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyOk, setVerifyOk] = useState(false);

  useEffect(() => {
    void fetch(`/api/cf-token/url?name=${encodeURIComponent(`OpenThink — ${flow.agentName}`)}`)
      .then((r) => r.json())
      .then((data: { url: string }) => setTokenUrl(data.url))
      .catch(() => undefined);
  }, [flow.agentName]);

  // Shared verify path — takes a candidate token explicitly so paste-
  // detection can verify on-the-fly without waiting for the textarea
  // state to flush (React batches the setToken before this function
  // would see it via closure).
  const verifyToken = useCallback(async (candidate: string) => {
    if (!candidate) return;
    setVerifying(true);
    setVerifyError(null);
    setVerifyOk(false);
    try {
      const res = await fetch('/api/cf-token/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: candidate }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) setVerifyOk(true);
      else setVerifyError(data.error ?? 'verify_failed');
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'network');
    } finally {
      setVerifying(false);
    }
  }, []);

  const verify = useCallback(() => verifyToken(token), [token, verifyToken]);

  // Plausibility heuristic for "this paste looks like a CF API token":
  // Cloudflare User API tokens are 40 chars, base64-url-ish. We accept
  // ≥20 chars of [A-Za-z0-9_-] to avoid auto-firing on a wrong paste,
  // but stay loose enough to handle future token format tweaks.
  const looksLikeToken = (s: string) => /^[A-Za-z0-9_-]{20,}$/.test(s);

  const [autoPasted, setAutoPasted] = useState(false);
  const onPasteToken = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').trim();
    if (!looksLikeToken(pasted)) return;
    // Pre-empt the default paste so we land the cleaned value
    // immediately and can kick off verify in the same gesture.
    e.preventDefault();
    setToken(pasted);
    setAutoPasted(true);
    void verifyToken(pasted);
    // Reset the chip after a beat so it doesn't camp on screen.
    window.setTimeout(() => setAutoPasted(false), 1800);
  };

  const submit = () => {
    const accessEmails = accessEmailsRaw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    // Defer /api/deploy/start to the OnboardingUpgrades screen so it can
    // include workersPaid + customDomain in the payload (those steps are
    // injected dynamically by the worker based on what was picked).
    merge({ cloudflareToken: token, subdomain, accessEmails });
    next();
  };

  return (
    <OnboardingFrame
      step={3}
      of={3}
      title={`Connect ${flow.agentName || 'your agent'} to Cloudflare.`}
      subtitle="One token, the right scopes pre-filled. Paste, verify, ship."
      onBack={back}
    >
      <div className="onboarding__split onboarding__split-card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="onboarding__form"
        >
          <div className="onboarding__field">
            <label className="ot-label" htmlFor="cf-token">
              Cloudflare API token
            </label>
            <input
              id="cf-token"
              className="ot-input"
              type="password"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setVerifyOk(false);
              }}
              onPaste={onPasteToken}
              placeholder="cf_..."
              autoComplete="off"
            />
            <div className="onboarding__token-actions">
              <button
                type="button"
                className="ot-btn ot-btn--ghost"
                onClick={verify}
                disabled={!token || verifying}
              >
                {verifying ? 'Verifying…' : verifyOk ? '✓ Token works' : 'Verify token'}
              </button>
              {autoPasted && !verifyError && !verifyOk && (
                <span className="ot-micro onboarding__token-paste">
                  ✦ Pasted — validating…
                </span>
              )}
              {verifyError && (
                <span className="ot-micro" style={{ color: 'var(--ot-bad)' }}>
                  {verifyError === 'verify_failed'
                    ? 'Cloudflare rejected this token. Check scopes.'
                    : `Couldn't verify: ${verifyError}`}
                </span>
              )}
            </div>
          </div>

          <div className="onboarding__field">
            <label className="ot-label" htmlFor="subdomain">
              Subdomain
            </label>
            <div className="onboarding__name-row">
              <input
                id="subdomain"
                className="ot-input"
                value={subdomain ?? ''}
                onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              />
              <span className="ot-micro" style={{ alignSelf: 'center' }}>
                .workers.dev
              </span>
            </div>
            <p className="ot-micro">Free, instant. Bring a custom domain later from Settings → Cloudflare.</p>
          </div>

          <div className="onboarding__field">
            <label className="ot-label" htmlFor="access-emails">
              Access list <span className="onboarding__optional">extra emails, comma-separated</span>
            </label>
            <input
              id="access-emails"
              className="ot-input"
              value={accessEmailsRaw}
              onChange={(e) => setAccessEmailsRaw(e.target.value)}
              placeholder="teammate@example.com, you@otherdomain.com"
            />
            <p className="ot-micro">Your email ({flow.email}) is locked first.</p>
          </div>

          <div className="onboarding__actions">
            <button type="submit" className="ot-btn" disabled={!verifyOk}>
              Next: pick upgrades →
            </button>
          </div>
        </form>

        <aside className="onboarding__token-preview" aria-label="What we'll do">
          <h4>What we'll do</h4>
          <div className="onboarding__token-step">
            <span className="onboarding__token-step-num">1</span>
            <div className="onboarding__token-step-body">
              <strong>Validate your token</strong>
              <br />
              Confirm scopes match the canonical set.
            </div>
          </div>
          <div className="onboarding__token-step">
            <span className="onboarding__token-step-num">2</span>
            <div className="onboarding__token-step-body">
              <strong>Provision storage</strong>
              <br />
              D1 database, KV namespace, R2 bucket, Vectorize index.
            </div>
          </div>
          <div className="onboarding__token-step">
            <span className="onboarding__token-step-num">3</span>
            <div className="onboarding__token-step-body">
              <strong>Deploy your Worker</strong>
              <br />
              Bind the Durable Objects, set the Access policy.
            </div>
          </div>
          <div className="onboarding__token-step">
            <span className="onboarding__token-step-num">4</span>
            <div className="onboarding__token-step-body">
              <strong>Say hi to {flow.agentName || 'your agent'}</strong>
              <br />
              Pre-loaded welcome thread, ready to chat.
            </div>
          </div>

          {tokenUrl ? (
            <a className="ot-btn" href={tokenUrl} target="_blank" rel="noreferrer">
              Create one in Cloudflare ↗
            </a>
          ) : (
            <span className="ot-micro">Loading token URL…</span>
          )}
          <p className="ot-micro">
            We open Cloudflare with the right permissions pre-selected. Click <em>Create token</em>,
            then come back and paste.
          </p>
        </aside>
      </div>
      <button className="onboarding__back" onClick={() => (window.location.hash = '#/onboarding/fork')}>
        ← back
      </button>
    </OnboardingFrame>
  );
}
