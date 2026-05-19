// Judge — LLM-as-judge rubric scorer for the self-evolution loop.
//
// Three dimensions, each scored 0..1 by Workers AI, plus an `overall` that is
// a weighted average (faithfulness 0.45, relevancy 0.35, schema 0.20 — bias
// toward "the answer is true to its sources" since that's what users notice
// the most).
//
//   - schema:        does the response follow the system's instructions
//                    (length, format, tool use)? cheap deterministic checks
//                    layered with an LLM gut-check.
//   - relevancy:     does the response address what the user actually asked?
//                    LLM rating with a tight 0-10 scale.
//   - faithfulness:  if tool results are present, does the answer trace back
//                    to them? if not, does it admit uncertainty?
//
// Writes scores back to D1 `trajectories` so the Learning page badge counts
// and the retraining workflow can rank which turns to surface as
// pending_suggestions.

import { BaseRpcAgent } from './base-rpc-agent';
import type { Trajectory } from '../../shared/types';

interface ScoreResult {
  overall: number;
  schema: number;
  relevancy: number;
  faithfulness: number;
  notes: string[];
}

export class Judge extends BaseRpcAgent {
  async invoke(method: string, args: unknown): Promise<unknown> {
    switch (method) {
      case 'ping':
        return { from: 'judge', ts: Date.now() };
      case 'score':
        return this.score(args as { turnId?: string; trajectory?: Trajectory });
      case 'score_batch':
        return this.scoreBatch(args as { agentId?: string; sinceMs?: number; limit?: number });
      default:
        throw new Error(`unknown_method:${method}`);
    }
  }

  private async score(args: {
    turnId?: string;
    trajectoryId?: string;
    trajectory?: Trajectory;
  }): Promise<unknown> {
    // Accept both `turnId` and the legacy `trajectoryId` name the workflow
    // passes — they're the same identifier.
    const turnId = args.turnId ?? args.trajectoryId;
    let t = args.trajectory;
    if (!t && turnId) {
      try {
        const row = await this.env.DB.prepare(
          `SELECT payload FROM trajectories WHERE turn_id = ?`,
        )
          .bind(turnId)
          .first<{ payload: string }>();
        if (row?.payload) t = JSON.parse(row.payload) as Trajectory;
      } catch (err) {
        return { ok: false, error: 'd1_read_failed', reason: errMsg(err) };
      }
    }
    if (!t) return { ok: false, error: 'no_trajectory' };

    const result = await this.runRubric(t);

    // Persist back into D1 so the Learning page badge + retraining workflow
    // can pull "low-scoring turns" without re-scoring.
    try {
      await this.env.DB.prepare(
        `UPDATE trajectories SET
           score_overall = ?, score_schema = ?, score_relevancy = ?, score_faithfulness = ?
         WHERE turn_id = ?`,
      )
        .bind(result.overall, result.schema, result.relevancy, result.faithfulness, t.turnId)
        .run();
    } catch (err) {
      console.warn('[judge] score write failed', err);
    }

    return { ok: true, turnId: t.turnId, scores: result };
  }

  private async scoreBatch({
    agentId,
    sinceMs = 24 * 60 * 60_000,
    limit = 25,
  }: { agentId?: string; sinceMs?: number; limit?: number }): Promise<unknown> {
    if (!agentId) return { ok: false, error: 'missing_agentId' };
    const since = Date.now() - sinceMs;
    let rows: Array<{ turn_id: string; payload: string }> = [];
    try {
      const result = await this.env.DB.prepare(
        `SELECT turn_id, payload FROM trajectories
         WHERE agent_id = ? AND created_at >= ? AND score_overall IS NULL
         ORDER BY created_at DESC LIMIT ?`,
      )
        .bind(agentId, since, limit)
        .all<{ turn_id: string; payload: string }>();
      rows = result.results ?? [];
    } catch (err) {
      return { ok: false, error: 'd1_read_failed', reason: errMsg(err) };
    }
    let scored = 0;
    const lowScoreTurns: string[] = [];
    for (const row of rows) {
      try {
        const traj = JSON.parse(row.payload) as Trajectory;
        const result = await this.runRubric(traj);
        await this.env.DB.prepare(
          `UPDATE trajectories SET
             score_overall = ?, score_schema = ?, score_relevancy = ?, score_faithfulness = ?
           WHERE turn_id = ?`,
        )
          .bind(result.overall, result.schema, result.relevancy, result.faithfulness, traj.turnId)
          .run();
        scored++;
        if (result.overall < 0.55) lowScoreTurns.push(traj.turnId);
      } catch (err) {
        console.warn('[judge] batch score failed for', row.turn_id, err);
      }
    }
    return { ok: true, scored, lowScoreTurns, total: rows.length };
  }

