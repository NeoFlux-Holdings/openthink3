import { BaseRpcAgent } from './base-rpc-agent';

// MemoryAgent — owns the user's memories. Reads/writes Vectorize + the D1 mirror.
// Stub for iteration 1; hybrid retrieval (RRF) lands in iteration 6.
export class MemoryAgent extends BaseRpcAgent {
  async invoke(method: string, args: unknown): Promise<unknown> {
    switch (method) {
      case 'ping':
        return { from: 'memory', ts: Date.now() };
      case 'recall': {
        const { query, limit } = (args ?? {}) as { query?: string; limit?: number };
        return {
          query,
          limit: limit ?? 5,
          stub: true,
          memories: [],
        };
      }
      case 'remember': {
        const { content } = (args ?? {}) as { content?: string };
        return { id: crypto.randomUUID(), stub: true, content };
      }
      default:
        throw new Error(`unknown_method:${method}`);
    }
  }
}
