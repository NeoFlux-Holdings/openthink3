// OnboardingUpgrades — optional Workers Paid + custom domain step.
//
// Slots in between the token-validated step and the deploy timeline. Both
// upgrades are opt-in; the page header makes it clear the free workers.dev
// path keeps working if you skip. The domain search is debounced and queries
// /api/cf-domain/search which proxies to the CF Registrar `availability`
// endpoint when a verified token is present, otherwise it falls back to a
// deterministic fuzzy stub for the dry-run experience.
//
// Selecting an upgrade kicks off a Stripe checkout intent — the resulting
// checkoutId lives on the flow state so the deploy step (the screen after
// this one) can show the right copy ("Provisioning custom domain ⏵
// example.com") and so the post-purchase webhook can match the agent to its
// paid line items.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { OnboardingFrame } from './OnboardingIdentity';
import type { AppFlowState } from '../App';
import './OnboardingUpgrades.css';

interface Props {
  flow: AppFlowState;
  merge: (patch: Partial<AppFlowState>) => void;
  next: () => void;
  back: () => void;
}

interface DomainHit {
  name: string;
  tld: string;
  available: boolean;
  priceCents: number;
  premium?: boolean;
}

const POPULAR_TLDS = ['.com', '.ai', '.dev', '.io', '.app', '.run', '.so', '.co', '.me'];

