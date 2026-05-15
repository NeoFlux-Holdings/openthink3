import './Landing.css';

interface Props {
  onStart: () => void;
}

export function Landing({ onStart }: Props) {
  return (
    <div className="landing">
      <a href="#main" className="landing__skip">Skip to content</a>
      <div className="landing__marquee" aria-hidden>
        <div className="landing__marquee-track">
          {MARQUEE.concat(MARQUEE).map((m, i) => (
            <span key={i} className="landing__marquee-item">
              <span className="landing__marquee-glyph">✦</span>
              {m}
            </span>
          ))}
        </div>
      </div>

      <header className="landing__topbar">
        <div className="ot-container landing__topbar-inner">
          <a href="#" className="ot-brand">
            <span className="ot-brand-dot" />
            OpenThink
          </a>
          <nav className="landing__nav">
            <a href="https://github.com/NeoFlux-Holdings/openthink3" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="#/docs">Docs</a>
            <button className="landing__sign-in" onClick={onStart}>
              Sign in
            </button>
          </nav>
        </div>
      </header>

      <main id="main" className="landing__hero ot-container">
        <span className="landing__eyebrow">
          <span className="landing__eyebrow-dot" />
          A personal AI agent · v1.0
        </span>
        <h1 className="landing__title">
          <span className="landing__title-line">Your agent.</span>
          <span className="landing__title-line">Your hardware.</span>
          <span className="landing__title-line landing__title-line--accent">
            Ninety <em>seconds.</em>
          </span>
        </h1>

        <div className="landing__lede-row">
          <p className="landing__lede">
            OpenThink lives on your own Cloudflare account. One token, ninety seconds, and the
            agent ships behind your email at a domain you control — talking to itself, evolving
            with you, and quietly contributing patches back upstream.
          </p>
          <DecorativeArrow className="landing__lede-arrow" />
        </div>

        <div className="landing__cta">
          <button className="ot-btn landing__cta-btn" onClick={onStart}>
            Get an agent
            <span className="landing__cta-arrow" aria-hidden>→</span>
          </button>
          <a href="#/docs" className="landing__secondary">
            Read the PRD
          </a>
        </div>

        <dl className="landing__facts">
          <div>
            <dt>Runtime</dt>
            <dd>Cloudflare Workers + Durable Objects + Workers AI</dd>
          </div>
          <div>
            <dt>Pricing</dt>
            <dd>Free on workers.dev · $12/yr domain · pay-as-you-go</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>You — every byte, every dollar</dd>
          </div>
        </dl>
      </main>

      <section className="landing__principles ot-container">
        <div className="landing__principles-head">
          <span className="landing__section-tag">Section 01</span>
          <h2 className="landing__principles-title">
            Six&nbsp;principles. <br />
            <em>Nothing else.</em>
          </h2>
          <p className="landing__principles-lede">
            The shape of OpenThink is fixed by six commitments. Everything we ship has to answer
            to them.
          </p>
        </div>
        <ol className="landing__principles-grid">
          {PRINCIPLES.map((p, i) => (
            <li
              key={p.title}
              className="landing__principle"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span className="landing__principle-num">{String(i + 1).padStart(2, '0')}</span>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing__pullquote ot-container">
        <span className="landing__pullquote-mark" aria-hidden>"</span>
        <blockquote>
          The product is the deployment, not the chat surface. The chat is just one
          window into the agent.
        </blockquote>
        <cite>— PRD v1.0, north star</cite>
      </section>

      <footer className="landing__footer ot-container">
        <span className="ot-micro">
          A NeoFlux project · <a href="https://openthink.run">openthink.run</a>
        </span>
        <span className="ot-micro">© 2026</span>
      </footer>
    </div>
  );
}

const MARQUEE = [
  'one token, ninety seconds',
  'your Cloudflare, not ours',
  'self-evolving · in the open',
  'shipped behind your email',
  'patches flow back upstream',
];

const PRINCIPLES = [
  {
    title: 'Yours, not ours.',
    body:
      "The agent runs on your Cloudflare account, at your domain, with your data. We never see a token, a prompt, or a memory.",
  },
  {
    title: 'Ninety seconds to "hi."',
    body: 'From landing page to first message: under 90 seconds wall-clock on the free path.',
  },
  {
    title: 'Progressive disclosure.',
    body:
      'Home screen looks like a chat app. Train mode looks like a whiteboard. The Cloudflare panel looks like Stripe. None of it visible until needed.',
  },
  {
    title: 'Self-evolving, in the open.',
    body:
      "The agent edits its own config, opens PRs to its own repo, and reconciles with an upstream you can pin or fork.",
  },
  {
    title: 'Multi-mode trust.',
    body:
      'Full auto, smart auto, manual. Per-tool overrides. Hard spend caps that override every other mode.',
  },
  {
    title: 'Agents talk to agents.',
    body:
      'The orchestrator and its specialists communicate via Durable Object RPC, not the public internet.',
  },
];

function DecorativeArrow({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="76"
      height="46"
      viewBox="0 0 76 46"
      fill="none"
      aria-hidden
    >
      <path
        d="M2 22c10-12 22-18 36-18 18 0 30 11 36 22"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeDasharray="3 4"
      />
      <path
        d="M64 18l10 8-12 8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
