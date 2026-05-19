// Shared modal artifact preview. Used by the Library tile click AND by the
// Knowledge tab when the user clicks a file/text/url item. Picks the right
// renderer for the content-type — inline <img>, sandboxed <iframe>, or
// <pre> text with cheap syntax highlighting for code — and exposes a
// Download link.
//
// We bring the body in as either text or a blob URL so the browser handles
// large file rendering. Object URLs are revoked on unmount.

import { useEffect, useMemo, useRef, useState } from 'react';
import './ArtifactPreview.css';

interface Props {
  source: string;            // R2 key OR external URL
  title: string;
  meta?: string;
  onClose: () => void;
  // Optional list navigation — pass these when the caller has a list of
  // artifacts and wants the modal to walk through them (← / → keys + chevron
  // buttons). When omitted, the modal is single-item and no chevrons render.
  onPrev?: () => void;
  onNext?: () => void;
  position?: { index: number; total: number };
  // Optional rename callback — when provided, the title becomes editable
  // (click to focus, Enter to commit, Esc to cancel). Library wires this
  // to PATCH /api/artifacts/<key>. Knowledge omits it (knowledge items
  // already rename via the Knowledge pane's text inputs).
  onRename?: (next: string) => Promise<boolean> | boolean;
}

export function ArtifactPreview({
  source,
  title,
  meta,
  onClose,
  onPrev,
  onNext,
  position,
  onRename,
}: Props) {
  // Rename state — only meaningful when `onRename` is supplied. Keeps the
  // edited draft and a "saving" flag so the input shows a beat of
  // feedback before committing.
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(title);
  const [renameSaving, setRenameSaving] = useState(false);

  // Reset the draft if the upstream `title` prop changes (e.g. parent
  // optimistically updated after a successful rename, or the user
  // walks ←/→ to a different artifact via the position chevrons).
  useEffect(() => {
    setRenameDraft(title);
    setRenaming(false);
  }, [title]);

  const commitRename = async () => {
    if (!onRename) return;
    const next = renameDraft.trim();
    if (!next || next === title) {
      setRenaming(false);
      setRenameDraft(title);
      return;
    }
    setRenameSaving(true);
    try {
      const ok = await onRename(next);
      if (!ok) {
        setRenameDraft(title);
      }
    } finally {
      setRenameSaving(false);
      setRenaming(false);
    }
  };
  const [body, setBody] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [contentType, setContentType] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // External URLs go straight to an iframe; only R2 keys get fetched.
  const isExternal = /^https?:\/\//i.test(source);

  useEffect(() => {
    if (isExternal) return;
    let cancelled = false;
    let url: string | null = null;
    const load = async () => {
      try {
        const res = await fetch(`/api/artifacts/${encodeURIComponent(source)}`);
        if (cancelled) return;
        if (!res.ok) {
          setErr(`HTTP ${res.status}`);
          return;
        }
        const ct = res.headers.get('Content-Type') ?? '';
        setContentType(ct);
        if (ct.startsWith('image/') || /text\/html/i.test(ct) || ct.includes('pdf')) {
          const blob = await res.blob();
          url = URL.createObjectURL(blob);
          if (!cancelled) setBlobUrl(url);
        } else {
          const text = await res.text();
          if (!cancelled) setBody(text);
        }
      } catch (loadErr) {
        if (!cancelled) setErr(loadErr instanceof Error ? loadErr.message : 'load failed');
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, isExternal]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore arrow keys while focus is in an input / contenteditable so
      // the user can edit metadata in surrounding pages without the modal
      // hijacking their cursor.
      const t = e.target as HTMLElement | null;
      const editing =
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          (t as HTMLElement).isContentEditable);
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (editing) return;
      if (e.key === 'ArrowLeft' && onPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'ArrowRight' && onNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  return (
    <div className="art-preview" role="dialog" aria-label={`Viewing ${title}`}>
      <button type="button" className="art-preview__scrim" aria-label="Close" onClick={onClose} />
      {onPrev && (
        <button
          type="button"
          className="art-preview__chevron art-preview__chevron--prev"
          aria-label="Previous artifact"
          onClick={onPrev}
        >
          ‹
        </button>
      )}
      {onNext && (
        <button
          type="button"
          className="art-preview__chevron art-preview__chevron--next"
          aria-label="Next artifact"
          onClick={onNext}
        >
          ›
        </button>
      )}
      <article className="art-preview__panel">
        <header className="art-preview__head">
          <div>
            {renaming && onRename ? (
              <input
                className="ot-input art-preview__title-input"
                value={renameDraft}
                autoFocus
                disabled={renameSaving}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => void commitRename()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void commitRename();
                  } else if (e.key === 'Escape') {
                    setRenaming(false);
                    setRenameDraft(title);
                  }
                }}
                aria-label="Rename artifact"
              />
            ) : (
              <h3
                className={`art-preview__title${onRename ? ' art-preview__title--editable' : ''}`}
                onClick={() => onRename && setRenaming(true)}
                title={onRename ? 'Click to rename' : undefined}
              >
                {title}
              </h3>
            )}
            {meta && <span className="ot-micro">{meta}</span>}
            {position && position.total > 1 && (
              <span className="art-preview__position">
                {position.index + 1} of {position.total}
              </span>
            )}
          </div>
          <button type="button" className="ot-btn ot-btn--ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="art-preview__body">
          {isExternal ? (
            <iframe
              title={title}
              src={source}
              sandbox=""
              className="art-preview__iframe"
              referrerPolicy="no-referrer"
            />
          ) : err ? (
            <p className="art-preview__error">Couldn't load: {err}</p>
          ) : blobUrl && contentType.startsWith('image/') ? (
            <ImageZoomer src={blobUrl} alt={title} />
          ) : blobUrl && /text\/html/i.test(contentType) ? (
            <iframe title={title} src={blobUrl} sandbox="" className="art-preview__iframe" />
          ) : blobUrl && contentType.includes('pdf') ? (
            <iframe title={title} src={blobUrl} className="art-preview__iframe" />
          ) : body !== null ? (
            <CodePreview source={source} body={body} contentType={contentType} />
          ) : (
            <p className="ot-micro">loading…</p>
          )}
        </div>
        <footer className="art-preview__foot">
          {isExternal ? (
            <a className="ot-btn ot-btn--ghost" href={source} target="_blank" rel="noreferrer">
              Open in new tab ↗
            </a>
          ) : (
            <button
              type="button"
              className="ot-btn ot-btn--ghost"
              onClick={(e) => {
                // Default filename = the artifact title sanitized to safe
                // filesystem chars + the extension inferred from
                // content-type (fallback: the key's basename so existing
                // R2-stored extensions survive).
                const sanitize = (s: string) =>
                  s
                    .replace(/[\\/:*?"<>|]/g, '_')
                    .replace(/\s+/g, ' ')
                    .trim();
                const baseFromKey = source.split('/').pop() || 'artifact';
                const extFromKey = baseFromKey.includes('.')
                  ? baseFromKey.slice(baseFromKey.lastIndexOf('.'))
                  : '';
                const extFromType = inferExtensionFromContentType(contentType);
                const ext = extFromKey || extFromType || '';
                const titleStem = sanitize(title) || baseFromKey.replace(ext, '');
                const suggested = `${titleStem}${ext}`;
                // Option/Alt-click → skip the prompt and use the default
                // (matches the prior fire-and-forget behavior for power
                // users who reflexively go "click → download").
                let filename = suggested;
                if (!e.altKey) {
                  const picked = window.prompt(
                    'Save as…',
                    suggested,
                  );
                  if (picked === null) return; // user cancelled
                  filename = sanitize(picked) || suggested;
                }
                // Fetch the body as a blob so we control the download
                // filename via <a download="…">. The native href+download
                // attr respected only same-origin and the browser used
                // the URL's basename for the suggested name — both
                // problems we now solve.
                const a = document.createElement('a');
                a.href = `/api/artifacts/${encodeURIComponent(source)}`;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
              }}
              title="Download (option-click to skip the rename prompt)"
            >
              Download
            </button>
          )}
        </footer>
      </article>
    </div>
  );
}

// Map a content-type to a sensible filename extension for the
// download-save-as flow. Covers the common cases we actually serve from
// R2 (PNGs, JSON, markdown, plaintext, HTML, PDF). Returns '' when the
// type is unknown so the caller falls back to the key's basename ext.
function inferExtensionFromContentType(ct: string): string {
  const t = ct.toLowerCase();
  if (t.includes('png')) return '.png';
  if (t.includes('jpeg') || t.includes('jpg')) return '.jpg';
  if (t.includes('gif')) return '.gif';
  if (t.includes('webp')) return '.webp';
  if (t.includes('svg')) return '.svg';
  if (t.includes('pdf')) return '.pdf';
  if (t.includes('json')) return '.json';
  if (t.includes('markdown')) return '.md';
  if (t.includes('html')) return '.html';
  if (t.includes('csv')) return '.csv';
  if (t.includes('javascript')) return '.js';
  if (t.includes('typescript')) return '.ts';
  if (t.includes('python')) return '.py';
  if (t.startsWith('text/')) return '.txt';
  return '';
}

// Cheap, dependency-free syntax highlighter. We classify a small set of
// languages by file extension or content-type, then a single-pass regex
// replace tags keywords / strings / numbers / comments with span-wrapped
// tokens. Good enough for the artifact viewer; users who need a real
// editor get a download button.
const KEYWORDS: Record<string, string[]> = {
  ts: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'import', 'from', 'export', 'class', 'interface', 'type', 'async', 'await', 'as', 'new', 'this', 'extends', 'implements'],
  js: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'import', 'from', 'export', 'class', 'async', 'await', 'new', 'this'],
  py: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'import', 'from', 'as', 'try', 'except', 'with', 'lambda', 'yield', 'pass', 'in', 'not', 'and', 'or'],
  go: ['package', 'import', 'func', 'return', 'if', 'else', 'for', 'range', 'var', 'const', 'type', 'struct', 'interface', 'go', 'defer', 'chan'],
  rs: ['fn', 'let', 'mut', 'pub', 'use', 'mod', 'struct', 'enum', 'impl', 'trait', 'match', 'return', 'if', 'else', 'for', 'while', 'loop', 'async', 'await'],
  sql: ['select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'index', 'join', 'on', 'as', 'group', 'by', 'order', 'limit'],
  md: [],
  json: [],
};

