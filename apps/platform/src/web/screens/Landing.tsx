import './Landing.css';

interface Props {
  onStart: () => void;
}

export function Landing({ onStart }: Props) {
  return (
    <div className="landing">
      <header className="ot-topbar">
        <div className="ot-container ot-topbar-inner">
          <a href="#" className="ot-brand">
            <span className="ot-brand-dot" />
            OpenThink
          </a>
          <nav className="landing__nav">
            <a href="https://github.com/NeoFlux-Holdings/openthink3" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="#/docs">Docs</a>
            <button className="ot-btn ot-btn--ghost" onClick={onStart}>
              Sign in
            </button>
          </nav>
        </div>
      </header>

      <main className="landing__hero ot-container">
        <span className="ot-eyebrow">A personal AI agent · v1.0</span>
        <h1 className="landing__title">Your agent. Your hardware. Ninety seconds.</h1>
        <p className="ot-lede landing__lede">
          OpenThink is a personal AI agent that lives on your own Cloudflare account. One token,
          ninety seconds, and the agent ships behind your email at a domain you control — talking
          to itself, evolving with you, and quietly contributing patches back upstream.
        </p>
        <div className="landing__cta">
          <button className="ot-btn" onClick={onStart}>
            Get an agent →
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
            <dd>Free path on workers.dev · $12/yr domain · pay-as-you-go</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>You — every byte, every dollar</dd>
          </div>
        </dl>
      </main>

      <section className="landing__principles ot-container">
        <h2>Five principles</h2>
        <ol className="landing__principles-grid">
          {PRINCIPLES.map((p, i) => (
            <li key={p.title} className="ot-card landing__principle">
              <span className="landing__principle-num">0{i + 1}</span>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="landing__footer ot-container">
        <span className="ot-micro">
          A NeoFlux project · <a href="https://openthink.run">openthink.run</a>
        </span>
      </footer>
    </div>
  );
}

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
      'The home screen looks like a chat app. Train mode looks like a whiteboard. The Cloudflare panel looks like Stripe. None of it is visible until needed.',
  },
  {
    title: 'Self-evolving, in the open.',
    body:
      'The agent edits its own config, opens PRs to its own repo, and reconciles with an upstream you can pin or fork.',
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
