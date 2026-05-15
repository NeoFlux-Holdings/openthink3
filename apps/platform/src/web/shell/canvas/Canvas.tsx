import { useMemo, useState } from 'react';

import type { ArtifactRef, CanvasWindowMode } from '@shared/types';
import { DocumentArtifact } from './artifacts/DocumentArtifact';
import { CodeArtifact } from './artifacts/CodeArtifact';
import { TableArtifact } from './artifacts/TableArtifact';
import { ChartArtifact } from './artifacts/ChartArtifact';
import { ImageArtifact } from './artifacts/ImageArtifact';
import { SlidesArtifact } from './artifacts/SlidesArtifact';
import { WebpageArtifact } from './artifacts/WebpageArtifact';
import { BrowserSessionArtifact } from './artifacts/BrowserSessionArtifact';
import './Canvas.css';

export interface CanvasArtifact extends ArtifactRef {
  payload: unknown;
}

interface Props {
  artifacts: CanvasArtifact[];
  agentName: string;
}

const MODE_LABELS: Record<CanvasWindowMode, string> = {
  single: 'Single',
  grid: 'Grid',
  stack: 'Stack',
};

export function Canvas({ artifacts, agentName }: Props) {
  const [mode, setMode] = useState<CanvasWindowMode>('single');
  const [activeId, setActiveId] = useState<string | null>(artifacts[0]?.id ?? null);

  const active = useMemo(
    () => artifacts.find((a) => a.id === activeId) ?? artifacts[0],
    [artifacts, activeId],
  );

  if (artifacts.length === 0) {
    return (
      <div className="canvas canvas--empty">
        <header className="canvas__header">
          <span className="canvas__title">Artifacts</span>
          <span className="ot-micro">nothing yet</span>
        </header>
        <div className="canvas__empty-body">
          <p>
            Artifacts the agent creates land here. Documents, browser sessions, slides, code —
            each with its own version history and editable view.
          </p>
          <p className="ot-micro">Try asking {agentName} to "draft a one-pager" or "research X."</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`canvas canvas--${mode}`}>
      <header className="canvas__header">
        <span className="canvas__title">
          {mode === 'single' && active ? active.title : 'Artifacts'}
        </span>
        <div className="canvas__mode" role="tablist" aria-label="Canvas window mode">
          {(['single', 'grid', 'stack'] satisfies CanvasWindowMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`canvas__mode-opt${m === mode ? ' canvas__mode-opt--active' : ''}`}
              onClick={() => setMode(m)}
              aria-pressed={m === mode}
              aria-label={MODE_LABELS[m]}
            >
              <ModeIcon mode={m} />
            </button>
          ))}
        </div>
      </header>

      {mode === 'single' && active && (
        <div className="canvas__body canvas__body--single">
          <ArtifactFrame artifact={active}>{renderArtifact(active)}</ArtifactFrame>
        </div>
      )}

      {mode === 'grid' && (
        <div className="canvas__body canvas__body--grid" data-count={artifacts.length}>
          {artifacts.map((a) => (
            <ArtifactFrame
              key={a.id}
              artifact={a}
              compact
              onClick={() => {
                setActiveId(a.id);
                setMode('single');
              }}
            >
              {renderArtifact(a, { compact: true })}
            </ArtifactFrame>
          ))}
        </div>
      )}

      {mode === 'stack' && (
        <div className="canvas__body canvas__body--stack">
          {artifacts.map((a) => (
            <ArtifactFrame key={a.id} artifact={a}>
              {renderArtifact(a)}
            </ArtifactFrame>
          ))}
        </div>
      )}

      {mode === 'single' && artifacts.length > 1 && (
        <ThumbnailStrip
          artifacts={artifacts}
          activeId={active?.id ?? null}
          onSelect={(id) => setActiveId(id)}
        />
      )}
    </div>
  );
}

