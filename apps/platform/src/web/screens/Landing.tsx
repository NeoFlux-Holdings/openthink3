/* Marketing landing page — fresh design.
 *
 * - Nav · hero (with gradient italic "Cloudflare") · live demo card
 * - 4-cell stats strip · two-step "how it works" · capability tiles
 * - Compare block · pricing · final CTA
 *
 * Wires the brand "Deploy" + the lower CTAs to `onStart`, which the app router
 * hooks to the onboarding flow. Pressing ⌘D / Ctrl+D also kicks off deploy.
 */
import { useEffect } from 'react';

import { Chord, IS_MAC, Kbd } from '../shell/Chord';
import { Icon } from '../shell/Icon';
import { ThemeToggle } from '../shell/ThemeToggle';

interface Props {
  onStart: () => void;
}

export function Landing({ onStart }: Props) {
  // ⌘D / Ctrl+D anywhere on the landing page jumps into deploy onboarding.
  // We don't preventDefault on the browser's bookmark shortcut unless the
  // page actually has focus and the user isn't typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStart]);

  return (
    <div className="landing scroll">
      <div className="landing-shell">
        <nav className="lnav">
          <span className="brand">
            <span className="brand-mark" aria-hidden />
            openthink
          </span>
          <div className="lnav-links">
            <a>Product</a>
            <a>Pricing</a>
            <a href="https://github.com/NeoFlux-Holdings/openthink3" target="_blank" rel="noreferrer">Docs</a>
            <a href="https://github.com/NeoFlux-Holdings/openthink3" target="_blank" rel="noreferrer">Repo</a>
            <span className="sep" aria-hidden />
            <ThemeToggle />
            <button className="btn sm ghost" type="button" onClick={onStart}>Sign in</button>
            <button className="btn sm brand" type="button" onClick={onStart}>Deploy</button>
          </div>
        </nav>

        <section className="lhero">
          <div className="eyebrow-row">
            <span className="chip brand sm">v1.0</span>
            <span>Open source · Apache-2.0 · 2.4k★</span>
          </div>
          <h1>
            Your agent.<br />
            Your <span className="brand-text">Cloudflare.</span>
          </h1>
          <p className="lead">
            A personal AI agent that runs entirely on your Cloudflare account —
            your domain, your data, your bill. <strong>Ninety seconds</strong>{' '}
            from card paste to first message.
          </p>
          <div className="lhero-cta">
            <button className="btn brand xl" type="button" onClick={onStart}>
              Deploy your agent <Icon name="arrow_right" size={15} />
            </button>
            <button className="btn lg" type="button" onClick={onStart}>
              Try the demo
            </button>
            <span className="meta">
              Press <Chord mod>D</Chord> to deploy
            </span>
          </div>

          {/* Hero demo — agent at work in a faux thread + browser canvas */}
          <div className="lhero-demo" aria-hidden>
            <div className="lhero-demo-head">
              <span className="lights">
                <span /><span /><span />
              </span>
              <span className="titl">
                <span className="dot live pulse" />flannel-arroyo · live
              </span>
            </div>
            <div className="lhero-demo-body">
              <div className="lhero-demo-thread">
                <div className="msg-user" style={{ fontSize: 13, padding: '8px 12px', maxWidth: '92%' }}>
                  Book 3 customer calls next week from the tier-2 list
                </div>
                <div className="msg-ag" style={{ gap: 10 }}>
                  <div className="ag-mark" style={{ width: 22, height: 22, fontSize: 11, borderRadius: 6 }}>f</div>
                  <div className="body">
                    <div className="status-ln" style={{ margin: '0 0 8px' }}>
                      <div className="sp" />booking…
                    </div>
                    <div className="tool-row" style={{ margin: 0 }}>
                      <span className="tool-chip" style={{ fontSize: 10.5 }}>
                        <Icon name="flow" size={10} className="ic" />crm.query
                      </span>
                      <span className="tool-chip" style={{ fontSize: 10.5 }}>
                        <Icon name="calendar" size={10} className="ic" />calendar
                      </span>
                      <span className="tool-chip" style={{ fontSize: 10.5 }}>
                        <Icon name="browser" size={10} className="ic" />browser
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="lhero-demo-canvas">
                <div className="flex gap-2 center" style={{ fontSize: 11, color: 'var(--mute)', fontFamily: 'var(--mono)', marginBottom: 8 }}>
                  <Icon name="browser" size={11} />
                  calendly.com/derek-m
                  <span className="chip coral sm" style={{ marginLeft: 'auto' }}>
                    <span className="dot live pulse" />driving
                  </span>
                </div>
                <div
                  style={{
                    background: 'white',
                    borderRadius: 8,
                    padding: '16px 18px',
                    border: '1px solid var(--rule)',
                    color: '#111',
                  }}
                >
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>
                    Book time with Derek M.
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14, color: '#111' }}>
                    Fri, May 22 · 30 min
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
                    {['9:30', '10:00', '10:30', '11:00', '11:30', '12:00'].map((t, i) => (
                      <div
                        key={t}
                        style={{
                          padding: '6px 8px',
                          textAlign: 'center',
                          borderRadius: 4,
                          fontSize: 11,
                          background: i === 3 ? '#111' : 'white',
                          color: i === 3 ? 'white' : '#111',
                          border: `1px solid ${i === 3 ? '#111' : '#E2E2DC'}`,
                        }}
                      >
                        {t}
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      style={{
                        padding: '5px 10px',
                        background: 'var(--brand)',
                        color: 'white',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 500,
                      }}
                    >
                      Confirm 11:00 AM
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="stats-strip">
            {[
              { num: '90', suf: 's', lab: 'to first message' },
              { num: '$5', suf: '/mo', lab: 'typical hobbyist bill' },
              { num: '96', suf: 'KiB', lab: 'SPA gzipped' },
              { num: '0', suf: '', lab: 'data on our servers' },
            ].map((s) => (
              <div key={s.lab} className="stat-cell">
                <div className="num tnum">
                  {s.num}
                  {s.suf ? <small>{s.suf}</small> : null}
                </div>
                <div className="lab">{s.lab}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Two steps (no fork). */}
        <section className="lsection">
          <div className="eyebrow">how it works</div>
          <h2>
            Two clicks. <em>That&apos;s the install.</em>
          </h2>
          <p className="lsub">
            No git fork, no terminal, no wrangler. The agent provisions itself directly into your
            Cloudflare account.
          </p>

          <div className="two-step">
            <div className="step-card">
              <div className="step-num">01</div>
              <h3>Connect Cloudflare</h3>
              <p>
                One click to authorize. We never see the token — it&apos;s pasted in your browser
                and stored encrypted in your own Worker.
              </p>
              <div className="step-visual">
                <div className="flex center gap-2">
                  <Icon name="lock" size={12} color="var(--green)" />
                  <span>6 scopes validated · 0 bytes to openthink.com</span>
                </div>
              </div>
            </div>
            <div className="step-card">
              <div className="step-num">02</div>
              <h3>Watch it deploy</h3>
              <p>
                Bindings, migrations, DNS, first deploy — streamed live to you. It hibernates when
                idle. Under 60s wall-clock.
              </p>
              <div className="step-visual">
                <div className="flex col gap-1" style={{ fontSize: 11 }}>
                  {[
                    'Worker created',
                    'Bindings provisioned',
                    'DNS propagating',
                    'Agent online',
                  ].map((label, i) => (
                    <div
                      key={label}
                      className="flex center gap-2"
                      style={{ color: i < 3 ? 'var(--green)' : 'var(--brand)' }}
                    >
                      {i < 3 ? (
                        <Icon name="check" size={11} />
                      ) : (
                        <span
                          style={{
                            display: 'inline-block',
                            width: 11,
                            height: 11,
                            borderRadius: '50%',
                            border: '1.5px solid var(--brand)',
                            borderTopColor: 'transparent',
                            animation: 'spin 0.8s linear infinite',
                          }}
                        />
                      )}
                      <span style={{ color: 'var(--ink-2)' }}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Capabilities */}
        <section className="lsection">
          <div className="eyebrow">what it can do</div>
          <h2>
            A real agent. <em>Not a chatbot.</em>
          </h2>
          <p className="lsub">
            Browses the web, writes code, runs sandboxed processes, learns your workflows, opens
            PRs to itself.
          </p>

          <div className="cap-grid">
            {CAPS.map((c) => (
              <div key={c.title} className="cap-tile">
                <div className="icw">
                  <Icon name={c.icon} size={18} />
                </div>
                <h4>{c.title}</h4>
                <p>{c.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Compare */}
        <section className="lsection">
          <div className="eyebrow">why not hosted</div>
          <h2>Renting an agent is a strange decision.</h2>
          <p className="lsub">
            Hosted AI is great software. But you&apos;re paying full retail to put your most
            sensitive context on someone else&apos;s server.
          </p>

          <div className="compare-block">
            <div className="compare-col them">
              <h4>HOSTED AGENTS</h4>
              <div className="who">Claude / ChatGPT / others</div>
              <ul>
                <li><span className="mark"><Icon name="x" size={11} /></span>Prompts, memories, files on their servers</li>
                <li><span className="mark"><Icon name="x" size={11} /></span>One policy change away from data loss</li>
                <li><span className="mark"><Icon name="x" size={11} /></span>Per-seat pricing scales with team</li>
                <li><span className="mark"><Icon name="x" size={11} /></span>Can&apos;t pin models or fork prompts</li>
                <li><span className="mark"><Icon name="x" size={11} /></span>You can&apos;t send the agent a PR</li>
              </ul>
            </div>
            <div className="compare-col us">
              <h4>OPENTHINK</h4>
              <div className="who">Yours, on Cloudflare</div>
              <ul>
                <li><span className="mark"><Icon name="check" size={11} /></span>Runs on your CF — your R2, your D1, your domain</li>
                <li><span className="mark"><Icon name="check" size={11} /></span>If we vanish, your agent still runs</li>
                <li><span className="mark"><Icon name="check" size={11} /></span>You pay Cloudflare directly. Hobbyist: under $5/mo</li>
                <li><span className="mark"><Icon name="check" size={11} /></span>Pin any model. Fork any prompt. Per-tool overrides</li>
                <li><span className="mark"><Icon name="check" size={11} /></span>Apache-2.0. The agent edits its own config</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="lsection">
          <div className="eyebrow">pricing</div>
          <h2>
            You pay <em>Cloudflare.</em>
            <br />
            We are a static site.
          </h2>
          <p className="lsub">Bring your own CF for free, or let us bring one for $12.</p>

          <div className="price-block">
            <div className="price-card">
              <div className="pricer-label">BRING YOUR OWN</div>
              <div className="pricer-num tnum">$0<small>/mo</small></div>
              <div className="pricer-meta">+ what you pay CF (typically under $5)</div>
              <ul className="pricer-list">
                <li>Your Cloudflare account</li>
                <li>Your model keys (Workers AI included)</li>
                <li>Unlimited threads + agents + workspaces</li>
                <li>Full Apache-2.0 source</li>
                <li>Self-hosted forever</li>
              </ul>
              <div className="pricer-cta">
                <button className="btn lg" type="button" onClick={onStart}>
                  Connect Cloudflare <Icon name="arrow_right" size={13} />
                </button>
              </div>
            </div>
            <div className="price-card featured">
              <div className="pricer-label">HOSTED</div>
              <div className="pricer-num tnum">$12<small>/mo</small></div>
              <div className="pricer-meta">we provision the Cloudflare side</div>
              <ul className="pricer-list">
                <li>Skip the CF signup — paste a card instead</li>
                <li>$10 inference + storage credit / mo</li>
                <li>Hard spend cap you set (not us)</li>
                <li>Migrate to your own CF anytime, no downtime</li>
                <li>Same source. Same surface. Same exit.</li>
              </ul>
              <div className="pricer-cta">
                <button
                  className="btn lg"
                  type="button"
                  onClick={onStart}
                  style={{ background: 'white', color: 'var(--ink)', borderColor: 'white' }}
                >
                  Start hosted <Icon name="arrow_right" size={13} />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="lcta">
          <h2>
            Ninety seconds.
            <br />
            <em>That&apos;s the whole pitch.</em>
          </h2>
          <p>No signup gate. No demo gating. Click deploy. Watch it stand up.</p>
          <div className="flex gap-3 center" style={{ justifyContent: 'center' }}>
            <button className="btn brand xl" type="button" onClick={onStart}>
              Deploy your agent <Icon name="arrow_right" size={15} />
            </button>
            <button className="btn lg" type="button" onClick={onStart}>
              Try the demo
            </button>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 22 }}>
            <Kbd>{IS_MAC ? '⌘' : 'Ctrl+'}D</Kbd> works from this page.
          </div>
        </section>

        <footer className="lfoot">
          <span>OpenThink · Apache-2.0 · NeoFlux Holdings</span>
          <div className="lfoot-links">
            <a href="https://github.com/NeoFlux-Holdings/openthink3" target="_blank" rel="noreferrer">Docs</a>
            <a href="https://github.com/NeoFlux-Holdings/openthink3" target="_blank" rel="noreferrer">Repo</a>
            <a>Status</a>
            <a>Twitter</a>
          </div>
        </footer>
      </div>
    </div>
  );
}

const CAPS: { icon: 'browser' | 'brain' | 'code' | 'flow' | 'bolt' | 'lock'; title: string; body: string }[] = [
  { icon: 'browser', title: 'Live browser', body: 'Watches you click, drives the browser itself. Sub-500ms takeover.' },
  { icon: 'brain', title: 'Persistent memory', body: 'Learns your people, projects, prefs. Curate what it remembers.' },
  { icon: 'code', title: 'Sandbox execution', body: 'Runs code in isolated Cloudflare sandboxes. Per-tool spend caps.' },
  { icon: 'flow', title: 'Multi-agent', body: 'Orchestrator delegates to researcher, coder, judge — over DO RPC.' },
  { icon: 'bolt', title: 'Self-evolving', body: 'Learns skills from your training runs. Pin or fork upstream.' },
  { icon: 'lock', title: 'Hard spend caps', body: 'Set a daily cap. The agent stops before exceeding. No surprises.' },
];
