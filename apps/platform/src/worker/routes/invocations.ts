import { Hono } from 'hono';

import type { Env, Variables } from '../env';

export const invocations = new Hono<{ Bindings: Env; Variables: Variables }>();

// PRD §7 — Invocations tab. Lists the agent's recent runs with cost,
// duration, status, and the originating thread title. Persistent storage
// lives in D1 (`trajectories` table written by the queue consumer). The
// stub below returns a deterministic dataset so the UI is shippable before
// the queue has accumulated real traffic.

interface InvocationRow {
  turnId: string;
  threadId: string;
  threadTitle: string;
  agentId: string;
  model: string;
  durationMs: number;
  costCents: number;
  toolCallCount: number;
  status: 'ok' | 'partial' | 'failed';
  createdAt: number;
  // Deduped tool names invoked during this turn — let the Invocations
  // UI filter the list by tool without an N+1 round-trip. Optional so
  // older rows (and the stub) can omit it.
  tools?: string[];
}

// Extract the unique tool names from a trajectory payload. Defensive
// against malformed payloads — returns an empty array on anything
// unexpected. Caps at 12 names so a runaway turn doesn't bloat the
// list view's response.
function extractTools(rawPayload: string | null | undefined): string[] {
  if (!rawPayload) return [];
  try {
    const parsed = JSON.parse(rawPayload) as {
      toolCalls?: Array<{ tool?: unknown; name?: unknown }>;
    };
    if (!Array.isArray(parsed.toolCalls)) return [];
    const seen = new Set<string>();
    for (const t of parsed.toolCalls) {
      const name =
        typeof t?.tool === 'string'
          ? t.tool
          : typeof t?.name === 'string'
            ? t.name
            : null;
      if (name) seen.add(name);
      if (seen.size >= 12) break;
    }
    return [...seen];
  } catch {
    return [];
  }
}

