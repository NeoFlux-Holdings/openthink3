// Trajectory queue consumer — writes turns to D1, optionally embeds + indexes via Vectorize.
// For iteration 1 we just persist to D1; embedding/judging lands in iteration 7.

import type { Env } from '../env';
import type { Trajectory } from '../../shared/types';

export async function handleTrajectoryQueue(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
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
      console.error('[trajectories] write failed', err);
      msg.retry({ delaySeconds: 30 });
    }
  }
}
