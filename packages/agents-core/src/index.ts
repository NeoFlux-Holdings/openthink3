// @openthink/agents-core — base classes, RPC plumbing, model adapter contracts.
// Iteration 1 surfaces the public types and a thin RPC helper; the full Agent base
// class with hibernation hooks lands in iteration 6 when we adopt the Agents SDK.

export interface AgentDescriptor {
  name: string;
  kind: 'orchestrator' | 'researcher' | 'coder' | 'memory' | 'judge' | 'browser-session';
  version: string;
}

export type RpcResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export async function callAgentDo<T = unknown>(
  ns: { idFromName(name: string): { toString(): string }; get(id: { toString(): string }): { fetch(req: Request): Promise<Response> } },
  agentName: string,
  method: string,
  args?: unknown,
): Promise<RpcResult<T>> {
  const id = ns.idFromName(agentName);
  const stub = ns.get(id);
  const res = await stub.fetch(
    new Request('https://agent.local/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args }),
    }),
  );
  return (await res.json()) as RpcResult<T>;
}

export interface ModelAdapter {
  id: string;                  // 'workers-ai:@cf/meta/llama-3.1-70b-instruct'
  generate(input: { messages: Array<{ role: string; content: string }> }): Promise<{ text: string }>;
  stream?(input: { messages: Array<{ role: string; content: string }> }): AsyncIterable<{ delta: string }>;
}
