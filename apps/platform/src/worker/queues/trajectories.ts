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

  const stmt = env.DB.prepare(
    `INSERT INTO trajectories (turn_id, agent_id, thread_id, payload, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const msg of batch.messages) {
    const t = msg.body as Trajectory;
    try {
      await stmt
        .bind(t.turnId, t.agentId, t.threadId, JSON.stringify(t), t.model, t.createdAt)
        .run();
      msg.ack();
    } catch (err) {
      // If the table is missing (production agent hasn't run migrations yet),
      // ack rather than retry — the per-thread state in the DO is canonical.
      if (err instanceof Error && /no such table/i.test(err.message)) {
        console.warn('[trajectories] no trajectories table; ack without persist');
        msg.ack();
        continue;
      }
      console.error('[trajectories] write failed', err);
      msg.retry({ delaySeconds: 30 });
    }
  }
}
