import { Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../env';

export const audit = new Hono<{ Bindings: Env; Variables: Variables }>();

// PRD §10 audit/compliance surface — every consequential action by the agent
// gets a row in D1 `audit_log`. We expose two surfaces:
//
//   GET  /api/audit/<agent>     — paginated list, newest first, optionally
//                                 filtered by kind. Drives the Settings →
//                                 Danger zone audit tail + downstream
//                                 forensics tooling.
//   POST /api/audit/<agent>     — append a row. Called by the orchestrator
//                                 over fetch (DOs can't share modules with
//                                 the Hono app cleanly, so we cross the
//                                 wire — this also keeps the schema simple).
//
// Kinds:
//   tool_call   user-visible side effect (researcher.research, coder.exec, etc)
//   approval    mode change (full_auto / smart_auto / manual)
//   spend       cap exceeded or charged
//   sync        upstream pull or PR-back
//   pr_back     specifically a PR opened by the agent
//   skill_save  Train-mode "save as skill" accept
//   provision   deploy lifecycle event (cf_access provisioning, domain, etc)

const KindEnum = z.enum([
  'tool_call',
  'approval',
  'spend',
  'sync',
  'pr_back',
  'skill_save',
  'provision',
  'danger',
]);

const AppendBody = z.object({
  kind: KindEnum,
  payload: z.unknown(),
});

audit.get('/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const kindFilter = c.req.query('kind');
  const fromTs = Number(c.req.query('from') ?? '');
  const toTs = Number(c.req.query('to') ?? '');
  const beforeTs = Number(c.req.query('before') ?? '');
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') ?? '50')));

  // Build the WHERE dynamically so we don't pay for filters the caller
  // didn't ask for. `payload LIKE` is the cheapest cross-kind text search;
  // we lower-case both sides via SQLite's `lower()`.
  //
  // `before` is the infinite-scroll cursor — pass the `createdAt` of the
  // oldest row from the previous page and we'll fetch what's before it.
  // Optional cross-agent surfacing for `__system__`-tagged rows
  // (danger actions written before/after an agent wipe; bulk-restore
  // events that aren't tied to a single agent_id). Defaults to ON
  // so users naturally see their destructive trail without having
  // to know about the sentinel. Pass `?includeSystem=0` to scope
  // strictly to the agent.
  const includeSystem = c.req.query('includeSystem') !== '0';
  const wheres: string[] = [
    includeSystem ? "(agent_id = ? OR agent_id = '__system__')" : 'agent_id = ?',
  ];
  const params: Array<string | number> = [agentId];
  if (kindFilter) {
    // Comma-separated list of kinds → `kind IN (?, ?, ...)`. Single
    // kind still works (one-element IN). Stops short of accepting
    // arbitrary SQL by treating the input as a fixed-size param list.
    const kinds = kindFilter
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length < 40);
    if (kinds.length === 1) {
      wheres.push('kind = ?');
      params.push(kinds[0]!);
    } else if (kinds.length > 1) {
      const placeholders = kinds.map(() => '?').join(',');
      wheres.push(`kind IN (${placeholders})`);
      params.push(...kinds);
    }
  }
  if (Number.isFinite(fromTs) && fromTs > 0) {
    wheres.push('created_at >= ?');
    params.push(fromTs);
  }
  if (Number.isFinite(toTs) && toTs > 0) {
    wheres.push('created_at <= ?');
    params.push(toTs);
  }
  if (Number.isFinite(beforeTs) && beforeTs > 0) {
    wheres.push('created_at < ?');
    params.push(beforeTs);
  }
  if (q) {
    wheres.push("lower(payload) LIKE ?");
    params.push(`%${q}%`);
  }

  try {
    const sql = `SELECT id, agent_id, kind, payload, created_at FROM audit_log
                 WHERE ${wheres.join(' AND ')}
                 ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);
    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<AuditRow>();
    const entries = (rows.results ?? []).map((r) => ({
      id: r.id,
      kind: r.kind,
      payload: safeParseJson(r.payload),
      createdAt: r.created_at,
      // Expose the source agent so the UI can mark `__system__` rows
      // with a distinct chrome.
      agentId: r.agent_id,
    }));
    return c.json({
      entries,
      hasMore: entries.length === limit,
      oldest: entries[entries.length - 1]?.createdAt ?? null,
      source: 'd1',
    });
  } catch (err) {
    console.warn('[audit] read failed, returning stub', err);
    return c.json({
      entries: stubEntries(agentId),
      source: 'stub',
    });
  }
});

// Streaming export — for users who want every audit row going back N
// days, not just the 50 in the paginated view. Streams JSON Lines so
// the browser doesn't have to materialize the full array in memory
// before the download starts; downstream tools (jq, Athena) prefer
// JSONL anyway. Accepts the same filter set as the GET, plus a
// `days` window (defaults to 30) capping how far back we walk.
//
// We paginate in batches of 500 so a 50k-row export doesn't blow
// the worker's CPU budget on a single query, streaming each batch's
// rows as they come back. The browser starts saving the moment the
// first chunk lands, giving the user feedback even on a slow link.
// Per-kind row counts respecting every filter EXCEPT kind itself.
// Powers the inline `(N)` chips on the Audit filter toolbar so users
// can see how much of each kind exists in the current date / search /
// system-include window before clicking through. Deliberately omits
// the `kind` URL param — counting "how many tool_call rows would I
// get if I added that filter" needs the unfiltered kind axis. Cheap
// single-query `GROUP BY kind` so the call is fast even on a 50k-row
// audit log.
audit.get('/:agentId/counts', async (c) => {
  const agentId = c.req.param('agentId');
  const fromTs = Number(c.req.query('from') ?? '');
  const toTs = Number(c.req.query('to') ?? '');
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const includeSystem = c.req.query('includeSystem') !== '0';
  const wheres: string[] = [
    includeSystem ? "(agent_id = ? OR agent_id = '__system__')" : 'agent_id = ?',
  ];
  const params: Array<string | number> = [agentId];
  if (Number.isFinite(fromTs) && fromTs > 0) {
    wheres.push('created_at >= ?');
    params.push(fromTs);
  }
  if (Number.isFinite(toTs) && toTs > 0) {
    wheres.push('created_at <= ?');
    params.push(toTs);
  }
  if (q) {
    wheres.push("lower(payload) LIKE ?");
    params.push(`%${q}%`);
  }
  try {
    const sql = `SELECT kind, COUNT(*) as n FROM audit_log
                 WHERE ${wheres.join(' AND ')}
                 GROUP BY kind`;
    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<{ kind: string; n: number }>();
    const counts: Record<string, number> = {};
    let total = 0;
    for (const r of rows.results ?? []) {
      counts[r.kind] = r.n;
      total += r.n;
    }
    return c.json({ counts, total, source: 'd1' });
  } catch (err) {
    console.warn('[audit] counts read failed, returning stub', err);
    // Fallback: empty map so the UI hides the chips rather than
    // crashing. The standard list endpoint still works; this only
    // affects the per-chip tally annotation.
    return c.json({ counts: {}, total: 0, source: 'stub' });
  }
});

// Per-day histogram for the audit timeline. Powers a small 14-bar
// sparkline above the audit list so users can spot quiet/loud days
// at a glance + click a bar to scope the filter to that day.
// Reuses the same WHERE shape as the list + counts endpoints (date
// / search / system-include) but never honors `kind` — the
// histogram is the macro view; kind filters narrow what's rendered
// inside it.
audit.get('/:agentId/histogram', async (c) => {
  const agentId = c.req.param('agentId');
  const days = Math.min(60, Math.max(1, Number(c.req.query('days') ?? '14')));
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const includeSystem = c.req.query('includeSystem') !== '0';
  // Build a per-day window via the user's local midnight. We compute
  // it server-side using the request's date math; the rollup
  // returned is a flat array of {date: 'YYYY-MM-DD', count: N}
  // ordered oldest → newest. SQLite's date functions handle the
  // grouping; we just bound the range and pull.
  const now = Date.now();
  const dayMs = 24 * 60 * 60_000;
  const start = now - days * dayMs;
  const wheres: string[] = [
    includeSystem ? "(agent_id = ? OR agent_id = '__system__')" : 'agent_id = ?',
    'created_at >= ?',
  ];
  const params: Array<string | number> = [agentId, start];
  if (q) {
    wheres.push("lower(payload) LIKE ?");
    params.push(`%${q}%`);
  }
  try {
    // GROUP BY (day, kind) so we get one row per day-kind combo +
    // its count. The client (and the rollup below) then sums for
    // the per-day total and picks the kind with the largest count
    // as the day's "top kind" for tooltip annotations.
    const sql = `SELECT strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch')) as day,
                        kind,
                        COUNT(*) as n
                 FROM audit_log
                 WHERE ${wheres.join(' AND ')}
                 GROUP BY day, kind
                 ORDER BY day ASC, n DESC`;
    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<{ day: string; kind: string; n: number }>();
    // Roll up: per day, total count + the kind that contributed the
    // most rows (the SQL ORDER BY n DESC means the first row we see
    // for each day is the top kind).
    const perDay = new Map<
      string,
      { total: number; topKind: string; topKindCount: number }
    >();
    for (const r of rows.results ?? []) {
      const existing = perDay.get(r.day);
      if (!existing) {
        perDay.set(r.day, { total: r.n, topKind: r.kind, topKindCount: r.n });
      } else {
        existing.total += r.n;
        // The DESC ordering means the first row for each day already
        // wins; subsequent rows just contribute to the total.
      }
    }
    // Backfill empty days so the bar count always equals the `days`
    // window — saves the client from rendering a sparse array.
    const out: Array<{
      date: string;
      count: number;
      topKind?: string;
      topKindCount?: number;
    }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * dayMs);
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const summary = perDay.get(day);
      out.push(
        summary
          ? {
              date: day,
              count: summary.total,
              topKind: summary.topKind,
              topKindCount: summary.topKindCount,
            }
          : { date: day, count: 0 },
      );
    }
    return c.json({ buckets: out, days, source: 'd1' });
  } catch (err) {
    console.warn('[audit] histogram read failed, returning stub', err);
    // Stub: empty buckets so the UI hides the chart cleanly rather
    // than crashing.
    const out: Array<{ date: string; count: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * dayMs);
      out.push({
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        count: 0,
      });
    }
    return c.json({ buckets: out, days, source: 'stub' });
  }
});

audit.get('/:agentId/export', async (c) => {
  const agentId = c.req.param('agentId');
  const days = Math.min(365, Math.max(1, Number(c.req.query('days') ?? '30')));
  const sinceTs = Date.now() - days * 24 * 3_600_000;
  const kindFilter = c.req.query('kind');
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const includeSystem = c.req.query('includeSystem') !== '0';
  const wheres: string[] = [
    includeSystem ? "(agent_id = ? OR agent_id = '__system__')" : 'agent_id = ?',
    'created_at >= ?',
  ];
  const baseParams: Array<string | number> = [agentId, sinceTs];
  if (kindFilter) {
    const kinds = kindFilter
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length < 40);
    if (kinds.length === 1) {
      wheres.push('kind = ?');
      baseParams.push(kinds[0]!);
    } else if (kinds.length > 1) {
      const placeholders = kinds.map(() => '?').join(',');
      wheres.push(`kind IN (${placeholders})`);
      baseParams.push(...kinds);
    }
  }
  if (q) {
    wheres.push("lower(payload) LIKE ?");
    baseParams.push(`%${q}%`);
  }

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const filename = `audit-${agentId}-${stamp}.jsonl`;

  // Build a streamed response. Each batch fetches up to 500 rows older
  // than the previous batch's oldest row; we keep going until a batch
  // returns < 500 (signal: no more rows past this point). 50k cap
  // total so a runaway loop can't pin the worker.
  const ROW_HARD_CAP = 50_000;
  const BATCH = 500;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let beforeTs: number | null = null;
      let total = 0;
      try {
        for (;;) {
          const w = [...wheres];
          const p: Array<string | number> = [...baseParams];
          if (beforeTs !== null) {
            w.push('created_at < ?');
            p.push(beforeTs);
          }
          const sql = `SELECT id, agent_id, kind, payload, created_at FROM audit_log
                       WHERE ${w.join(' AND ')}
                       ORDER BY created_at DESC LIMIT ?`;
          p.push(BATCH);
          const rows = await c.env.DB.prepare(sql)
            .bind(...p)
            .all<AuditRow>();
          const results = rows.results ?? [];
          if (results.length === 0) break;
          for (const r of results) {
            const line = JSON.stringify({
              id: r.id,
              kind: r.kind,
              timestampMs: r.created_at,
              timestampIso: new Date(r.created_at).toISOString(),
              agentId: r.agent_id,
              payload: safeParseJson(r.payload),
            });
            controller.enqueue(encoder.encode(line + '\n'));
            total += 1;
            if (total >= ROW_HARD_CAP) break;
          }
          if (results.length < BATCH || total >= ROW_HARD_CAP) break;
          beforeTs = results[results.length - 1]!.created_at;
        }
      } catch (err) {
        // Surface the error as a final JSONL-shaped line so a
        // downstream parser can see something went wrong without
        // breaking the rest of the stream. Stream still closes.
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              error: 'stream_failed',
              reason: errMsg(err),
              rowsEmitted: total,
            }) + '\n',
          ),
        );
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});

audit.post('/:agentId', async (c) => {
  const parsed = AppendBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const id = crypto.randomUUID();
  const payload = JSON.stringify(parsed.data.payload ?? {});
  try {
    await c.env.DB.prepare(
      `INSERT INTO audit_log (id, agent_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, c.req.param('agentId'), parsed.data.kind, payload, Date.now())
      .run();
    return c.json({ ok: true, id });
  } catch (err) {
    // If the table is missing on a brand-new deployment, ack the write so the
    // caller doesn't retry — durability lives in the DO until migrations run.
    if (err instanceof Error && /no such table/i.test(err.message)) {
      return c.json({ ok: true, id, skipped: 'no_table' });
    }
    return c.json({ ok: false, error: 'd1_failed', reason: errMsg(err) }, 500);
  }
});

interface AuditRow {
  id: string;
  agent_id: string;
  kind: string;
  payload: string;
  created_at: number;
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stubEntries(agentId: string): Array<{ id: string; kind: string; payload: unknown; createdAt: number }> {
  const now = Date.now();
  return [
    {
      id: 'a-1',
      kind: 'approval',
      payload: { mode: 'smart_auto', changedBy: 'user' },
      createdAt: now - 4 * 60_000,
    },
    {
      id: 'a-2',
      kind: 'tool_call',
      payload: { tool: 'researcher.research', durationMs: 1840, costCents: 2, agent: agentId },
      createdAt: now - 22 * 60_000,
    },
    {
      id: 'a-3',
      kind: 'sync',
      payload: { action: 'status_check', behind: 0 },
      createdAt: now - 56 * 60_000,
    },
    {
      id: 'a-4',
      kind: 'provision',
      payload: { step: 'configure-access', source: 'cf' },
      createdAt: now - 90 * 60_000,
    },
  ];
}