function detectLanguage(source: string, contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('json')) return 'json';
  if (ct.includes('markdown')) return 'md';
  const ext = source.toLowerCase().split('.').pop() ?? '';
  if (['ts', 'tsx', 'js', 'jsx', 'mjs'].includes(ext)) return ext.startsWith('ts') ? 'ts' : 'js';
  if (['py', 'pyi'].includes(ext)) return 'py';
  if (ext === 'go') return 'go';
  if (ext === 'rs') return 'rs';
  if (ext === 'sql') return 'sql';
  if (['md', 'markdown'].includes(ext)) return 'md';
  if (ext === 'json') return 'json';
  return '';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlight(body: string, lang: string): string {
  const escaped = escapeHtml(body);
  if (!lang) return escaped;
  const keywords = KEYWORDS[lang] ?? [];

  // Order matters — comments first so we don't tokenize inside them, then
  // strings, then numbers/keywords. We don't try to be a real lexer; this
  // is a heuristic dressing.
  let out = escaped;

  if (['ts', 'js', 'go', 'rs', 'sql'].includes(lang)) {
    out = out.replace(/(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g, '<span class="ap-tok ap-tok--cmt">$1</span>');
    if (lang === 'sql') {
      out = out.replace(/(--[^\n]*)/g, '<span class="ap-tok ap-tok--cmt">$1</span>');
    }
  } else if (lang === 'py') {
    out = out.replace(/(#[^\n]*)/g, '<span class="ap-tok ap-tok--cmt">$1</span>');
  }

  out = out.replace(
    /(["'`])((?:\\.|(?!\1).)*)\1/g,
    '<span class="ap-tok ap-tok--str">$1$2$1</span>',
  );

  out = out.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="ap-tok ap-tok--num">$1</span>');

  if (keywords.length > 0) {
    const re = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');
    out = out.replace(re, '<span class="ap-tok ap-tok--kw">$1</span>');
  }

  return out;
}

function CodePreview({
  source,
  body,
  contentType,
}: {
  source: string;
  body: string;
  contentType: string;
}) {
  const lang = useMemo(() => detectLanguage(source, contentType), [source, contentType]);
  const html = useMemo(() => highlight(body, lang), [body, lang]);
  const [copied, setCopied] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findCursor, setFindCursor] = useState(0);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (insecure context, etc.) */
    }
  };

  // Compute match positions for the current query. Active match index
  // walks via ↑/↓ arrows or the prev/next buttons.
  const findMatches = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!q) return [] as Array<{ index: number; length: number }>;
    const lower = body.toLowerCase();
    const out: Array<{ index: number; length: number }> = [];
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(q, from);
      if (at < 0) break;
      out.push({ index: at, length: q.length });
      from = at + q.length;
    }
    return out;
  }, [findQuery, body]);

  // Render body as plain text with match spans when searching, otherwise
  // use the syntax-highlighted HTML.
  const renderedBody = useMemo(() => {
    if (!findOpen || findMatches.length === 0) return null;
    const parts: React.ReactNode[] = [];
    let last = 0;
    for (let i = 0; i < findMatches.length; i++) {
      const m = findMatches[i]!;
      if (m.index > last) parts.push(body.slice(last, m.index));
      parts.push(
        <mark
          key={`m-${i}`}
          className={`art-preview__find-match${i === findCursor ? ' art-preview__find-match--active' : ''}`}
        >
          {body.slice(m.index, m.index + m.length)}
        </mark>,
      );
      last = m.index + m.length;
    }
    if (last < body.length) parts.push(body.slice(last));
    return parts;
  }, [findOpen, findMatches, findCursor, body]);

  useEffect(() => {
    if (findCursor >= findMatches.length && findMatches.length > 0) {
      setFindCursor(0);
    }
  }, [findMatches.length, findCursor]);

  return (
    <div className="art-preview__code-wrap">
      <div className="art-preview__code-actions">
        <button
          type="button"
          className={`art-preview__find-toggle${findOpen ? ' art-preview__find-toggle--on' : ''}`}
          onClick={() => {
            setFindOpen((v) => {
              const next = !v;
              if (!next) setFindQuery('');
              return next;
            });
          }}
          aria-label="Find in artifact"
          title="Find in artifact"
        >
          ⌕ Find
        </button>
        <button
          type="button"
          className={`art-preview__copy${copied ? ' art-preview__copy--ok' : ''}`}
          onClick={() => void copy()}
          aria-label="Copy to clipboard"
          title={copied ? 'Copied' : 'Copy'}
        >
          {copied ? '✓ Copied' : '⧉ Copy'}
        </button>
      </div>
      {findOpen && (
        <div className="art-preview__find-bar">
          <input
            autoFocus
            className="art-preview__find-input"
            placeholder="Find in artifact…"
            value={findQuery}
            onChange={(e) => {
              setFindQuery(e.target.value);
              setFindCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFindOpen(false);
                setFindQuery('');
              } else if (e.key === 'Enter' && findMatches.length > 0) {
                e.preventDefault();
                setFindCursor((c) =>
                  e.shiftKey
                    ? (c - 1 + findMatches.length) % findMatches.length
                    : (c + 1) % findMatches.length,
                );
              } else if (e.key === 'ArrowDown' && findMatches.length > 0) {
                e.preventDefault();
                setFindCursor((c) => (c + 1) % findMatches.length);
              } else if (e.key === 'ArrowUp' && findMatches.length > 0) {
                e.preventDefault();
                setFindCursor((c) => (c - 1 + findMatches.length) % findMatches.length);
              }
            }}
          />
          <span className="art-preview__find-count">
            {findQuery.trim() === ''
              ? 'type to find'
              : findMatches.length === 0
                ? 'no matches'
                : `${findCursor + 1} / ${findMatches.length}`}
          </span>
        </div>
      )}
      {findOpen && renderedBody ? (
        <pre className="art-preview__pre art-preview__pre--code">{renderedBody}</pre>
      ) : lang ? (
        <pre
          className={`art-preview__pre art-preview__pre--code art-preview__pre--${lang}`}
          // We escape user input above, so dangerouslySetInnerHTML is safe here.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="art-preview__pre">{body}</pre>
      )}
    </div>
  );
}

