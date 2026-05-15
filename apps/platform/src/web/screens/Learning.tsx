import { useEffect, useState } from 'react';
import './Learning.css';

interface Summary {
  skills: { total: number; pinned: number };
  memories: { total: number; byCategory: Record<string, number> };
  rubrics: { total: number; defaultId: string };
  pending: { count: number };
}

interface Props {
  agentName: string;
}

export function Learning({ agentName }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    void fetch('/api/learning/summary')
      .then((r) => r.json())
      .then((s: Summary) => setSummary(s))
      .catch(() => undefined);
  }, []);

  return (
    <div className="learning">
      <header className="learning__header">
        <h2>Learning</h2>
        <p className="learning__lede">
          What {agentName} has accumulated about you, the work, and the world.
        </p>
      </header>

      <div className="learning__cards">
        <SummaryCard
          title="Skills"
          value={summary?.skills.total ?? 0}
          extra={`${summary?.skills.pinned ?? 0} pinned`}
          description="Named procedures the agent has learned."
        />
        <SummaryCard
          title="Memories"
          value={summary?.memories.total ?? 0}
          extra={summary ? Object.values(summary.memories.byCategory).reduce((a, b) => a + b, 0) + ' across categories' : '—'}
          description="Facts about you, your work, and your preferences."
        />
        <SummaryCard
          title="Rubrics"
          value={summary?.rubrics.total ?? 0}
          extra={`default: ${summary?.rubrics.defaultId ?? '—'}`}
          description="Criteria used to score the agent's own runs."
        />
      </div>

      <section className="learning__section">
        <div className="learning__section-head">
          <h3>Pending suggestions</h3>
          <p className="ot-micro">
            Every trained run that left a pattern worth keeping. Accept what's useful;
            decline the rest.
          </p>
        </div>
        {summary && summary.pending.count > 0 ? (
          <ul className="learning__pending">
            <li>real pending list arrives with iteration 7's self-evolve loop.</li>
          </ul>
        ) : (
          <div className="learning__empty">
            <p className="ot-micro">No pending suggestions. {agentName} is up to date.</p>
          </div>
        )}
      </section>

      <section className="learning__section">
        <div className="learning__section-head">
          <h3>Categories</h3>
          <p className="ot-micro">Where memories land by default.</p>
        </div>
        <div className="learning__categories">
          {CATEGORIES.map((c) => (
            <article key={c.id} className="learning__category">
              <h4>{c.title}</h4>
              <p>{c.body}</p>
              <span className="ot-micro">{summary?.memories.byCategory[c.id] ?? 0} memories</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  extra,
  description,
}: {
  title: string;
  value: number;
  extra: string;
  description: string;
}) {
  return (
    <article className="summary-card">
      <h4>{title}</h4>
      <div className="summary-card__value">{value}</div>
      <div className="summary-card__extra">{extra}</div>
      <p className="summary-card__desc">{description}</p>
    </article>
  );
}

const CATEGORIES = [
  { id: 'user_facts', title: 'User facts', body: 'Stable details: name, role, location, working hours.' },
  { id: 'active_work', title: 'Active work', body: 'In-flight projects, blockers, next steps.' },
  { id: 'preferences', title: 'Preferences', body: 'How you like things — style, tone, defaults.' },
  { id: 'domain_knowledge', title: 'Domain knowledge', body: 'What you know that the agent should treat as ground truth.' },
  { id: 'people', title: 'People', body: 'The cast: collaborators, contacts, decision-makers.' },
];
