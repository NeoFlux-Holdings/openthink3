// Tiny RPC-style base for specialist DOs. Real version (with hibernation, alarms,
// and structured method dispatch) lands when we wire the Agents SDK in iteration 6.

import type { Env } from '../env';

export interface AgentMethodCall {
  method: string;
  args?: unknown;
}

export interface AgentMethodResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export abstract class BaseRpcAgent implements DurableObject {
  protected state: DurableObjectState;
  protected env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('method_not_allowed', { status: 405 });
    const body = (await request.json()) as AgentMethodCall;
    try {
      const data = await this.invoke(body.method, body.args);
      return Response.json({ ok: true, data } satisfies AgentMethodResult);
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) } satisfies AgentMethodResult,
        { status: 500 },
      );
    }
  }

  protected abstract invoke(method: string, args: unknown): Promise<unknown>;
}