export function OnboardingUpgrades({ flow, merge, next, back }: Props) {
  const [workersPaid, setWorkersPaid] = useState<boolean>(flow.workersPaid ?? false);
  const [domainQuery, setDomainQuery] = useState(flow.customDomain ?? '');
  const [hits, setHits] = useState<DomainHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [chosenDomain, setChosenDomain] = useState<DomainHit | null>(null);
  const [activatingDomain, setActivatingDomain] = useState(false);
  const [activatingWorkers, setActivatingWorkers] = useState(false);

  // Debounce the domain query.
  useEffect(() => {
    if (domainQuery.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/cf-domain/search?q=${encodeURIComponent(domainQuery.trim())}`,
        );
        const data = (await res.json()) as { hits?: DomainHit[] };
        setHits(data.hits ?? []);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => window.clearTimeout(handle);
  }, [domainQuery]);

  const startWorkersPaid = useCallback(async () => {
    setActivatingWorkers(true);
    try {
      const res = await fetch('/api/upgrades/workers-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: flow.email, agentName: flow.agentName }),
      });
      const data = (await res.json()) as { ok?: boolean; checkoutId?: string; checkoutUrl?: string };
      if (data.ok && data.checkoutId) {
        merge({
          workersPaid: true,
          workersPaidCheckoutId: data.checkoutId,
          workersPaidCheckoutUrl: data.checkoutUrl,
        });
        setWorkersPaid(true);
      }
    } finally {
      setActivatingWorkers(false);
    }
  }, [flow.email, flow.agentName, merge]);

  const pickDomain = useCallback(
    async (hit: DomainHit) => {
      setChosenDomain(hit);
      setActivatingDomain(true);
      try {
        const res = await fetch('/api/upgrades/domain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: flow.email,
            agentName: flow.agentName,
            domain: hit.name,
            priceCents: hit.priceCents,
          }),
        });
        const data = (await res.json()) as { ok?: boolean; checkoutId?: string; checkoutUrl?: string };
        if (data.ok && data.checkoutId) {
          merge({
            customDomain: hit.name,
            domainPriceCents: hit.priceCents,
            domainCheckoutId: data.checkoutId,
            domainCheckoutUrl: data.checkoutUrl,
          });
        }
      } finally {
        setActivatingDomain(false);
      }
    },
    [flow.email, flow.agentName, merge],
  );

  const clearDomain = () => {
    setChosenDomain(null);
    setDomainQuery('');
    merge({ customDomain: undefined, domainPriceCents: undefined, domainCheckoutId: undefined });
  };

  const [starting, setStarting] = useState(false);
  const proceed = async () => {
    setStarting(true);
    merge({ workersPaid });
    try {
      const res = await fetch('/api/deploy/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: flow.agentName,
          email: flow.email,
          cloudflareToken: flow.cloudflareToken,
          subdomain: flow.subdomain,
          accessEmails: flow.accessEmails,
          workersPaid,
          customDomain: flow.customDomain,
          workersPaidCheckoutId: flow.workersPaidCheckoutId,
          domainCheckoutId: flow.domainCheckoutId,
        }),
      });
      const data = (await res.json()) as { ok: boolean; deployId?: string };
      if (data.ok && data.deployId) {
        merge({ deployId: data.deployId });
        next();
      }
    } finally {
      setStarting(false);
    }
  };

  return (
    <OnboardingFrame
      step={4}
      of={4}
      title="Polish (optional)"
      subtitle="Upgrade your runtime or pin a real domain — both kick in instantly. Skip if you're happy on the free path."
      onBack={back}
    >
      <div className="upgrades__skipnote">
        <span className="ot-micro">
          Free path: <code>{(flow.agentName || 'your-agent') + '.workers.dev'}</code> with
          full agent capabilities (Workers AI, KV, R2 reads).
        </span>
        <button
          type="button"
          className="upgrades__skip"
          onClick={() => void proceed()}
          disabled={starting}
        >
          {starting ? 'Starting deploy…' : 'Skip — just deploy free tier →'}
        </button>
      </div>
      <div className="upgrades">
        <article className={`upgrades__card${workersPaid ? ' upgrades__card--active' : ''}`}>
          <header className="upgrades__card-head">
            <div>
              <h3>
                Workers Paid <span className="upgrades__price">$5 / mo</span>
              </h3>
              <p className="upgrades__lede">
                Includes 10M requests, 30s CPU per request, real <em>Durable Objects</em>, R2
                writes, Queues, Workflows.
              </p>
            </div>
            <span className={`upgrades__pill${workersPaid ? ' upgrades__pill--on' : ''}`}>
              {workersPaid ? 'queued' : 'free tier'}
            </span>
          </header>
          <ul className="upgrades__bullets">
            <li>30-second CPU per request (free: 10ms)</li>
            <li>Durable Object SQLite for thread history at scale</li>
            <li>R2 unlocked for artifact persistence</li>
            <li>Queues unlocked for async trajectory writeback</li>
            <li>Vectorize for shared semantic memory</li>
            <li>Higher Workers AI throughput tier</li>
          </ul>
          <footer className="upgrades__card-foot">
            {workersPaid ? (
              <div className="upgrades__success-row">
                <span className="ot-micro upgrades__success">
                  Queued. Pay via Stripe to finalize.
                </span>
                {flow.workersPaidCheckoutUrl && (
                  <a
                    href={flow.workersPaidCheckoutUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ot-btn ot-btn--ghost"
                  >
                    Open Stripe checkout ↗
                  </a>
                )}
              </div>
            ) : (
              <button
                type="button"
                className="ot-btn"
                onClick={startWorkersPaid}
                disabled={activatingWorkers}
              >
                {activatingWorkers ? 'Opening checkout…' : 'Add Workers Paid →'}
              </button>
            )}
            <span className="ot-micro">
              You can still ship without it — but Durable Objects fall back to in-memory
              state, which means the thread feed forgets when the worker hibernates.
            </span>
          </footer>
        </article>

        <article className={`upgrades__card${flow.customDomain ? ' upgrades__card--active' : ''}`}>
          <header className="upgrades__card-head">
            <div>
              <h3>Custom domain</h3>
              <p className="upgrades__lede">
                Replace the <code>.workers.dev</code> subdomain with your own. We add the
                DNS records and Access policy automatically once Cloudflare clears the
                transfer.
              </p>
            </div>
            {flow.customDomain ? (
              <span className="upgrades__pill upgrades__pill--on">
                {flow.customDomain}
              </span>
            ) : (
              <span className="upgrades__pill">subdomain by default</span>
            )}
          </header>

          {!flow.customDomain && (
            <div className="upgrades__search">
              <input
                type="text"
                className="ot-input upgrades__search-input"
                placeholder="Try a name — 'spark', 'forge', 'meadow-and-fern'…"
                value={domainQuery}
                onChange={(e) => setDomainQuery(e.target.value.toLowerCase().replace(/[^a-z0-9- ]/g, ''))}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <div className="upgrades__tld-row" role="list" aria-label="Popular TLDs">
                {POPULAR_TLDS.map((tld) => (
                  <button
                    key={tld}
                    type="button"
                    className="upgrades__tld"
                    onClick={() => {
                      const base = domainQuery.trim().replace(/\..*$/, '') || flow.agentName || 'mine';
                      setDomainQuery(base + tld);
                    }}
                  >
                    {tld}
                  </button>
                ))}
              </div>
              <DomainResults
                searching={searching}
                hits={hits}
                pickDomain={pickDomain}
                activating={activatingDomain && chosenDomain !== null}
                chosen={chosenDomain}
              />
            </div>
          )}

          {flow.customDomain && (
            <div className="upgrades__chosen">
              <div>
                <span className="ot-label">selected</span>
                <div className="upgrades__chosen-name">{flow.customDomain}</div>
                {flow.domainPriceCents !== undefined && (
                  <span className="ot-micro">
                    ${(flow.domainPriceCents / 100).toFixed(2)} / year · annual renewal at cost
                  </span>
                )}
              </div>
              <div className="upgrades__chosen-actions">
                {flow.domainCheckoutUrl && (
                  <a
                    href={flow.domainCheckoutUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ot-btn ot-btn--ghost"
                  >
                    Pay ↗
                  </a>
                )}
                <button type="button" className="ot-btn ot-btn--ghost" onClick={clearDomain}>
                  Change
                </button>
              </div>
            </div>
          )}
        </article>
      </div>

      <div className="onboarding__actions upgrades__actions">
        <button type="button" className="onboarding__back" onClick={back}>
          ← back
        </button>
        <button type="button" className="ot-btn" onClick={proceed} disabled={starting}>
          {starting
            ? 'Starting deploy…'
            : workersPaid || flow.customDomain
              ? 'Continue to deploy →'
              : 'Skip and deploy →'}
        </button>
      </div>
    </OnboardingFrame>
  );
}

function DomainResults({
  searching,
  hits,
  pickDomain,
  activating,
  chosen,
}: {
  searching: boolean;
  hits: DomainHit[];
  pickDomain: (h: DomainHit) => void;
  activating: boolean;
  chosen: DomainHit | null;
}) {
  const grouped = useMemo(() => {
    const available = hits.filter((h) => h.available);
    const taken = hits.filter((h) => !h.available).slice(0, 4);
    return { available, taken };
  }, [hits]);

  if (searching) {
    return (
      <div className="upgrades__results-state">
        <span className="upgrades__spinner" aria-hidden /> searching the registry…
      </div>
    );
  }

  if (hits.length === 0) {
    return (
      <div className="upgrades__results-state">
        <p className="ot-micro">
          Start typing a name. We'll fan out across the popular TLDs and surface what's open.
        </p>
      </div>
    );
  }

  return (
    <div className="upgrades__results">
      {grouped.available.length > 0 && (
        <>
          <div className="upgrades__group-label">available</div>
          <ul className="upgrades__hits">
            {grouped.available.map((h) => (
              <li key={h.name} className="upgrades__hit upgrades__hit--available">
                <div>
                  <strong>{h.name}</strong>
                  {h.premium && (
                    <span className="ot-pill ot-pill--accent upgrades__premium">premium</span>
                  )}
                  <div className="ot-micro">
                    ${(h.priceCents / 100).toFixed(2)} / year · auto-renew
                  </div>
                </div>
                <button
                  type="button"
                  className="ot-btn"
                  onClick={() => pickDomain(h)}
                  disabled={activating && chosen?.name === h.name}
                >
                  {activating && chosen?.name === h.name ? 'Opening checkout…' : 'Buy'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {grouped.taken.length > 0 && (
        <>
          <div className="upgrades__group-label">already taken</div>
          <ul className="upgrades__hits upgrades__hits--taken">
            {grouped.taken.map((h) => (
              <li key={h.name} className="upgrades__hit upgrades__hit--taken">
                <strong>{h.name}</strong>
                <span className="ot-micro">unavailable</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
