// /goal workflow — multi-step plans with human-in-the-loop approval gates.
// Real implementation lands in iteration 7 alongside Smithers JSX. Stubbed here so
// the wrangler.toml binding has a real export to point at.

import type { Env } from '../env';

interface GoalEvent {
  payload: {
    goal: string;
    agentId: string;
    plan?: Array<{ id: string; description: string; requiresApproval?: boolean }>;
  };
}

interface Step {
  do<T>(name: string, options: { retries?: { limit: number; backoff: 'constant' | 'linear' | 'exponential' } }, fn: () => Promise<T>): Promise<T>;
  waitForEvent<T>(name: string, options: { timeout: string }): Promise<{ payload: T }>;
  sleep(name: string, duration: string): Promise<void>;
}

export class GoalWorkflow {
  constructor(_ctx: ExecutionContext, _env: Env) {}

  async run(event: GoalEvent, step: Step): Promise<{ aborted?: string; completed?: true }> {
    const plan = event.payload.plan ?? [
      { id: 'decompose', description: 'Decompose the goal into steps' },
      { id: 'execute', description: 'Execute the plan' },
    ];

    for (const s of plan) {
      await step.do(`exec:${s.id}`, { retries: { limit: 2, backoff: 'exponential' } }, async () => {
        // Stub. Real version dispatches to specialists via DO RPC.
        return { stepId: s.id, ok: true };
      });

      if (s.requiresApproval) {
        const result = await step.waitForEvent<{ approved: boolean }>(`approve-${s.id}`, {
          timeout: '24 hours',
        });
        if (!result.payload.approved) return { aborted: s.id };
      }
    }

    return { completed: true };
  }
}
