import { useState } from 'react';

interface Slide {
  title: string;
  bullets?: string[];
  body?: string;
}

interface Payload {
  slides: Slide[];
}

interface Props {
  payload: Payload;
  compact?: boolean;
}

export function SlidesArtifact({ payload, compact }: Props) {
  const [index, setIndex] = useState(0);
  const slide = payload.slides[index] ?? payload.slides[0];
  if (!slide) return <div className="artifact-slides__empty">no slides</div>;

  return (
    <div className={`artifact-slides${compact ? ' artifact-slides--compact' : ''}`}>
      <div className="artifact-slides__stage">
        <div className="artifact-slides__slide">
          <h3>{slide.title}</h3>
          {slide.body && <p>{slide.body}</p>}
          {slide.bullets && (
            <ul>
              {slide.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {!compact && (
        <div className="artifact-slides__controls">
          <button
            onClick={() => setIndex(Math.max(0, index - 1))}
            disabled={index === 0}
            aria-label="Previous slide"
          >
            ◀
          </button>
          <span className="artifact-slides__counter">
            {index + 1} / {payload.slides.length}
          </span>
          <button
            onClick={() => setIndex(Math.min(payload.slides.length - 1, index + 1))}
            disabled={index >= payload.slides.length - 1}
            aria-label="Next slide"
          >
            ▶
          </button>
        </div>
      )}
      <style>{`
        .artifact-slides { display: flex; flex-direction: column; height: 100%; }
        .artifact-slides__stage { flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px; background: var(--ot-bg-soft); }
        .artifact-slides__slide { max-width: 540px; width: 100%; background: var(--ot-bg-card); padding: 32px 36px; border-radius: var(--ot-radius-lg); box-shadow: var(--ot-shadow-md); }
        .artifact-slides__slide h3 { font-family: var(--ot-font-display); font-size: 28px; font-weight: 500; margin: 0 0 16px; letter-spacing: -0.02em; }
        .artifact-slides__slide p { font-size: 15px; color: var(--ot-ink-soft); margin: 0 0 12px; }
        .artifact-slides__slide ul { padding-left: 20px; margin: 8px 0 0; font-size: 14px; color: var(--ot-ink-soft); }
        .artifact-slides__slide ul li { margin-bottom: 6px; }
        .artifact-slides__slide ul li::marker { color: var(--ot-accent); }
        .artifact-slides__controls { display: flex; align-items: center; justify-content: center; gap: 14px; padding: 8px; border-top: 1px solid var(--ot-rule); background: var(--ot-bg-card); }
        .artifact-slides__controls button { padding: 4px 10px; border-radius: var(--ot-radius-xs); color: var(--ot-ink-mute); font-size: 12px; }
        .artifact-slides__controls button:hover:not([disabled]) { background: var(--ot-bg-soft); color: var(--ot-ink); }
        .artifact-slides__controls button[disabled] { opacity: 0.4; cursor: not-allowed; }
        .artifact-slides__counter { font-family: var(--ot-font-mono); font-size: 12px; color: var(--ot-ink-mute); }
        .artifact-slides--compact .artifact-slides__stage { padding: 12px; }
        .artifact-slides--compact .artifact-slides__slide { padding: 16px; }
        .artifact-slides--compact .artifact-slides__slide h3 { font-size: 16px; margin-bottom: 6px; }
        .artifact-slides--compact .artifact-slides__slide p { font-size: 11px; margin-bottom: 4px; }
      `}</style>
    </div>
  );
}