  private async runRubric(t: Trajectory): Promise<ScoreResult> {
    const userText = t.input.content ?? '';
    const assistantText = t.output.content ?? '';
    const toolSummary =
      t.toolCalls?.map((c) => `- ${c.name}: ${truncate(JSON.stringify(c.result ?? {}), 240)}`).join('\n') ?? '';

    // Schema gut-check is mostly deterministic — token-cost-free signals
    // (length, presence of follow-up suggestions, no leading apology) before
    // we burn an LLM call.
    const schema = this.scoreSchemaDeterministic(assistantText);

    const notes: string[] = [];
    let relevancy = 0.5;
    let faithfulness = 0.5;

    try {
      const result = (await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          {
            role: 'system',
            content:
              'You are a strict evaluator. Score the assistant reply against the user request. ' +
              'Reply with VALID JSON only — no preamble, no code fence. Schema:\n' +
              '{"relevancy": <0..1>, "faithfulness": <0..1>, "notes": [<short string>, ...]}\n' +
              'relevancy = answers what was asked. faithfulness = grounded in tool results when present; ' +
              'if no tools, faithfulness = admits uncertainty appropriately.',
          },
          {
            role: 'user',
            content:
              `USER: ${truncate(userText, 1_500)}\n\n` +
              (toolSummary ? `TOOL RESULTS:\n${truncate(toolSummary, 1_500)}\n\n` : '') +
              `ASSISTANT: ${truncate(assistantText, 2_000)}`,
          },
        ],
      })) as { response?: string };
      const parsed = safeParseJson(result.response ?? '');
      if (parsed && typeof parsed === 'object') {
        relevancy = clamp01(Number((parsed as { relevancy?: unknown }).relevancy));
        faithfulness = clamp01(Number((parsed as { faithfulness?: unknown }).faithfulness));
        const rawNotes = (parsed as { notes?: unknown }).notes;
        if (Array.isArray(rawNotes)) {
          for (const note of rawNotes) {
            if (typeof note === 'string') notes.push(note);
          }
        }
      }
    } catch (err) {
      notes.push(`llm_score_failed: ${errMsg(err)}`);
    }

    const overall = +(0.45 * faithfulness + 0.35 * relevancy + 0.2 * schema).toFixed(3);
    return { overall, schema, relevancy, faithfulness, notes };
  }

  // Token-cheap heuristics for schema adherence. Multiplied by the LLM
  // score later if we want to combine — for now we keep this standalone
  // so a bad reply (e.g. "Sure! Here's …") scores down without burning a
  // model call.
  private scoreSchemaDeterministic(reply: string): number {
    const s = reply.trim();
    if (!s) return 0.0;
    let score = 1.0;
    // Bad-pattern penalties.
    if (/^(sure|of course|certainly|absolutely)[,!.]/i.test(s)) score -= 0.2;
    if (/^i'?m sorry/i.test(s)) score -= 0.15;
    if (s.length < 20) score -= 0.3;
    if (s.length > 4_000) score -= 0.15;
    // Markdown structure bonus (only for longer responses).
    if (s.length > 400 && /\n(#{1,3} |- |\* |\d+\.\s)/.test(s)) score += 0.05;
    return Math.max(0, Math.min(1, +score.toFixed(3)));
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…';
}

function safeParseJson(s: string): unknown {
  try {
    // Some models return ```json ... ``` even when told not to. Strip the
    // fence before parsing.
    const stripped = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
