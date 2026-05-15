import { useEffect, useState } from 'react';
import type { Skill } from '@shared/types';
import './Skills.css';

interface Props {
  agentName: string;
}

const PACKS: Array<{
  id: string;
  source: Skill['source'] | 'multiple';
  title: string;
  description: string;
  defaultEnabled: boolean;
}> = [
  {
    id: 'pack:cloudflare',
    source: 'cloudflare',
    title: 'Cloudflare',
    description: 'Workers, DOs, Sandbox, Wrangler, Web Perf, MCP builders, plus the bundled CF MCP servers.',
    defaultEnabled: true,
  },
  {
    id: 'pack:anthropic-core',
    source: 'anthropic',
    title: 'Anthropic core',
    description: 'skill-creator, mcp-builder, webapp-testing, frontend-design, docx/pdf/xlsx/pptx, brand-guidelines.',
    defaultEnabled: false,
  },
  {
    id: 'pack:openai-core',
    source: 'openai',
    title: 'OpenAI core',
    description: 'skill-creator, cloudflare-deploy, gh-address-comments, gh-fix-ci, imagegen, jupyter-notebook.',
    defaultEnabled: false,
  },
  {
    id: 'pack:aihero',
    source: 'aihero',
    title: 'aihero',
    description: '/grill-me, /domain-model, /to-prd, /to-issues, /tdd, /triage, /handoff, /prototype, /review.',
    defaultEnabled: false,
  },
  {
    id: 'pack:gstack',
    source: 'gstack',
    title: 'gstack',
    description: '23 slash commands + 8 power tools simulating an engineering team.',
    defaultEnabled: false,
  },
  {
    id: 'pack:gbrain',
    source: 'gbrain',
    title: 'gbrain',
    description: 'Persistent knowledge base + 34 skills + dispatcher. Hybrid vector + graph.',
    defaultEnabled: false,
  },
];

export function Skills({ agentName }: Props) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activePack, setActivePack] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/skills')
      .then((r) => r.json())
      .then((data: { skills: Skill[] }) => setSkills(data.skills))
      .catch(() => undefined);
  }, []);

  const toggleSkill = async (id: string) => {
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
    );
    void fetch(`/api/skills/${id}/toggle`, { method: 'POST' }).catch(() => undefined);
  };

  return (
    <div className="skills-page">
      <header className="skills-page__header">
        <h2>Skills</h2>
        <p className="skills-page__lede">
          Reusable procedures {agentName} can run. Packs come from the Anthropic, OpenAI,
          Cloudflare, aihero, gstack, and gbrain ecosystems — one parser, four catalogs.
        </p>
      </header>

      <section className="skills-page__section">
        <div className="skills-page__section-head">
          <h3>Packs</h3>
          <p className="ot-micro">Toggle whole catalogs on or off.</p>
        </div>
        <div className="skills-page__packs">
          {PACKS.map((pack) => (
            <div
              key={pack.id}
              className={`skill-pack${activePack === pack.id ? ' skill-pack--active' : ''}`}
              role="group"
              aria-label={pack.title}
            >
              <div className="skill-pack__head">
                <button
                  type="button"
                  className="skill-pack__title-btn"
                  onClick={() => setActivePack(pack.id === activePack ? null : pack.id)}
                >
                  {pack.title}
                </button>
                <SkillToggle on={pack.defaultEnabled} />
              </div>
              <p className="skill-pack__desc">{pack.description}</p>
              <span className="ot-micro">{pack.id}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="skills-page__section">
        <div className="skills-page__section-head">
          <h3>Installed skills</h3>
          <p className="ot-micro">
            Discover-by-default: skills auto-load when their <code>description</code> and{' '}
            <code>when_to_use</code> match the conversation.
          </p>
        </div>
        <ul className="skills-page__list">
          {skills.map((s) => (
            <li key={s.id} className={`skill-row${s.enabled ? '' : ' skill-row--off'}`}>
              <div>
                <div className="skill-row__name">
                  {s.name}{' '}
                  <span className="ot-pill ot-pill--accent">{s.source}</span>
                  <span className="ot-micro" style={{ marginLeft: 8 }}>v{s.version}</span>
                </div>
                <div className="skill-row__desc">{s.description}</div>
                {s.whenToUse && <div className="skill-row__when">When: {s.whenToUse}</div>}
              </div>
              <SkillToggle on={s.enabled} onClick={() => toggleSkill(s.id)} />
            </li>
          ))}
          {skills.length === 0 && (
            <li className="ot-micro" style={{ padding: '12px 16px' }}>
              The skill registry is online but empty. Install a pack above, or run
              the <code>skill-creator</code> skill to make one from a recent
              trained run.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

function SkillToggle({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return (
    <button
      className={`skill-toggle${on ? ' skill-toggle--on' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      aria-pressed={on}
      aria-label={on ? 'Disable' : 'Enable'}
    >
      <span className="skill-toggle__dot" />
    </button>
  );
}
