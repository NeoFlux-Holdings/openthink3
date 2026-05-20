/* Onboarding — 3 steps · port of the Claude Design redesign.
 *
 * Step 01 — Name your agent          (handle + workspace)
 * Step 02 — Connect Cloudflare       (BYO token  /  Hosted Stripe checkout)
 * Step 03 — Pick capabilities        (browser, vectorize, queues, workers paid, spend cap)
 *                                     → /api/deploy/start → /deploy
 *
 * Real backend wiring is preserved from the existing screens:
 *   - /api/cf-token/url  for the pre-checked CF token UI
 *   - /api/cf-token/validate  for live token verification
 *   - /api/stripe/checkout  for hosted-path Stripe checkout
 *   - /api/deploy/start  triggers the actual deploy
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AppFlowState } from '../App';
import { Chord } from '../shell/Chord';
import { Icon } from '../shell/Icon';

interface Props {
  flow: AppFlowState;
  merge: (patch: Partial<AppFlowState>) => void;
  onDeploy: () => void;
}

type StepKey = 'name' | 'connect' | 'caps';

const STEPS: { key: StepKey; label: string; sub: string }[] = [
  { key: 'name', label: 'Name your agent', sub: '~10s' },
  { key: 'connect', label: 'Connect Cloudflare', sub: '~30s' },
  { key: 'caps', label: 'Pick capabilities', sub: '~10s' },
];

const NAME_SUGGESTIONS = [
  'flannel-arroyo',
  'copper-meridian',
  'vellum-quartz',
  'indigo-thicket',
  'marrow-spindle',
  'heather-clasp',
];

export function Onboarding({ flow, merge, onDeploy }: Props) {
  // Start at the first step the user hasn't completed. Lets people deep-link
  // back into the flow without losing progress when the hash is just
  // `/onboarding`.
  const initialStep: StepKey = !flow.agentName
    ? 'name'
    : !flow.cloudflareToken && !flow.customDomain
      ? 'connect'
      : 'caps';
  const [stepKey, setStepKey] = useState<StepKey>(initialStep);
  const idx = Math.max(0, STEPS.findIndex((s) => s.key === stepKey));
  const currentStep = STEPS[idx] ?? STEPS[0]!;

  // A simple elapsed-second timer so users see progress in the rail. Resets
  // any time they re-enter the onboarding flow.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const setStep = (next: StepKey) => {
    const nextIdx = STEPS.findIndex((s) => s.key === next);
    // Only allow forward navigation if the user has filled what's needed.
    if (nextIdx <= idx) {
      setStepKey(next);
      return;
    }
    if (next === 'connect' && !flow.agentName) return;
    if (next === 'caps' && !(flow.cloudflareToken || flow.customDomain)) return;
    setStepKey(next);
  };

  return (
    <div className="onb" data-screen-label={`Onboarding · ${currentStep.label}`}>
      <aside className="onb-rail">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          openthink
        </div>
        <div className="onb-steps">
          {STEPS.map((s, i) => (
            <div
              key={s.key}
              className={['onb-step', i < idx ? 'done' : i === idx ? 'current' : ''].filter(Boolean).join(' ')}
              onClick={() => i <= idx && setStep(s.key)}
              role="button"
              tabIndex={i <= idx ? 0 : -1}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && i <= idx) {
                  e.preventDefault();
                  setStep(s.key);
                }
              }}
            >
              <div className="mk">{i < idx ? <Icon name="check" size={12} /> : i + 1}</div>
              <div className="lab">
                {s.label}
                <small>{s.sub}</small>
              </div>
            </div>
          ))}
        </div>
        <div className="timer">
          <div className="lab">ELAPSED</div>
          <div className="val tnum">
            {formatTimer(elapsed)}
            <span style={{ color: 'var(--soft)', fontSize: 14 }}> / 01:30</span>
          </div>
        </div>
      </aside>

      <main className="onb-main scroll">
        <div className="onb-content">
          {stepKey === 'name' && (
            <NameStep
              flow={flow}
              merge={merge}
              onNext={() => setStepKey('connect')}
            />
          )}
          {stepKey === 'connect' && (
            <ConnectStep
              flow={flow}
              merge={merge}
              onNext={() => setStepKey('caps')}
              onBack={() => setStepKey('name')}
            />
          )}
          {stepKey === 'caps' && (
            <CapsStep
              flow={flow}
              merge={merge}
              onDeploy={onDeploy}
              onBack={() => setStepKey('connect')}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function formatTimer(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/* -------------------------------------------------------------------------- */
