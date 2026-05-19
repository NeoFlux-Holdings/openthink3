// Trajectory queue consumer — writes turns to D1, optionally embeds + indexes via Vectorize.
// For iteration 1 we just persist to D1; embedding/judging lands in iteration 7.

import type { Env } from '../env';
import type { Trajectory } from '../../shared/types';

let migrationsChecked = false;

export async function handleTrajectoryQueue(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
  // On the first batch the worker sees, sanity-check that the schema is in
  // place. If not (e.g. the operator hasn't run `wrangler d1 migrations apply`
  // yet), drop the batch with an ack so we don't spin into a retry loop. The
  // turn is still in the orchestrator's DO SQLite — durability isn't lost.
  if (!migrationsChecked) {
    migrationsChecked = true;
    try {
      await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='trajectories'",
      ).first();
    } catch (err) {
      console.warn('[trajectories] schema check failed, acking batch', err);
      for (const msg of batch.messages) msg.ack();
      return;
    }
  }

  // The wide insert lights up the 0002 cost columns. If migrations haven't
  // run yet the wider INSERT will fail with "table … has no column named …" —
  // we fall back to the narrow insert so older deployments still capture
  // payload + model + thread without losing data.
  const wide = env.DB.prepare(
    `INSERT INTO trajectories
       (turn_id, agent_id, thread_id, payload, model, created_at,
        cost_cents, duration_ms, tool_call_count, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const narrow = env.DB.prepare(
    `INSERT INTO trajectories (turn_id, agent_id, thread_id, payload, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const msg of batch.messages) {
    const t = msg.body as Trajectory;
    const costCents = sumToolCost(t.toolCalls);
    const durationMs = Math.max(0, t.output.createdAt - t.input.createdAt);
    const toolCallCount = Array.isArray(t.toolCalls) ? t.toolCalls.length : 0;
    const status = inferStatus(t.toolCalls);
    try {
      await wide
        .bind(
          t.turnId,
          t.agentId,
          t.threadId,
          JSON.stringify(t),
          t.model,
          t.createdAt,
          costCents,
          durationMs,
          toolCallCount,
          status,
        )
        .run();
      msg.ack();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Missing cost columns? Re-try with the narrow insert so we still
      // persist the payload + count + duration via the JSON blob.
      if (/has no column/i.test(errMsg)) {
        try {
          await narrow
            .bind(t.turnId, t.agentId, t.threadId, JSON.stringify(t), t.model, t.createdAt)
            .run();
          msg.ack();
          continue;
        } catch (innerErr) {
          if (innerErr instanceof Error && /no such table/i.test(innerErr.message)) {
            console.warn('[trajectories] no trajectories table; ack without persist');
            msg.ack();
            continue;
          }
          console.error('[trajectories] narrow write failed', innerErr);
          msg.retry({ delaySeconds: 30 });
          continue;
        }
      }
      if (/no such table/i.test(errMsg)) {
        console.warn('[trajectories] no trajectories table; ack without persist');
        msg.ack();
        continue;
      }
      console.error('[trajectories] write failed', err);
      msg.retry({ delaySeconds: 30 });
    }
  }
}

function sumToolCost(calls: Trajectory['toolCalls']): number {
  if (!Array.isArray(calls)) return 0;
  let total = 0;
  for (const c of calls) {
    if (typeof c.estCostCents === 'number') total += c.estCostCents;
  }
  return total;
}

function inferStatus(calls: Trajectory['toolCalls']): 'ok' | 'partial' | 'failed' {
  if (!Array.isArray(calls) || calls.length === 0) return 'ok';
  const errored = calls.filter((c) => c.status === 'error').length;
  if (errored === 0) return 'ok';
  if (errored === calls.length) return 'failed';
  return 'partial';
}
