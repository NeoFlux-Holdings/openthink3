interface Payload {
  title?: string;
  body: string; // markdown
}

interface Props {
  payload: Payload;
  compact?: boolean;
}

export function DocumentArtifact({ payload, compact }: Props) {
  // Iteration 4 keeps this dependency-free — we treat the body as paragraphs +
  // headings + bullet points without pulling in a full markdown parser. A real
  // ProseMirror/MDX editor lands in iteration 5 once the canvas has live editing.
  const blocks = parseSimpleMarkdown(payload.body);

  return (
    <div className={`artifact-document${compact ? ' artifact-document--compact' : ''}`}>
      <article className="artifact-document__body">
        {blocks.map((b, i) => {
          if (b.kind === 'h2') return <h2 key={i}>{b.text}</h2>;
          if (b.kind === 'h3') return <h3 key={i}>{b.text}</h3>;
          if (b.kind === 'ul')
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{it}</li>
                ))}
              </ul>
            );
          if (b.kind === 'quote') return <blockquote key={i}>{b.text}</blockquote>;
          return <p key={i}>{b.text}</p>;
        })}
      </article>
      <style>{`
        .artifact-document__body { padding: 24px 28px; max-width: 72ch; margin: 0 auto; font-family: var(--ot-font-display); font-weight: 300; line-height: 1.55; color: var(--ot-ink); font-size: 16px; }
        .artifact-document__body h2 { font-size: 26px; font-weight: 500; margin: 24px 0 8px; }
        .artifact-document__body h3 { font-size: 18px; font-weight: 500; margin: 20px 0 6px; }
        .artifact-document__body p { margin: 0 0 14px; }
        .artifact-document__body ul { padding-left: 22px; margin: 0 0 14px; }
        .artifact-document__body ul li::marker { color: var(--ot-accent); }
        .artifact-document__body blockquote { border-left: 3px solid var(--ot-accent); padding-left: 16px; color: var(--ot-ink-soft); margin: 16px 0; font-style: italic; }
        .artifact-document--compact .artifact-document__body { padding: 16px; font-size: 13px; line-height: 1.5; }
        .artifact-document--compact .artifact-document__body h2 { font-size: 16px; margin: 8px 0 4px; }
        .artifact-document--compact .artifact-document__body h3 { font-size: 14px; margin: 6px 0 2px; }
      `}</style>
    </div>
  );
}

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'ul'; items: string[] };

function parseSimpleMarkdown(src: string): Block[] {
  const lines = src.split(/\r?\n/);
  const out: Block[] = [];
  let para: string[] = [];
  let list: string[] | null = null;

  const flushPara = () => {
    if (para.length) {
      out.push({ kind: 'p', text: para.join(' ').trim() });
      para = [];
    }
  };
  const flushList = () => {
    if (list && list.length) {
      out.push({ kind: 'ul', items: list });
    }
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    if (line.startsWith('## ')) {
      flushPara();
      flushList();
      out.push({ kind: 'h2', text: line.slice(3) });
      continue;
    }
    if (line.startsWith('### ')) {
      flushPara();
      flushList();
      out.push({ kind: 'h3', text: line.slice(4) });
      continue;
    }
    if (line.startsWith('> ')) {
      flushPara();
      flushList();
      out.push({ kind: 'quote', text: line.slice(2) });
      continue;
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      flushPara();
      list = list ?? [];
      list.push(line.slice(2));
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out;
}