function ArtifactFrame({
  artifact,
  children,
  compact,
  onClick,
}: {
  artifact: CanvasArtifact;
  children: React.ReactNode;
  compact?: boolean;
  onClick?: () => void;
}) {
  return (
    <article
      className={`artifact artifact--${artifact.type}${compact ? ' artifact--compact' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <header className="artifact__header">
        <span className="artifact__glyph" aria-hidden>
          {GLYPHS[artifact.type] ?? '◇'}
        </span>
        <span className="artifact__title" title={artifact.title}>
          {artifact.title}
        </span>
        <span className="artifact__meta">
          <span className="artifact__version">v{artifact.version}</span>
          {!compact && (
            <>
              <button className="artifact__action" aria-label="Edit">
                ✎
              </button>
              <button className="artifact__action" aria-label="Pop out">
                ⤢
              </button>
              <button className="artifact__action" aria-label="Maximize">
                ⛶
              </button>
            </>
          )}
        </span>
      </header>
      <div className="artifact__body">{children}</div>
    </article>
  );
}

function ThumbnailStrip({
  artifacts,
  activeId,
  onSelect,
}: {
  artifacts: CanvasArtifact[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="canvas__strip" role="tablist" aria-label="Other artifacts">
      {artifacts.map((a) => (
        <button
          key={a.id}
          className={`thumb${a.id === activeId ? ' thumb--active' : ''}`}
          onClick={() => onSelect(a.id)}
          aria-pressed={a.id === activeId}
        >
          <span className="thumb__glyph" aria-hidden>
            {GLYPHS[a.type] ?? '◇'}
          </span>
          <span className="thumb__title">{a.title}</span>
        </button>
      ))}
    </div>
  );
}

function renderArtifact(a: CanvasArtifact, opts?: { compact?: boolean }) {
  switch (a.type) {
    case 'document':
      return <DocumentArtifact payload={a.payload as Parameters<typeof DocumentArtifact>[0]['payload']} compact={opts?.compact} />;
    case 'code':
      return <CodeArtifact payload={a.payload as Parameters<typeof CodeArtifact>[0]['payload']} compact={opts?.compact} />;
    case 'table':
      return <TableArtifact payload={a.payload as Parameters<typeof TableArtifact>[0]['payload']} compact={opts?.compact} />;
    case 'chart':
      return <ChartArtifact payload={a.payload as Parameters<typeof ChartArtifact>[0]['payload']} compact={opts?.compact} />;
    case 'image':
      return <ImageArtifact payload={a.payload as Parameters<typeof ImageArtifact>[0]['payload']} compact={opts?.compact} />;
    case 'slides':
      return <SlidesArtifact payload={a.payload as Parameters<typeof SlidesArtifact>[0]['payload']} compact={opts?.compact} />;
    case 'webpage':
      return <WebpageArtifact payload={a.payload as Parameters<typeof WebpageArtifact>[0]['payload']} compact={opts?.compact} />;
    case 'browser-session':
      return (
        <BrowserSessionArtifact
          payload={a.payload as Parameters<typeof BrowserSessionArtifact>[0]['payload']}
          compact={opts?.compact}
        />
      );
    default:
      return <div className="artifact__unknown">unsupported artifact type</div>;
  }
}

const GLYPHS: Record<ArtifactRef['type'], string> = {
  document: '📄',
  code: '⟨ ⟩',
  table: '⌗',
  chart: '◧',
  image: '🖼',
  slides: '▤',
  webpage: '◰',
  'browser-session': '🌐',
};

function ModeIcon({ mode }: { mode: CanvasWindowMode }) {
  if (mode === 'single') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        <rect x="2" y="2" width="10" height="10" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  if (mode === 'grid') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        <rect x="2" y="2" width="4" height="4" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <rect x="8" y="2" width="4" height="4" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <rect x="2" y="8" width="4" height="4" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <rect x="8" y="8" width="4" height="4" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <rect x="2" y="2" width="10" height="2.4" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="5.8" width="10" height="2.4" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="9.6" width="10" height="2.4" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
