/* Lightweight Markdown renderer for chat messages.
 *
 * Why not streamdown / react-markdown? Both bring large dep trees and
 * assume Tailwind. We only need the subset that shows up in agent
 * replies: paragraphs, **bold**, *italic*, `inline code`, ```code
 * blocks``` (with copy button), bullets / numbered lists, headings 1–3,
 * and links. ~150 lines of code, renders in our design tokens, and the
 * same parser is mirrored on the mobile app so the agent output looks
 * consistent across surfaces.
 *
 * Streaming-friendly: an incomplete trailing code fence renders as
 * partial code so token-by-token streams look right.
 *
 * If the assistant emits HTML, it stays as text — no innerHTML, no
 * XSS surface. The one rich element is the copy button on code blocks
 * which is a real React handler.
 */
import { useState } from 'react';

import './Markdown.css';

interface Props {
  source: string;
  /** Optional className appended to the wrapper for layout overrides. */
  className?: string;
}

export function Markdown({ source, className }: Props) {
  const blocks = parseMarkdown(source);
  return (
    <div className={'md-body' + (className ? ' ' + className : '')}>
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: MdBlock }) {
  switch (block.type) {
    case 'paragraph':
      return <p className="md-p">{renderInline(block.text)}</p>;
    case 'heading':
      if (block.level === 1) return <h1 className="md-h1">{renderInline(block.text)}</h1>;
      if (block.level === 2) return <h2 className="md-h2">{renderInline(block.text)}</h2>;
      return <h3 className="md-h3">{renderInline(block.text)}</h3>;
    case 'code':
      return <CodeBlock language={block.language} code={block.code} incomplete={block.incomplete} />;
    case 'quote':
      return <blockquote className="md-quote">{renderInline(block.text)}</blockquote>;
    case 'list':
      if (block.ordered) {
        return (
          <ol className="md-list md-list--ord">
            {block.items.map((it, i) => (
              <li key={i}>{renderInline(it)}</li>
            ))}
          </ol>
        );
      }
      return (
        <ul className="md-list">
          {block.items.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </ul>
      );
    case 'hr':
      return <hr className="md-hr" />;
  }
}

function CodeBlock({ code, language, incomplete }: { code: string; language?: string; incomplete?: boolean }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — silent fail is fine */
    }
  };
  return (
    <div className={'md-code' + (incomplete ? ' md-code--streaming' : '')}>
      <div className="md-code-head">
        <span className="md-code-lang">{language || 'text'}</span>
        <button type="button" className="md-code-copy" onClick={() => void onCopy()} aria-label="Copy code">
          {copied ? '✓ copied' : 'copy'}
        </button>
      </div>
      <pre className="md-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/* ---------- inline ---------- */

function renderInline(text: string): React.ReactNode[] {
  // Walk left to right, peeling off matches one at a time. Order matters:
  // bold (** **) must be tried before italic (* *) so `**x**` doesn't
  // parse as `*<i>x</i>*`. Same for ``` vs `.
  const out: React.ReactNode[] = [];
  let i = 0;
  let runStart = 0;
  const flushPlain = (until: number) => {
    if (until > runStart) out.push(text.slice(runStart, until));
  };
  while (i < text.length) {
    // Inline code
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        flushPlain(i);
        out.push(<code key={out.length} className="md-inline-code">{text.slice(i + 1, end)}</code>);
        i = end + 1;
        runStart = i;
        continue;
      }
    }
    // Bold
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i) {
        flushPlain(i);
        out.push(<strong key={out.length}>{renderInline(text.slice(i + 2, end))}</strong>);
        i = end + 2;
        runStart = i;
        continue;
      }
    }
    // Italic (single star, not part of bold)
    if (text[i] === '*') {
      const end = text.indexOf('*', i + 1);
      if (end > i && text[end + 1] !== '*') {
        flushPlain(i);
        out.push(<em key={out.length}>{renderInline(text.slice(i + 1, end))}</em>);
        i = end + 1;
        runStart = i;
        continue;
      }
    }
    // Link [text](url)
    if (text[i] === '[') {
      const close = text.indexOf(']', i + 1);
      if (close > i && text[close + 1] === '(') {
        const urlEnd = text.indexOf(')', close + 2);
        if (urlEnd > close) {
          flushPlain(i);
          const linkText = text.slice(i + 1, close);
          const href = text.slice(close + 2, urlEnd);
          out.push(
            <a key={out.length} href={href} className="md-a" target="_blank" rel="noreferrer">
              {linkText}
            </a>,
          );
          i = urlEnd + 1;
          runStart = i;
          continue;
        }
      }
    }
    i++;
  }
  flushPlain(text.length);
  return out;
}

/* ---------- parse ---------- */

export type MdBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'code'; language?: string; code: string; incomplete?: boolean }
  | { type: 'quote'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'hr' };

export function parseMarkdown(source: string): MdBlock[] {
  const out: MdBlock[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    // Blank line — skip
    if (!line.trim()) {
      i++;
      continue;
    }
    // Code block (fenced)
    const fence = /^```(\w+)?\s*$/.exec(line);
    if (fence) {
      const language = fence[1];
      const codeLines: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        const cur = lines[i] ?? '';
        if (/^```\s*$/.test(cur)) {
          closed = true;
          i++;
          break;
        }
        codeLines.push(cur);
        i++;
      }
      out.push({ type: 'code', language, code: codeLines.join('\n'), incomplete: !closed });
      continue;
    }
    // HR
    if (/^[-*_]{3,}\s*$/.test(line)) {
      out.push({ type: 'hr' });
      i++;
      continue;
    }
    // Heading
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length as 1 | 2 | 3;
      out.push({ type: 'heading', level, text: h[2]!.trim() });
      i++;
      continue;
    }
    // Quote
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('>')) {
        quoteLines.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i++;
      }
      out.push({ type: 'quote', text: quoteLines.join(' ') });
      continue;
    }
    // List (bullet or ordered)
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const ord = /^(\d+)\.\s+(.*)$/.exec(line);
    if (bullet || ord) {
      const ordered = !!ord;
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i] ?? '';
        const b = /^[-*]\s+(.*)$/.exec(cur);
        const o = /^(\d+)\.\s+(.*)$/.exec(cur);
        const m = ordered ? o : b;
        if (!m) break;
        items.push(m[ordered ? 2 : 1]!.trim());
        i++;
      }
      out.push({ type: 'list', ordered, items });
      continue;
    }
    // Paragraph — accumulate consecutive non-blank lines
    const pLines: string[] = [line];
    i++;
    while (i < lines.length) {
      const cur = lines[i] ?? '';
      if (!cur.trim()) break;
      // Stop if a block starter shows up
      if (/^(#{1,3})\s+/.test(cur) || /^```/.test(cur) || /^[-*]\s+/.test(cur) || /^\d+\.\s+/.test(cur) || cur.startsWith('>')) {
        break;
      }
      pLines.push(cur);
      i++;
    }
    out.push({ type: 'paragraph', text: pLines.join(' ') });
  }
  return out;
}
