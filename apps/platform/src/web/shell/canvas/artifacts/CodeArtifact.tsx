interface Payload {
  language: string;
  source: string;
  filename?: string;
}

interface Props {
  payload: Payload;
  compact?: boolean;
}

export function CodeArtifact({ payload, compact }: Props) {
  // We render syntax tokens via a tiny in-house highlighter rather than pulling
  // in Shiki/highlight.js for iteration 4. Shiki (via @pierre/diffs) replaces this
  // in iteration 7 when the diff view lands; the regex set below covers
  // TypeScript / JS / JSON / SQL well enough for in-canvas reading.
  const lines = payload.source.split(/\r?\n/);
  return (
    <div className={`artifact-code${compact ? ' artifact-code--compact' : ''}`}>
      {payload.filename && (
        <div className="artifact-code__filename">{payload.filename}</div>
      )}
      <pre className="artifact-code__pre">
        <code>
          {lines.map((line, i) => (
            <span className="artifact-code__line" key={i}>
              <span className="artifact-code__lineno">{i + 1}</span>
              <span
                className="artifact-code__content"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: highlight(line, payload.language) }}
              />
            </span>
          ))}
        </code>
      </pre>
      <style>{`
        .artifact-code { background: var(--ot-code-bg); color: var(--ot-code-ink); height: 100%; overflow: auto; }
        .artifact-code__filename { font-family: var(--ot-font-mono); font-size: 12px; padding: 8px 16px; color: var(--ot-code-mute); border-bottom: 1px solid rgba(255,255,255,0.05); }
        .artifact-code__pre { margin: 0; padding: 16px 16px 16px 0; font-size: 13px; line-height: 1.55; font-family: var(--ot-font-mono); }
        .artifact-code__line { display: grid; grid-template-columns: 48px 1fr; column-gap: 0; padding: 0; min-width: 100%; }
        .artifact-code__lineno { text-align: right; padding-right: 12px; color: var(--ot-code-mute); user-select: none; font-variant-numeric: tabular-nums; }
        .artifact-code__content { white-space: pre; overflow-x: visible; }
        .artifact-code .tok-kw { color: var(--ot-code-key); }
        .artifact-code .tok-str { color: var(--ot-code-str); }
        .artifact-code .tok-num { color: #c69ce0; }
        .artifact-code .tok-cmt { color: var(--ot-code-mute); font-style: italic; }
        .artifact-code .tok-fn { color: #82c8ff; }
        .artifact-code--compact .artifact-code__pre { padding: 10px 10px 10px 0; font-size: 11px; }
        .artifact-code--compact .artifact-code__lineno { padding-right: 8px; }
        .artifact-code--compact .artifact-code__line { grid-template-columns: 32px 1fr; }
      `}</style>
    </div>
  );
}

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'switch', 'case', 'break', 'continue', 'class', 'extends', 'implements',
  'interface', 'type', 'enum', 'import', 'from', 'export', 'default',
  'async', 'await', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'super',
  'static', 'public', 'private', 'protected', 'readonly', 'true', 'false', 'null',
  'undefined', 'void', 'in', 'of', 'as',
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE', 'CREATE', 'TABLE', 'INDEX', 'PRIMARY', 'KEY', 'NOT', 'NULL',
  'REFERENCES', 'DEFAULT', 'ON', 'CONFLICT', 'DO', 'UPDATE', 'EXCLUDED',
]);

function highlight(line: string, _lang: string): string {
  // Order matters: handle comments and strings first to avoid keyword bleed-in.
  const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tokens = tokenize(escaped);
  return tokens.map((t) => wrap(t)).join('');
}

interface Token {
  kind: 'kw' | 'str' | 'num' | 'cmt' | 'fn' | 'plain';
  text: string;
}

function tokenize(line: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);

    // Line comments (// or --)
    const cmt = rest.match(/^(\/\/[^\n]*|--[^\n]*|#[^\n]*)/);
    if (cmt) {
      out.push({ kind: 'cmt', text: cmt[0] });
      i += cmt[0].length;
      continue;
    }

    // Strings (single, double, backtick)
    const str = rest.match(/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/);
    if (str) {
      out.push({ kind: 'str', text: str[0] });
      i += str[0].length;
      continue;
    }

    // Numbers
    const num = rest.match(/^-?\d+(?:\.\d+)?/);
    if (num) {
      out.push({ kind: 'num', text: num[0] });
      i += num[0].length;
      continue;
    }

    // Identifiers / keywords / function calls
    const ident = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (ident) {
      const word = ident[0];
      if (KEYWORDS.has(word) || KEYWORDS.has(word.toUpperCase())) {
        out.push({ kind: 'kw', text: word });
      } else if (line[i + word.length] === '(') {
        out.push({ kind: 'fn', text: word });
      } else {
        out.push({ kind: 'plain', text: word });
      }
      i += word.length;
      continue;
    }

    // Single character / whitespace
    out.push({ kind: 'plain', text: line[i] ?? '' });
    i += 1;
  }
  return out;
}

function wrap(t: Token): string {
  if (t.kind === 'plain') return t.text;
  return `<span class="tok-${t.kind}">${t.text}</span>`;
}
