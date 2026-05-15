import { BaseRpcAgent } from './base-rpc-agent';

// BrowserSession — wraps a live Browser Rendering instance. Stub for iteration 1.
// Iteration 5 streams screenshots over WS at 4–6 fps with take-over handoff.
export class BrowserSession extends BaseRpcAgent {
  protected async invoke(method: string, args: unknown): Promise<unknown> {
    switch (method) {
      case 'ping':
        return { from: 'browser-session', ts: Date.now() };
      case 'spawn': {
        const { url } = (args ?? {}) as { url?: string };
        return { sessionId: crypto.randomUUID(), stub: true, url };
      }
      case 'snapshot':
        return { stub: true, r2Key: null };
      default:
        throw new Error(`unknown_method:${method}`);
    }
  }
}
