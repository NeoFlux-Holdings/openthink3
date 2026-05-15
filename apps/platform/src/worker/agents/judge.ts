import { BaseRpcAgent } from './base-rpc-agent';

// Judge — LLM-as-judge for self-evolution scoring. Stub for iteration 1.
// Iteration 7 wires schemaAdherence, relevancy, faithfulness scorers.
export class Judge extends BaseRpcAgent {
  protected async invoke(method: string, args: unknown): Promise<unknown> {
    switch (method) {
      case 'ping':
        return { from: 'judge', ts: Date.now() };
      case 'score': {
        const { trajectoryId } = (args ?? {}) as { trajectoryId?: string };
        return {
          trajectoryId,
          stub: true,
          scores: { overall: 0, schema: 0, relevancy: 0, faithfulness: 0 },
        };
      }
      default:
        throw new Error(`unknown_method:${method}`);
    }
  }
}
