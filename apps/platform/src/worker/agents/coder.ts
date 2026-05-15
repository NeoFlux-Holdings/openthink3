import { BaseRpcAgent } from './base-rpc-agent';

// Coder — runs code via the Cloudflare Sandbox. Stub for iteration 1.
// In iteration 6 this dispatches to @cloudflare/sandbox containers.
export class Coder extends BaseRpcAgent {
  protected async invoke(method: string, args: unknown): Promise<unknown> {
    switch (method) {
      case 'ping':
        return { from: 'coder', ts: Date.now() };
      case 'exec': {
        const { language, source } = (args ?? {}) as { language?: string; source?: string };
        return {
          language,
          source,
          stub: true,
          stdout: '(stub) sandbox not wired yet',
          stderr: '',
          exitCode: 0,
        };
      }
      default:
        throw new Error(`unknown_method:${method}`);
    }
  }
}
