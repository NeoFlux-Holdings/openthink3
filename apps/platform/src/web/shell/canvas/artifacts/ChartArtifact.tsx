import { useMemo } from 'react';

// A handwritten SVG chart instead of pulling in ECharts/Recharts. Two reasons:
//  - keeps the bundle lean for iteration 4 (~400 LOC vs ~600KB minified)
//  - the design language is already constrained (warm cream + accent orange), so
//    the chart benefits from matching the rest of the UI rather than fighting
//    the default Material-y styling that chart libraries ship with
// We swap to ECharts in iteration 5 once series count + interactivity warrant it.

interface Payload {
  kind: 'line' | 'bar' | 'area';
  series: Array<{
    name: string;
    points: Array<{ x: number | string; y: number }>;
  }>;
  yLabel?: string;
  xLabel?: string;
}

interface Props {
  payload: Payload;
  compact?: boolean;
}

const PALETTE = ['#E85D4A', '#2E8B57', '#1F5C8F', '#C58B1A', '#7B4FB5'];

export function ChartArtifact({ payload, compact }: Props) {
  const dims = useMemo(() => computeDims(payload), [payload]);
  const W = 640;
  const H = compact ? 180 : 260;
  const pad = { l: 44, r: 16, t: 16, b: 28 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const xScale = (i: number, max: number) => pad.l + (max <= 1 ? innerW / 2 : (i / (max - 1)) * innerW);
  const yScale = (v: number) =>
    pad.t + innerH - ((v - dims.yMin) / Math.max(1, dims.yMax - dims.yMin)) * innerH;

  return (
    <div className={`artifact-chart${compact ? ' artifact-chart--compact' : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img">
        {/* y grid */}
        {dims.ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={yScale(t)}
              y2={yScale(t)}
              stroke="var(--ot-rule)"
              strokeDasharray="2 4"
            />
            <text x={pad.l - 8} y={yScale(t) + 4} fontSize="10" textAnchor="end" fill="var(--ot-ink-mute)">
              {t}
            </text>
          </g>
        ))}

        {/* x axis */}
        <line
          x1={pad.l}
          x2={W - pad.r}
          y1={H - pad.b}
          y2={H - pad.b}
          stroke="var(--ot-rule)"
        />

        {/* series */}
        {payload.series.map((s, si) => {
          const color = PALETTE[si % PALETTE.length];
          const pts = s.points.map((p, i) => ({
            x: xScale(i, s.points.length),
            y: yScale(p.y),
            raw: p,
          }));
          if (payload.kind === 'bar') {
            const barW = Math.max(4, innerW / s.points.length - 8);
            return (
              <g key={s.name}>
                {pts.map((p, i) => (
                  <rect
                    key={i}
                    x={p.x - barW / 2}
                    y={p.y}
                    width={barW}
                    height={H - pad.b - p.y}
                    fill={color}
                    opacity={0.85}
                  />
                ))}
              </g>
            );
          }
          const path = pts
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
            .join(' ');
          const areaPath =
            payload.kind === 'area'
              ? `${path} L ${pts[pts.length - 1]?.x ?? pad.l} ${H - pad.b} L ${pts[0]?.x ?? pad.l} ${H - pad.b} Z`
              : null;
          return (
            <g key={s.name}>
              {areaPath && <path d={areaPath} fill={color} opacity={0.12} />}
              <path d={path} stroke={color} strokeWidth={2} fill="none" />
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={color} />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="artifact-chart__legend">
        {payload.series.map((s, si) => (
          <span key={s.name} className="artifact-chart__series">
            <span
              className="artifact-chart__swatch"
              style={{ background: PALETTE[si % PALETTE.length] }}
            />
            {s.name}
          </span>
        ))}
      </div>
      <style>{`
        .artifact-chart { padding: 14px 14px 10px; height: 100%; display: flex; flex-direction: column; }
        .artifact-chart svg { width: 100%; height: auto; flex: 1; min-height: 0; }
        .artifact-chart__legend { display: flex; gap: 16px; padding: 6px 4px 2px; font-size: 11px; color: var(--ot-ink-mute); flex-shrink: 0; }
        .artifact-chart__swatch { width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; display: inline-block; vertical-align: middle; }
      `}</style>
    </div>
  );
}

function computeDims(payload: Payload) {
  const ys = payload.series.flatMap((s) => s.points.map((p) => p.y));
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(...ys, 1);
  const span = yMax - yMin;
  const step = niceStep(span / 4);
  const ticks: number[] = [];
  for (let t = Math.ceil(yMin / step) * step; t <= yMax; t += step) ticks.push(t);
  return { yMin, yMax, ticks };
}

function niceStep(raw: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, raw))));
  const norm = raw / mag;
  if (norm < 1.5) return mag;
  if (norm < 3) return 2 * mag;
  if (norm < 7) return 5 * mag;
  return 10 * mag;
}
