// Nightly self-evolution Workflow — adapted from the OpenAI autonomous-agent
// retraining pattern, mapped onto Cloudflare primitives.
//
// 1. Trajectory capture lives in queues/trajectories.ts (writes turn-level rows
//    to D1 + heavy blobs to R2).
// 2. This Workflow runs once a day (or on demand) to: pull the last 24h of
//    trajectories, score them via the Judge sibling DO, decide whether to
//    propose a prompt/skill revision, and gate the merge on the user's
//    approval mode.

import type { Env } from '../env';

interface RetrainingParams {
  agentId: string;
  windowHours?: number;
  scoreThreshold?: number;
}

interface WorkflowEvent<T> {
  payload: T;
}

interface Step {
  do<T>(name: string, opts: { retries?: { limit: number; backoff: 'constant' | 'linear' | 'exponential' } }, fn: () => Promise<T>): Promise<T>;
  waitForEvent<T>(name: string, opts: { timeout: string }): Promise<{ payload: T }>;
  sleep(name: string, duration: string): Promise<void>;
}

export class RetrainingWorkflow {
  private env: Env;

  constructor(_ctx: ExecutionContext, env: Env) {
    this.env = env;
  }

  async run(event: WorkflowEvent<RetrainingParams>, step: Step): Promise<RetrainingOutcome> {
    const { agentId, windowHours = 24, scoreThreshold = 0.6 } = event.payload;

    // 1. Pull recent trajectories from D1.
    const trajectories = await step.do(
      'pull-trajectories',
      { retries: { limit: 3, backoff: 'exponential' } },
      async () => this.pullTrajectories(agentId, windowHours),
    );

    if (trajectories.length === 0) {
      return { agentId, status: 'no_signal' };
    }

    // 2. Score via the Judge sibling DO. Scores follow PRD §7's three rubrics:
    //    schemaAdherenceScorer, relevancyScorer, faithfulnessScorer.
    const scored = await step.do(
      'score',
      { retries: { limit: 2, backoff: 'linear' } },
      async () => this.scoreBatch(agentId, trajectories),
    );

    const winRate = scored.filter((s) => s.overall >= scoreThreshold).length / scored.length;
    if (winRate >= 0.6) {
      // Healthy distribution — drift watch will pick it up. No action needed.
      return { agentId, status: 'no_drift', winRate };
    }

    // 3. Generate a candidate prompt/skill revision against the failures.
    const candidate = await step.do(
      'candidate',
      { retries: { limit: 2, backoff: 'linear' } },
      async () => this.generateCandidate(agentId, scored),
    );

    if (!candidate) {
      return { agentId, status: 'no_candidate', winRate };
    }

    // 4. A/B backtest: replay K held-out trajectories against the candidate.
    const backtest = await step.do(
      'backtest',
      { retries: { limit: 2, backoff: 'linear' } },
      async () => this.backtest(agentId, candidate, scored.slice(0, 10)),
    );

    if (backtest.winRate < 0.6) {
      return {
        agentId,
        status: 'rejected_low_winrate',
        winRate,
        backtestWinRate: backtest.winRate,
        candidateId: candidate.id,
      };
    }

    // 5. Commit gate. In Full Auto, merge immediately. Otherwise wait for the
    //    user's approval via the Pending Suggestions surface.
    const approvalMode = await this.readApprovalMode(agentId);
    if (approvalMode === 'full_auto') {
      await step.do('commit', { retries: { limit: 1, backoff: 'constant' } }, async () => {
        await this.commitCandidate(agentId, candidate);
      });
      return {
        agentId,
        status: 'merged_auto',
        winRate,
        backtestWinRate: backtest.winRate,
        candidateId: candidate.id,
      };
    }

    // Wait up to 24h for the user to accept/reject the candidate in the UI.
    const decision = await step.waitForEvent<{ approved: boolean }>(`accept-${candidate.id}`, {
      timeout: '24 hours',
    });

    if (decision.payload.approved) {
      await step.do('commit', { retries: { limit: 1, backoff: 'constant' } }, async () => {
        await this.commitCandidate(agentId, candidate);
      });
      return {
        agentId,
        status: 'merged_user',
        winRate,
        backtestWinRate: backtest.winRate,
        candidateId: candidate.id,
      };
    }
    return {
      agentId,
      status: 'declined',
      winRate,
      backtestWinRate: backtest.winRate,
      candidateId: candidate.id,
    };
  }