invocations.get('/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const limit = Number(c.req.query('limit') ?? '25');

  // Production path — pull from D1. After 0002_trajectory_cost_columns the
  // first-class columns are present; we prefer those. If the wide SELECT
  // fails (older schema), we fall back to parsing the payload JSON inline so
  // the route stays useful while migrations catch up.
  try {
    const rows = await c.env.DB.prepare(
      `SELECT turn_id, thread_id, model, payload, created_at,
              cost_cents, duration_ms, tool_call_count, status
       FROM trajectories
       WHERE agent_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
      .bind(agentId, limit)
      .all<{
        turn_id: string;
        thread_id: string;
        model: string;
        payload: string | null;
        created_at: number;
        cost_cents: number | null;
        duration_ms: number | null;
        tool_call_count: number | null;
        status: string | null;
      }>();
    if (rows.results.length > 0) {
      return c.json({
        invocations: rows.results.map((r): InvocationRow => {
          const tools = extractTools(r.payload);
          return {
            turnId: r.turn_id,
            threadId: r.thread_id,
            threadTitle: '(thread)',
            agentId,
            model: r.model,
            durationMs: r.duration_ms ?? 0,
            costCents: r.cost_cents ?? 0,
            toolCallCount: r.tool_call_count ?? 0,
            status: (r.status as InvocationRow['status']) ?? 'ok',
            createdAt: r.created_at,
            ...(tools.length > 0 ? { tools } : {}),
          };
        }),
        source: 'd1',
      });
    }
  } catch (err) {
    // Probably the column doesn't exist yet (migration pending). Try the
    // payload-parse path.
    if (err instanceof Error && /no such column|has no column/i.test(err.message)) {
      try {
        const rows = await c.env.DB.prepare(
          `SELECT turn_id, thread_id, model, payload, created_at
           FROM trajectories WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`,
        )
          .bind(agentId, limit)
          .all<{
            turn_id: string;
            thread_id: string;
            model: string;
            payload: string;
            created_at: number;
          }>();
        if (rows.results.length > 0) {
          return c.json({
            invocations: rows.results.map((r): InvocationRow => {
              let payload: {
                output?: { createdAt?: number };
                input?: { createdAt?: number };
                toolCalls?: unknown[];
              } = {};
              try {
                payload = JSON.parse(r.payload);
              } catch {
                /* ignore */
              }
              const tools = extractTools(r.payload);
              return {
                turnId: r.turn_id,
                threadId: r.thread_id,
                threadTitle: '(thread)',
                agentId,
                model: r.model,
                durationMs:
                  payload.output?.createdAt && payload.input?.createdAt
                    ? Math.max(0, payload.output.createdAt - payload.input.createdAt)
                    : 0,
                costCents: 0,
                toolCallCount: Array.isArray(payload.toolCalls) ? payload.toolCalls.length : 0,
                status: 'ok',
                createdAt: r.created_at,
                ...(tools.length > 0 ? { tools } : {}),
              };
            }),
            source: 'd1',
          });
        }
      } catch {
        /* fall through to stub */
      }
    }
  }

  // Stub dataset — deterministic shape for the UI to render against.
  const now = Date.now();
  const stub: InvocationRow[] = [
    {
      turnId: 't-aa11',
      threadId: 'welcome',
      threadTitle: 'Welcome',
      agentId,
      model: '@cf/meta/llama-3.1-8b-instruct',
      durationMs: 1_840,
      costCents: 2,
      toolCallCount: 0,
      status: 'ok',
      createdAt: now - 4 * 60_000,
    },
    {
      turnId: 't-bb22',
      threadId: 'inbox-triage',
      threadTitle: 'Morning inbox triage',
      agentId,
      model: '@cf/meta/llama-3.1-8b-instruct',
      durationMs: 12_340,
      costCents: 9,
      toolCallCount: 3,
      status: 'ok',
      createdAt: now - 17 * 60_000,
    },
    {
      turnId: 't-cc33',
      threadId: 'prd-review',
      threadTitle: 'PRD review',
      agentId,
      model: '@cf/meta/llama-3.1-8b-instruct',
      durationMs: 6_820,
      costCents: 6,
      toolCallCount: 1,
      status: 'partial',
      createdAt: now - 70 * 60_000,
    },
    {
      turnId: 't-dd44',
      threadId: 'vendors',
      threadTitle: 'Vendor comparison',
      agentId,
      model: '@cf/meta/llama-3.1-70b-instruct',
      durationMs: 24_900,
      costCents: 21,
      toolCallCount: 5,
      status: 'ok',
      createdAt: now - 22 * 60 * 60_000,
    },
  ];
  return c.json({ invocations: stub, source: 'stub' });
});

// Trajectory detail by turnId — used by the Invocations row click in
// Settings. Returns the full payload (input prompt, output reply, tool
// calls) plus rubric scores when the Judge has scored the row. Falls
// back to a deterministic stub when the table is empty so the inline
// detail panel still renders against sample rows.
invocations.get('/:agentId/turn/:turnId', async (c) => {
  const agentId = c.req.param('agentId');
  const turnId = c.req.param('turnId');
  try {
    const row = await c.env.DB.prepare(
      `SELECT turn_id, thread_id, model, payload, created_at,
              cost_cents, duration_ms, tool_call_count, status,
              schema_score, relevancy_score, faithfulness_score, overall_score
       FROM trajectories
       WHERE agent_id = ? AND turn_id = ?
       LIMIT 1`,
    )
      .bind(agentId, turnId)
      .first<{
        turn_id: string;
        thread_id: string;
        model: string;
        payload: string;
        created_at: number;
        cost_cents: number | null;
        duration_ms: number | null;
        tool_call_count: number | null;
        status: string | null;
        schema_score: number | null;
        relevancy_score: number | null;
        faithfulness_score: number | null;
        overall_score: number | null;
      }>();
    if (row) {
      let payload: unknown = null;
      try {
        payload = JSON.parse(row.payload);
      } catch {
        payload = row.payload;
      }
      return c.json({
        turnId: row.turn_id,
        threadId: row.thread_id,
        agentId,
        model: row.model,
        createdAt: row.created_at,
        costCents: row.cost_cents ?? 0,
        durationMs: row.duration_ms ?? 0,
        toolCallCount: row.tool_call_count ?? 0,
        status: row.status ?? 'ok',
        scores: {
          schema: row.schema_score,
          relevancy: row.relevancy_score,
          faithfulness: row.faithfulness_score,
          overall: row.overall_score,
        },
        payload,
        source: 'd1',
      });
    }
  } catch (err) {
    // Older schema (pre-0002 or pre-judge-columns) — fall through to the
    // payload-only path. The route stays useful while migrations catch up.
    if (err instanceof Error && /no such column|has no column/i.test(err.message)) {
      try {
        const row = await c.env.DB.prepare(
          `SELECT turn_id, thread_id, model, payload, created_at
           FROM trajectories WHERE agent_id = ? AND turn_id = ? LIMIT 1`,
        )
          .bind(agentId, turnId)
          .first<{
            turn_id: string;
            thread_id: string;
            model: string;
            payload: string;
            created_at: number;
          }>();
        if (row) {
          let payload: unknown = null;
          try {
            payload = JSON.parse(row.payload);
          } catch {
            payload = row.payload;
          }
          return c.json({
            turnId: row.turn_id,
            threadId: row.thread_id,
            agentId,
            model: row.model,
            createdAt: row.created_at,
            costCents: 0,
            durationMs: 0,
            toolCallCount: 0,
            status: 'ok',
            scores: { schema: null, relevancy: null, faithfulness: null, overall: null },
            payload,
            source: 'd1',
          });
        }
      } catch {
        /* fall through to stub */
      }
    }
  }

  // Stub — keeps the inline detail panel useful when the table is empty.
  return c.json({
    turnId,
    threadId: 'welcome',
    agentId,
    model: '@cf/meta/llama-3.1-8b-instruct',
    createdAt: Date.now() - 5 * 60_000,
    costCents: 2,
    durationMs: 1_840,
    toolCallCount: 0,
    status: 'ok',
    scores: { schema: null, relevancy: null, faithfulness: null, overall: null },
    payload: {
      input: { content: 'Sample prompt — your D1 trajectories table is empty.' },
      output: { content: 'Sample response. Real turns will land here once you chat.' },
      toolCalls: [],
    },
    source: 'stub',
  });
});

invocations.get('/:agentId/summary', async (c) => {
  // Fast roll-up used by the badge on the Settings tab + Spending tab. Reads
  // the cost_cents column directly when 0002 has been applied; falls back to
  // a count-only result when the column is missing.
  const agentId = c.req.param('agentId');
  const since = Date.now() - 24 * 60 * 60_000;
  try {
    const row = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(cost_cents), 0) AS cost
       FROM trajectories WHERE agent_id = ? AND created_at >= ?`,
    )
      .bind(agentId, since)
      .first<{ n: number; cost: number }>();
    if (row) {
      return c.json({ count24h: row.n, costCents24h: row.cost, source: 'd1' });
    }
  } catch (err) {
    if (err instanceof Error && /no such column|has no column/i.test(err.message)) {
      try {
        const row = await c.env.DB.prepare(
          `SELECT COUNT(*) AS n FROM trajectories WHERE agent_id = ? AND created_at >= ?`,
        )
          .bind(agentId, since)
          .first<{ n: number }>();
        if (row) return c.json({ count24h: row.n, costCents24h: 0, source: 'd1' });
      } catch {
        /* fall through */
      }
    }
  }
  return c.json({ count24h: 4, costCents24h: 38, source: 'stub' });
});
