import { BaseRpcAgent } from './base-rpc-agent';

// Researcher — long-running web research with a browser session. Stub for iteration 1.
// In iteration 5 this binds to BROWSER_SESSION and writes Trajectories.
export class Researcher extends BaseRpcAgent {
  protected async invoke(method: string, args: unknown): Promise<unknown> {
    switch (method) {
      case 'ping':
        return { from: 'researcher', ts: Date.now() };
      case 'research': {
        const { query } = (args ?? {}) as { query?: string };
        return {
          query,
          stub: true,
          summary: `(stub) Would research: ${query ?? '<empty>'}`,
        };
      }
      default:
        throw new Error(`unknown_method:${method}`);
    }
  }
}