  // ----- Step implementations -----
  private async pullTrajectories(agentId: string, windowHours: number): Promise<TrajectoryRow[]> {
    const since = Date.now() - windowHours * 60 * 60 * 1_000;
    const res = await this.env.DB.prepare(
      `SELECT turn_id, agent_id, thread_id, payload, model, score_overall, created_at
       FROM trajectories WHERE agent_id = ? AND created_at >= ? ORDER BY created_at ASC`,
    )
      .bind(agentId, since)
      .all<TrajectoryRow>();
    return res.results;
  }

  private async scoreBatch(
    agentId: string,
    rows: TrajectoryRow[],
  ): Promise<Array<{ turnId: string; overall: number; schema: number; relevancy: number; faithfulness: number }>> {
    const id = this.env.JUDGE.idFromName(agentId);
    const stub = this.env.JUDGE.get(id) as unknown as {
      invoke(method: string, args: unknown): Promise<{ scores: { overall: number; schema: number; relevancy: number; faithfulness: number } }>;
    };

    const out: Array<{ turnId: string; overall: number; schema: number; relevancy: number; faithfulness: number }> = [];
    for (const row of rows) {
      const res = await stub.invoke('score', { trajectoryId: row.turn_id });
      out.push({ turnId: row.turn_id, ...res.scores });
      // Persist the scores back into D1 so the next pass can short-circuit.
      await this.env.DB.prepare(
        `UPDATE trajectories
         SET score_overall = ?, score_schema = ?, score_relevancy = ?, score_faithfulness = ?
         WHERE turn_id = ?`,
      )
        .bind(
          res.scores.overall,
          res.scores.schema,
          res.scores.relevancy,
          res.scores.faithfulness,
          row.turn_id,
        )
        .run();
    }
    return out;
  }

  private async generateCandidate(
    agentId: string,
    _scored: Array<{ turnId: string; overall: number }>,
  ): Promise<{ id: string; promptDelta: string; rationale: string } | null> {
    // Meta-prompt the orchestrator to propose a revision against the lowest-
    // scoring turns. Iteration 10 wires the actual model call; for now we
    // record a placeholder so the surrounding flow can be unit-tested.
    const id = crypto.randomUUID();
    return {
      id,
      promptDelta: '',
      rationale: `Auto-generated candidate for ${agentId} from ${_scored.length} scored turns.`,
    };
  }

  private async backtest(
    _agentId: string,
    _candidate: { id: string; promptDelta: string },
    sample: Array<{ turnId: string; overall: number }>,
  ): Promise<{ winRate: number }> {
    // Replay the sample against the candidate prompt. Iteration 10 wires this
    // to Workers AI; for now we treat it as a no-op win-rate of 0.7 so the
    // commit gate exercises both branches.
    return { winRate: sample.length > 0 ? 0.7 : 0 };
  }

  private async readApprovalMode(agentId: string): Promise<'full_auto' | 'smart_auto' | 'manual'> {
    const raw = await this.env.SETTINGS.get(`settings:${agentId}`);
    if (!raw) return 'smart_auto';
    try {
      const parsed = JSON.parse(raw) as { mode?: 'full_auto' | 'smart_auto' | 'manual' };
      return parsed.mode ?? 'smart_auto';
    } catch {
      return 'smart_auto';
    }
  }

  private async commitCandidate(agentId: string, candidate: { id: string; promptDelta: string; rationale: string }): Promise<void> {
    await this.env.DB.prepare(
      `INSERT INTO audit_log (id, agent_id, kind, payload, created_at)
       VALUES (?, ?, 'self_evolve', ?, ?)`,
    )
      .bind(crypto.randomUUID(), agentId, JSON.stringify(candidate), Date.now())
      .run();
  }
}

interface TrajectoryRow {
  turn_id: string;
  agent_id: string;
  thread_id: string;
  payload: string;
  model: string;
  score_overall: number | null;
  created_at: number;
}

export type RetrainingOutcome =
  | { agentId: string; status: 'no_signal' }
  | { agentId: string; status: 'no_drift'; winRate: number }
  | { agentId: string; status: 'no_candidate'; winRate: number }
  | { agentId: string; status: 'rejected_low_winrate'; winRate: number; backtestWinRate: number; candidateId: string }
  | { agentId: string; status: 'merged_auto' | 'merged_user' | 'declined'; winRate: number; backtestWinRate: number; candidateId: string };