// Image artifact viewer with zoom + pan. Scroll-wheel zoom (between 1x
// and 6x), drag to pan when zoomed, double-click to reset. The transform
// is held in component state so the original blob URL isn't redrawn —
// just the CSS transform on the wrapped <img>. Compact controls in the
// top-right offer keyboard-friendly +/-/reset.
function ImageZoomer({ src, alt }: { src: string; alt: string }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  const reset = () => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    // ctrl+wheel is the OS-native trackpad pinch on most browsers, but
    // plain wheel works too because we explicitly want this to zoom in
    // the viewer rather than scroll the page.
    e.preventDefault();
    const delta = -Math.sign(e.deltaY) * 0.18;
    setScale((s) => Math.max(1, Math.min(6, +(s + delta).toFixed(2))));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scale <= 1) return; // no pan when not zoomed
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: pos.x,
      baseY: pos.y,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setPos({
      x: d.baseX + (e.clientX - d.startX),
      y: d.baseY + (e.clientY - d.startY),
    });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    }
    dragRef.current = null;
  };

  return (
    <div
      className={`art-preview__image-wrap${scale > 1 ? ' art-preview__image-wrap--panable' : ''}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={reset}
    >
      <img
        src={src}
        alt={alt}
        className="art-preview__image"
        draggable={false}
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          cursor: scale > 1 ? (dragRef.current ? 'grabbing' : 'grab') : 'zoom-in',
        }}
      />
      <div className="art-preview__image-controls">
        <button
          type="button"
          onClick={() => setScale((s) => Math.max(1, +(s - 0.25).toFixed(2)))}
          aria-label="Zoom out"
          disabled={scale <= 1}
        >
          −
        </button>
        <span className="art-preview__image-zoom">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          onClick={() => setScale((s) => Math.min(6, +(s + 0.25).toFixed(2)))}
          aria-label="Zoom in"
          disabled={scale >= 6}
        >
          +
        </button>
        <button
          type="button"
          onClick={reset}
          aria-label="Reset zoom"
          title="Reset (or double-click image)"
          disabled={scale === 1 && pos.x === 0 && pos.y === 0}
        >
          ⌖
        </button>
      </div>
    </div>
  );
}
