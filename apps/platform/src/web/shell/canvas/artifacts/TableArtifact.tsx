interface Payload {
  columns: Array<{ key: string; label: string; align?: 'left' | 'right' | 'center' }>;
  rows: Array<Record<string, string | number | boolean | null>>;
}

interface Props {
  payload: Payload;
  compact?: boolean;
}

export function TableArtifact({ payload, compact }: Props) {
  return (
    <div className={`artifact-table${compact ? ' artifact-table--compact' : ''}`}>
      <div className="artifact-table__scroll">
        <table>
          <thead>
            <tr>
              {payload.columns.map((c) => (
                <th key={c.key} style={{ textAlign: c.align ?? 'left' }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payload.rows.map((row, i) => (
              <tr key={i}>
                {payload.columns.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align ?? 'left' }}>
                    {formatCell(row[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <style>{`
        .artifact-table__scroll { overflow: auto; height: 100%; }
        .artifact-table table { width: 100%; border-collapse: collapse; font-size: 13px; font-family: var(--ot-font-ui); }
        .artifact-table th { background: var(--ot-bg-soft); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ot-ink-mute); padding: 10px 14px; border-bottom: 1px solid var(--ot-rule); text-align: left; }
        .artifact-table td { padding: 10px 14px; border-bottom: 1px solid var(--ot-rule-soft); color: var(--ot-ink); font-variant-numeric: tabular-nums; }
        .artifact-table tbody tr:last-child td { border-bottom: none; }
        .artifact-table tbody tr:hover td { background: var(--ot-bg-soft); }
        .artifact-table--compact th, .artifact-table--compact td { padding: 6px 10px; font-size: 11px; }
      `}</style>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? '✓' : '·';
  return String(v);
}