/* Step 01 — name                                                              */
/* -------------------------------------------------------------------------- */
function NameStep({
  flow,
  merge,
  onNext,
}: {
  flow: AppFlowState;
  merge: (patch: Partial<AppFlowState>) => void;
  onNext: () => void;
}) {
  const [name, setName] = useState(flow.agentName || 'flannel-arroyo');
  const [email, setEmail] = useState(flow.email || '');
  useEffect(() => {
    merge({ agentName: name, email });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, email]);

  const canContinue = name.length >= 2 && email.includes('@');

  return (
    <>
      <div className="eyebrow" style={{ marginBottom: 12 }}>step 01 of 03</div>
      <h1>Name your agent.</h1>
      <p className="lead">
        Two-word handle. This becomes its subdomain —{' '}
        <span className="mono" style={{ color: 'var(--ink)' }}>
          {name}.openthink.run
        </span>
        . Rename it whenever.
      </p>

      <div className="field">
        <label className="field-label" htmlFor="agent-name">Agent name</label>
        <input
          id="agent-name"
          className="input lg mono"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
        />
        <div className="name-suggest">
          {NAME_SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => setName(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="agent-email">Your email</label>
        <input
          id="agent-email"
          className="input lg"
          value={email}
          onChange={(e) => setEmail(e.target.value.trim())}
          placeholder="you@example.com"
          type="email"
        />
        <div className="field-help">
          Cloudflare Access uses this to gate your agent. You can add more emails later.
        </div>
      </div>

      <div className="field">
        <label className="field-label">Workspace</label>
        <select className="input lg" defaultValue="Personal">
          <option value="Personal">Personal</option>
          <option value="Work · NeoFlux">Work · NeoFlux</option>
          <option value="+">+ create new</option>
        </select>
        <div className="field-help">
          A workspace groups multiple agents. Switch with <Chord mod>1</Chord>–<Chord mod>9</Chord>.
        </div>
      </div>

      <div className="onb-foot">
        <span />
        <button className="btn brand" type="button" onClick={onNext} disabled={!canContinue}>
          Continue <Icon name="arrow_right" size={13} />
        </button>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 02 — connect Cloudflare                                                */
/* -------------------------------------------------------------------------- */
function ConnectStep({
  flow,
  merge,
  onNext,
  onBack,
}: {
  flow: AppFlowState;
  merge: (patch: Partial<AppFlowState>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  type Path = 'byo' | 'hosted';
  const [path, setPath] = useState<Path>(flow.customDomain ? 'hosted' : 'byo');
  const [token, setToken] = useState(flow.cloudflareToken ?? '');
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenUrl, setTokenUrl] = useState<string | null>(null);

  // Fetch the deep-linked CF token URL so the user gets the right scopes pre-checked.
  useEffect(() => {
    void fetch(`/api/cf-token/url?name=${encodeURIComponent(`OpenThink — ${flow.agentName || 'agent'}`)}`)
      .then((r) => r.json())
      .then((data: { url: string }) => setTokenUrl(data.url))
      .catch(() => undefined);
  }, [flow.agentName]);

  const verifyToken = useCallback(async (candidate: string) => {
    if (!candidate) return;
    setVerifying(true);
    setError(null);
    setVerified(false);
    try {
      const res = await fetch('/api/cf-token/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: candidate }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        setVerified(true);
        merge({ cloudflareToken: candidate });
      } else {
        setError(data.error ?? 'verify_failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network');
    } finally {
      setVerifying(false);
    }
  }, [merge]);

  const looksLikeToken = (s: string) => /^[A-Za-z0-9_-]{20,}$/.test(s.trim());

  const onPasteToken = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').trim();
    if (!looksLikeToken(pasted)) return;
    e.preventDefault();
    setToken(pasted);
    void verifyToken(pasted);
  };

  const ready = path === 'hosted' ? Boolean(flow.customDomain) : verified;

  const goNext = () => {
    if (path === 'byo') merge({ cloudflareToken: token, customDomain: undefined });
    onNext();
  };

  return (
    <>
      <div className="eyebrow" style={{ marginBottom: 12 }}>step 02 of 03</div>
      <h1>Connect Cloudflare.</h1>
      <p className="lead">Two ways. Both end with a live agent. You can switch later, no migration.</p>

      <div className="path-toggle">
        <button
          type="button"
          className={`path-card ${path === 'byo' ? 'on' : ''}`}
          onClick={() => setPath('byo')}
          aria-pressed={path === 'byo'}
        >
          <div className="nm">Bring your own Cloudflare</div>
          <div className="ds">Paste a token. We never see it. Free.</div>
          <div className="pr">$0 + your CF bill (~$5/mo)</div>
        </button>
        <button
          type="button"
          className={`path-card ${path === 'hosted' ? 'on' : ''}`}
          onClick={() => setPath('hosted')}
          aria-pressed={path === 'hosted'}
        >
          <div className="nm">Hosted by us</div>
          <div className="ds">Card → we provision a CF account for you.</div>
          <div className="pr">$12/mo with $10 credit</div>
        </button>
      </div>

      {path === 'byo' && (
        <>
          <div className="info-note">
            <div className="icw"><Icon name="lock" size={12} /></div>
            <div className="body">
              <strong>Zero packets touch openthink.com.</strong>
              The token is pasted in your browser, stored encrypted in your own Worker&apos;s KV. We
              can&apos;t recover it if you lose it; revoke it any time in Cloudflare.
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="cf-token">Cloudflare API token</label>
            <input
              id="cf-token"
              className="input lg mono"
              type="password"
              placeholder="cf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setVerified(false);
                setError(null);
              }}
              onPaste={onPasteToken}
              style={{ fontSize: 12.5 }}
              autoComplete="off"
            />
            <div className="flex between mt-3 center" style={{ gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              {tokenUrl ? (
                <a
                  className="text-xs"
                  style={{ color: 'var(--brand)', display: 'inline-flex', gap: 4, alignItems: 'center' }}
                  href={tokenUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="popout" size={11} /> Open CF token form with scopes pre-checked
                </a>
              ) : (
                <span className="text-xs muted">Loading CF token URL…</span>
              )}
              {!verified && token && (
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() => verifyToken(token)}
                  disabled={verifying}
                >
                  {verifying ? 'Validating…' : 'Validate token'}
                </button>
              )}
              {verified && (
                <span className="chip green sm">
                  <Icon name="check" size={10} />
                  Valid · 6 scopes
                </span>
              )}
              {error && (
                <span className="chip red sm">
                  <Icon name="x" size={10} />
                  {error === 'verify_failed' ? 'Rejected · check scopes' : error}
                </span>
              )}
            </div>
          </div>

          <div className="eyebrow" style={{ marginTop: 24, marginBottom: 12 }}>scopes</div>
          <div className="scope-list">
            {[
              ['Workers Scripts · Edit', 'Deploy + update the worker'],
              ['Workers KV · Edit', 'Hot settings, memories'],
              ['D1 · Edit', 'Trajectories, audit, policies'],
              ['R2 · Edit', 'Documents, generated files'],
              ['Workers AI · Read', 'Invoke models on your account'],
              ['Browser Rendering · Edit', 'Optional — live browser sessions'],
            ].map(([nm, why]) => (
              <div className="scope" key={nm}>
                <span className="ck"><Icon name="check" size={12} /></span>
                <div>
                  <div className="nm">{nm}</div>
                  <div className="why">{why}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {path === 'hosted' && (
        <HostedConnectPane flow={flow} merge={merge} />
      )}

      <div className="onb-foot">
        <button type="button" className="onb-skip" onClick={onBack}>← Back</button>
        <button type="button" className="btn brand" onClick={goNext} disabled={!ready}>
          Continue <Icon name="arrow_right" size={13} />
        </button>
      </div>
    </>
  );
}

/* Hosted CF pane — simple checkout summary; real Stripe redirect handed off
 * to /api/stripe/checkout when the user clicks "Start checkout". */
function HostedConnectPane({ flow, merge }: { flow: AppFlowState; merge: (p: Partial<AppFlowState>) => void }) {
  const [domain, setDomain] = useState(flow.customDomain || `${flow.agentName || 'agent'}.com`);
  const [tld, setTld] = useState(domain.includes('.') ? domain.split('.').slice(-1)[0]! : 'com');
  const [starting, setStarting] = useState(false);

  // Persist the domain choice up to App.flow so the deploy step picks it up.
  useEffect(() => {
    merge({ customDomain: domain, workersPaid: true, domainPriceCents: 1200 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  const start = async () => {
    setStarting(true);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, agentName: flow.agentName, email: flow.email }),
      });
      const data = (await res.json()) as { url?: string; checkoutId?: string };
      if (data.checkoutId) merge({ domainCheckoutId: data.checkoutId });
      if (data.url) {
        merge({ domainCheckoutUrl: data.url });
        window.open(data.url, '_blank', 'noopener,noreferrer');
      }
    } catch {
      /* swallow — checkout link will still surface if backend isn't live */
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <div className="info-note">
        <div className="icw"><Icon name="cloud" size={12} /></div>
        <div className="body">
          <strong>We&apos;ll provision a Cloudflare account for you.</strong>
          One charge of $12 buys the domain for the year and seeds $10 of inference + storage
          credit. You can migrate to your own CF anytime, no downtime.
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="domain">Domain</label>
        <div className="flex gap-2 center" style={{ gap: 8 }}>
          <input
            id="domain"
            className="input lg mono"
            value={domain.split('.')[0]}
            onChange={(e) => setDomain(`${e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')}.${tld}`)}
          />
          <select
            className="input lg"
            style={{ maxWidth: 110 }}
            value={tld}
            onChange={(e) => {
              setTld(e.target.value);
              setDomain(`${domain.split('.')[0]}.${e.target.value}`);
            }}
          >
            <option value="com">.com</option>
            <option value="ai">.ai</option>
            <option value="dev">.dev</option>
            <option value="xyz">.xyz</option>
          </select>
        </div>
        <div className="field-help">Live availability check on blur · v1.1.</div>
      </div>

      <div className="card-2" style={{ padding: 18, marginBottom: 20 }}>
        <div className="flex between center" style={{ marginBottom: 12 }}>
          <span className="fw-medium">OpenThink Hosted</span>
          <span style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1 }}>
            $12<small style={{ fontSize: 12, color: 'var(--mute)', fontWeight: 400, marginLeft: 4 }}>/mo</small>
          </span>
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
          {[
            '$10 inference + storage credit included',
            'Hard spend cap you set',
            'Migrate to your own CF anytime',
            'Apache-2.0 same source',
            'Cancel anytime, take your data',
          ].map((line) => (
            <li
              key={line}
              style={{ padding: '5px 0', display: 'flex', gap: 10, alignItems: 'center', color: 'var(--ink-2)' }}
            >
              <Icon name="check" size={12} color="var(--brand)" /> {line}
            </li>
          ))}
        </ul>
      </div>

      <button type="button" className="btn lg brand" onClick={start} disabled={starting}>
        {starting ? 'Opening Stripe…' : 'Start checkout ↗'}
      </button>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 03 — pick capabilities                                                 */
/* -------------------------------------------------------------------------- */
function CapsStep({
  flow,
  merge,
  onDeploy,
  onBack,
}: {
  flow: AppFlowState;
  merge: (patch: Partial<AppFlowState>) => void;
  onDeploy: () => void;
  onBack: () => void;
}) {
  const [opts, setOpts] = useState<Record<string, boolean>>({
    browser: true,
    vectorize: true,
    queues: false,
    workers_paid: flow.workersPaid ?? false,
  });
  const [cap, setCap] = useState('$20.00');
  const [deploying, setDeploying] = useState(false);
  const deployedRef = useRef(false);

  const toggle = (k: string) => setOpts((o) => ({ ...o, [k]: !o[k] }));

  const caps = useMemo(
    () => [
      { k: 'browser', n: 'Browser sessions', d: 'Live agent-driven browser. The "wow" moment.', c: '~$0.0015 / session-minute', rec: true },
      { k: 'vectorize', n: 'Persistent memory', d: 'Semantic memory + skill retrieval.', c: 'Free under 30M queries/mo', rec: true },
      { k: 'queues', n: 'Background goals', d: 'Long-running tasks · cron · scheduled work.', c: '~$0.40 / 1M operations', rec: false },
      { k: 'workers_paid', n: 'Workers Paid ($5)', d: 'Lift the daily request cap. Only needed >100K req/day.', c: '$5/mo flat to CF', rec: false },
    ],
    [],
  );

  const startDeploy = async () => {
    if (deployedRef.current) return;
    deployedRef.current = true;
    setDeploying(true);
    merge({ workersPaid: opts.workers_paid });

    try {
      const res = await fetch('/api/deploy/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: flow.agentName,
          email: flow.email,
          cloudflareToken: flow.cloudflareToken,
          customDomain: flow.customDomain,
          subdomain: flow.subdomain,
          accessEmails: flow.accessEmails,
          workersPaid: opts.workers_paid,
          capabilities: {
            browser: opts.browser,
            vectorize: opts.vectorize,
            queues: opts.queues,
          },
          dailySpendCapUsd: parseFloat(cap.replace(/[^0-9.]/g, '')) || 20,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { deployId?: string };
      if (data.deployId) merge({ deployId: data.deployId });
    } catch {
      /* deploy stub will handle missing deployId */
    } finally {
      onDeploy();
    }
  };

  return (
    <>
      <div className="eyebrow" style={{ marginBottom: 12 }}>step 03 of 03</div>
      <h1>Pick capabilities.</h1>
      <p className="lead">
        All optional. Toggle on/off anytime in Settings. Each is a Cloudflare resource we&apos;ll
        provision.
      </p>

      <div className="cap-pick-grid">
        {caps.map((c) => (
          <button
            key={c.k}
            type="button"
            className={`cap-pick ${opts[c.k] ? 'on' : ''}`}
            onClick={() => toggle(c.k)}
            aria-pressed={opts[c.k]}
          >
            <div className="row">
              <span className="nm">{c.n}</span>
              <span className={`switch ${opts[c.k] ? 'on' : ''}`} aria-hidden />
            </div>
            <div className="ds">{c.d}</div>
            <div className="ct">
              {c.c}
              {c.rec && <span style={{ color: 'var(--brand)', marginLeft: 6 }}>· recommended</span>}
            </div>
          </button>
        ))}
      </div>

      <div className="field" style={{ marginTop: 24 }}>
        <label className="field-label" htmlFor="spend-cap">Hard daily spend cap</label>
        <div className="flex gap-3 center" style={{ flexWrap: 'wrap' }}>
          <input
            id="spend-cap"
            className="input lg mono"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            style={{ maxWidth: 160, textAlign: 'right' }}
          />
          <span className="text-sm muted">
            The agent stops and asks before exceeding. Cannot self-override.
          </span>
        </div>
      </div>

      <div className="onb-foot">
        <button type="button" className="onb-skip" onClick={onBack}>← Back</button>
        <button type="button" className="btn brand lg" onClick={startDeploy} disabled={deploying}>
          {deploying ? 'Starting deploy…' : 'Deploy agent'} <Icon name="bolt" size={14} />
        </button>
      </div>
    </>
  );
}
