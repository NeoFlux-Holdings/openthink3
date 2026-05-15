// The Orchestrator — one Durable Object per user. Holds chat, delegates to specialists,
// runs Code Mode plans, kicks long jobs to a Workflow, streams over a WebSocket.

import type { Env } from '../env';
import type {
  ChatMessage,
  Trajectory,
  ApprovalMode,
  ToolCall,
} from '../../shared/types';

interface OrchestratorState {
  ready: boolean;
  agentName: string | null;
  ownerEmail: string | null;
  mode: ApprovalMode;
  spendCapCents: number;
  spentCentsToday: number;
  dailyResetAt: number;
  codeModeEnabled: 'always' | 'smart' | 'off';
}

const DEFAULT_STATE: OrchestratorState = {
  ready: false,
  agentName: null,
  ownerEmail: null,
  mode: 'smart_auto',
  spendCapCents: 500,
  spentCentsToday: 0,
  dailyResetAt: 0,
  codeModeEnabled: 'smart',
};

export class Orchestrator implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private sockets = new Set<WebSocket>();
  private memory: OrchestratorState = { ...DEFAULT_STATE };

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => this.initSchema());
  }

  // ----- Storage bootstrap -----
  private async initSchema(): Promise<void> {
    const sql = this.state.storage.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        artifacts TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tool_policies (
        tool_name TEXT NOT NULL,
        scope TEXT NOT NULL,
        arg_pattern TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (tool_name, arg_pattern)
      );
      CREATE INDEX IF NOT EXISTS messages_thread_created
        ON messages (thread_id, created_at);
    `);

    const row = sql.exec("SELECT value FROM settings WHERE key='memory'").one();
    if (row && typeof row.value === 'string') {
      try {
        this.memory = { ...DEFAULT_STATE, ...JSON.parse(row.value) };
      } catch (err) {
        console.error('[orchestrator] settings parse failed', err);
      }
    }
  }

  private async persistMemory(): Promise<void> {
    this.state.storage.sql.exec(
      "INSERT INTO settings (key, value) VALUES ('memory', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      JSON.stringify(this.memory),
    );
  }

  // ----- RPC hooks (called by other DOs and routes) -----
  async hydrate(opts: { agentName: string; ownerEmail: string }): Promise<{ ok: true }> {
    this.memory.agentName = opts.agentName;
    this.memory.ownerEmail = opts.ownerEmail;
    this.memory.ready = true;
    await this.persistMemory();
    return { ok: true };
  }

  async status(): Promise<OrchestratorState> {
    return this.memory;
  }

  async listThreads(limit = 25): Promise<Array<{ id: string; title: string; updatedAt: number }>> {
    const cursor = this.state.storage.sql.exec(
      'SELECT id, title, updated_at FROM threads WHERE archived = 0 ORDER BY updated_at DESC LIMIT ?',
      limit,
    );
    return cursor.toArray().map((r) => ({
      id: String(r.id),
      title: String(r.title ?? '(untitled)'),
      updatedAt: Number(r.updated_at),
    }));
  }

  async createThread(title?: string): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.state.storage.sql.exec(
      'INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
      id,
      title ?? 'New thread',
      now,
      now,
    );
    return { id };
  }

  async getThread(threadId: string): Promise<ChatMessage[]> {
    const cursor = this.state.storage.sql.exec(
      'SELECT id, thread_id, role, content, tool_calls, artifacts, created_at FROM messages WHERE thread_id = ? ORDER BY created_at ASC',
      threadId,
    );
    return cursor.toArray().map((r): ChatMessage => ({
      id: String(r.id),
      threadId: String(r.thread_id),
      role: r.role as ChatMessage['role'],
      content: String(r.content),
      toolCalls: r.tool_calls ? JSON.parse(String(r.tool_calls)) : undefined,
      artifacts: r.artifacts ? JSON.parse(String(r.artifacts)) : undefined,
      createdAt: Number(r.created_at),
    }));
  }

  async appendMessage(msg: ChatMessage): Promise<void> {
    this.state.storage.sql.exec(
      'INSERT INTO messages (id, thread_id, role, content, tool_calls, artifacts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      msg.id,
      msg.threadId,
      msg.role,
      msg.content,
      msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      msg.artifacts ? JSON.stringify(msg.artifacts) : null,
      msg.createdAt,
    );
    this.state.storage.sql.exec(
      'UPDATE threads SET updated_at = ? WHERE id = ?',
      msg.createdAt,
      msg.threadId,
    );
    this.broadcast({ type: 'message', message: msg });
  }

  // ----- Spend gating — the floor every approval mode passes through -----
  async checkSpend(tool: ToolCall): Promise<{ allowed: boolean; reason?: string }> {
    const est = tool.estCostCents ?? 0;
    if (this.memory.spentCentsToday + est > this.memory.spendCapCents) {
      return { allowed: false, reason: 'spend_cap_exceeded' };
    }
    return { allowed: true };
  }

  // ----- HTTP / WebSocket -----
  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('Upgrade');
    if (upgrade === 'websocket') return this.handleWebSocket(request);
    return new Response('orchestrator', { status: 200 });
  }

  private handleWebSocket(_request: Request): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    this.sockets.add(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): void {
    if (typeof raw !== 'string') return;
    let msg: { type: string; [key: string]: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: 'invalid_json' }));
      return;
    }
    void this.dispatch(ws, msg);
  }

  webSocketClose(ws: WebSocket): void {
    this.sockets.delete(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.sockets.delete(ws);
  }

  private async dispatch(ws: WebSocket, msg: { type: string; [key: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        return;
      case 'send':
        await this.handleSend(ws, msg);
        return;
      case 'subscribe-thread':
        if (typeof msg.threadId === 'string') {
          const history = await this.getThread(msg.threadId);
          ws.send(JSON.stringify({ type: 'thread-history', threadId: msg.threadId, history }));
        }
        return;
      default:
        ws.send(JSON.stringify({ type: 'error', error: `unknown_message_type:${msg.type}` }));
    }
  }

  private async handleSend(
    _ws: WebSocket,
    msg: { type: string; threadId?: unknown; content?: unknown; mode?: unknown },
  ): Promise<void> {
    const threadId = typeof msg.threadId === 'string' ? msg.threadId : (await this.createThread()).id;
    const content = typeof msg.content === 'string' ? msg.content : '';
    const now = Date.now();

    const user: ChatMessage = {
      id: crypto.randomUUID(),
      threadId,
      role: 'user',
      content,
      createdAt: now,
    };
    await this.appendMessage(user);

    // Stub assistant echo for now. The real router lands in iteration 6.
    const assistant: ChatMessage = {
      id: crypto.randomUUID(),
      threadId,
      role: 'assistant',
      content: `(stub) Heard: "${content}". Real model routing arrives with the orchestration phase.`,
      createdAt: Date.now(),
    };
    await this.appendMessage(assistant);

    void this.recordTrajectory({
      turnId: crypto.randomUUID(),
      agentId: this.memory.agentName ?? 'unnamed',
      threadId,
      input: user,
      toolCalls: [],
      output: assistant,
      model: 'stub',
      createdAt: Date.now(),
    });
  }

  private broadcast(payload: unknown): void {
    const blob = JSON.stringify(payload);
    const dead: WebSocket[] = [];
    for (const ws of this.sockets) {
      try {
        ws.send(blob);
      } catch {
        dead.push(ws);
      }
    }
    for (const ws of dead) this.sockets.delete(ws);
  }

  // ----- Trajectory capture — async via queue so it never blocks a response -----
  private async recordTrajectory(t: Trajectory): Promise<void> {
    try {
      await this.env.TRAJECTORIES.send(t);
    } catch (err) {
      console.error('[orchestrator] trajectory enqueue failed', err);
    }
  }
}
