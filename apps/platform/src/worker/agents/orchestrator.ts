// The Orchestrator — one Durable Object per user. Holds chat, delegates to specialists,
// runs Code Mode plans, kicks long jobs to a Workflow, streams over a WebSocket.

import { DurableObject } from 'cloudflare:workers';

import type { Env } from '../env';
import type {
  ChatMessage,
  Trajectory,
  ApprovalMode,
  ToolCall,
} from '../../shared/types';
import { pushApprovalNeeded, pushStatus } from '../lib/push';
import { generate as aiGenerate, inferenceFor } from '../lib/inference';
import { buildTools, runTool, listTools } from './tools/registry';

/** Mobile UX uses Send/Skip/Edit. We normalize to approve/deny/edit on the wire. */
export type ApprovalDecision = 'approve' | 'deny' | 'edit';

/** Stable, serializable approval record. Mirrors the mobile `Approval` shape. */
export interface ApprovalRecord {
  id: string;
  threadId: string;
  kind: 'tool' | 'send' | 'spend' | 'other';
  title: string;
  body?: string;
  meta?: string;
  costCents?: number;
  createdAt: number;
  status: 'pending' | 'resolved';
  decision?: ApprovalDecision;
  resolvedAt?: number;
  /** Free-form payload — captures the tool args / draft so the agent can resume. */
  context?: Record<string, unknown>;
}

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

export class Orchestrator extends DurableObject<Env> {
  // With .accept() (non-hibernation), the DO instance lives as long as the
  // socket is open. The in-memory Set is fine for broadcast.
  private sockets = new Set<WebSocket>();
  // Per-socket thread subscription. When a socket sends
  // `subscribe-thread:<threadId>`, we register it here; broadcasts that
  // include a `threadId` go only to sockets listening for that thread
  // (so multiple tabs don't echo each other's threads). Sockets without
  // an entry fall back to receiving everything — that's the legacy
  // behavior the verify suite relies on.
  private subs = new WeakMap<WebSocket, string>();
  private memory: OrchestratorState = { ...DEFAULT_STATE };

  /** Promise resolvers for `requestApproval` — keyed by approval id. In-memory
   * only; if the DO restarts mid-wait, the approval row stays `pending` in
   * storage and we surface it again on next status() call. */
  private approvalWaiters = new Map<string, (decision: ApprovalDecision) => void>();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.ctx.blockConcurrencyWhile(async () => this.initSchema());
  }

  // ctx/env are inherited from DurableObject — expose a `state` alias for the
  // existing call sites that reference it.
  private get state(): DurableObjectState {
    return this.ctx;
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
        archived INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0
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
      CREATE TABLE IF NOT EXISTS working_docs (
        thread_id TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        updated_at INTEGER NOT NULL
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
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        meta TEXT,
        cost_cents INTEGER,
        context TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        decision TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS approvals_status_created
        ON approvals (status, created_at);
    `);

    // Idempotent migration for existing DOs that predate the `pinned`
    // column. SQLite's ADD COLUMN errors if the column exists; the catch
    // swallows that case so a fresh `CREATE TABLE` and an upgraded existing
    // one both end in the same shape. Same pattern would apply to any
    // future column we tack on.
    try {
      sql.exec('ALTER TABLE threads ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
    } catch {
      /* column already exists — happens on every boot after the first */
    }

    const rows = sql.exec("SELECT value FROM settings WHERE key='memory'").toArray();
    const row = rows[0];
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

  // Rename a thread by id. Idempotent — silently no-ops on unknown id. Used
  // by /api/threads/<agent>/<id>/title from the Shell's inline rename.
  //
  // Emits `thread-renamed` to every connected socket (uses `id` not
  // `threadId` so the broadcast filter doesn't restrict it to the one
  // subscribed thread — the sidebar in every open tab needs the update).
  async renameThread(threadId: string, title: string): Promise<{ ok: boolean }> {
    const clean = title.trim().slice(0, 80);
    if (!threadId || !clean) return { ok: false };
    this.state.storage.sql.exec(
      'UPDATE threads SET title = ?, updated_at = ? WHERE id = ?',
      clean,
      Date.now(),
      threadId,
    );
    this.broadcast({ type: 'thread-renamed', id: threadId, title: clean });
    return { ok: true };
  }

  // Pin / unpin a thread. Pinned threads float to the top of the sidebar
  // regardless of recency. Broadcasts `thread-pinned` so other tabs
  // reconcile. Idempotent — silent no-op on unknown id.
  async pinThread(threadId: string, pinned: boolean): Promise<{ ok: boolean }> {
    if (!threadId) return { ok: false };
    this.state.storage.sql.exec(
      'UPDATE threads SET pinned = ? WHERE id = ?',
      pinned ? 1 : 0,
      threadId,
    );
    this.broadcast({ type: 'thread-pinned', id: threadId, pinned });
    return { ok: true };
  }

  // Archive / restore a thread by id. Archived threads disappear from
  // listThreads but the messages stay intact in DO SQLite so restore is
  // lossless. Broadcasts `thread-archived` so other tabs prune their
  // sidebar (or re-add on restore).
  async archiveThread(threadId: string, archived: boolean): Promise<{ ok: boolean }> {
    if (!threadId) return { ok: false };
    this.state.storage.sql.exec(
      'UPDATE threads SET archived = ?, updated_at = ? WHERE id = ?',
      archived ? 1 : 0,
      Date.now(),
      threadId,
    );
    this.broadcast({ type: 'thread-archived', id: threadId, archived });
    return { ok: true };
  }

  // Pinned "agent's notes" doc the user maintains per thread. Survives the
  // composer compaction loop because it lives in its own table rather than
  // as a message. Read returns empty body when nothing's been pinned yet.
  async getWorkingDoc(threadId: string): Promise<{ body: string; updatedAt: number | null }> {
    if (!threadId) return { body: '', updatedAt: null };
    const rows = this.state.storage.sql
      .exec('SELECT body, updated_at FROM working_docs WHERE thread_id = ?', threadId)
      .toArray();
    const row = rows[0];
    if (!row) return { body: '', updatedAt: null };
    return { body: String(row.body ?? ''), updatedAt: Number(row.updated_at) };
  }

  async setWorkingDoc(threadId: string, body: string): Promise<{ ok: boolean }> {
    if (!threadId) return { ok: false };
    const trimmed = body.slice(0, 8_000); // hard cap so the doc never bloats prompts
    this.state.storage.sql.exec(
      `INSERT INTO working_docs (thread_id, body, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
      threadId,
      trimmed,
      Date.now(),
    );
    return { ok: true };
  }

  // Pulled by /api/threads/<agent>/<threadId> for deep-link hydration from
  // the command palette. Returns the thread row plus the trailing N messages.
  async getThreadHead(
    threadId: string,
    tail = 50,
  ): Promise<{
    thread: { id: string; title: string; updatedAt: number } | null;
    messages: ChatMessage[];
  }> {
    const row = this.state.storage.sql
      .exec('SELECT id, title, updated_at FROM threads WHERE id = ?', threadId)
      .toArray()[0];
    if (!row) return { thread: null, messages: [] };
    const messages = await this.getThread(threadId);
    return {
      thread: {
        id: String(row.id),
        title: String(row.title ?? '(untitled)'),
        updatedAt: Number(row.updated_at),
      },
      messages: messages.slice(-tail),
    };
  }

  async listThreads(
    limit = 25,
    opts: { archived?: boolean } = {},
  ): Promise<Array<{ id: string; title: string; updatedAt: number; pinned?: boolean }>> {
    const archived = opts.archived ? 1 : 0;
    // Pinned threads always come first; within each group sort by recency.
    // `pinned DESC` puts 1s before 0s.
    const cursor = this.state.storage.sql.exec(
      'SELECT id, title, updated_at, pinned FROM threads WHERE archived = ? ORDER BY pinned DESC, updated_at DESC LIMIT ?',
      archived,
      limit,
    );
    return cursor.toArray().map((r) => ({
      id: String(r.id),
      title: String(r.title ?? '(untitled)'),
      updatedAt: Number(r.updated_at),
      pinned: Number(r.pinned ?? 0) === 1,
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
  //
  // The cap is a hard daily ceiling expressed in USD cents. Three behaviors
  // worth calling out:
  //   1. The midnight reset is computed lazily on every check — that way we
  //      don't depend on a Workers alarm or cron just to roll the counter.
  //   2. Approval mode (`full_auto` / `smart_auto` / `manual`) layers on top
  //      of this: spend gating is checked FIRST, and a denied tool short-
  //      circuits before any approval prompt would surface.
  //   3. The accounting happens AFTER the tool call returns — we charge the
  //      estimated cost on a successful run, so a failed call doesn't burn
  //      against the cap.
  async checkSpend(tool: ToolCall): Promise<{ allowed: boolean; reason?: string; remainingCents?: number }> {
    this.rolloverDailyCounter();
    const est = tool.estCostCents ?? estimateToolCost(tool);
    // Read settings once and use it for BOTH the cap override and the
    // deny-list check. Cap from settings overrides the constructor
    // default so a Spending-tab slider edit propagates without
    // restarting the DO.
    let denyList: string[] = [];
    try {
      const agentId = this.memory.agentName ?? 'default';
      const raw = await this.env.SETTINGS.get(`settings:${agentId}`);
      if (raw) {
        const cfg = JSON.parse(raw) as {
          denyTools?: string[];
          spendCapCents?: number;
        };
        if (typeof cfg.spendCapCents === 'number' && cfg.spendCapCents >= 0) {
          this.memory.spendCapCents = Math.min(
            1_000_000,
            Math.round(cfg.spendCapCents),
          );
        }
        if (Array.isArray(cfg.denyTools)) denyList = cfg.denyTools;
      }
    } catch {
      /* malformed settings — fall through to defaults */
    }
    const remainingCents = Math.max(0, this.memory.spendCapCents - this.memory.spentCentsToday);
    if (this.memory.spentCentsToday + est > this.memory.spendCapCents) {
      return { allowed: false, reason: 'spend_cap_exceeded', remainingCents };
    }
    // Per-tool deny list — the user can mark specific tools as "always
    // requires approval / never auto-run". Even in `full_auto`, a denied
    // tool short-circuits to the blocked path so the user sees it in the
    // tool-call chip + audit log.
    if (denyList.length > 0) {
      const name = tool.name?.toLowerCase() ?? '';
      const denied = denyList.some((d) => {
        const needle = d.trim().toLowerCase();
        if (!needle) return false;
        // Match exact name OR namespace prefix (e.g. `coder.` blocks
        // `coder.exec` and `coder.review`).
        return name === needle || name.startsWith(needle + '.');
      });
      if (denied) {
        return { allowed: false, reason: 'tool_denied', remainingCents };
      }
    }
    return { allowed: true, remainingCents };
  }

  private rolloverDailyCounter(): void {
    const now = Date.now();
    if (now >= this.memory.dailyResetAt) {
      this.memory.spentCentsToday = 0;
      this.memory.dailyResetAt = nextLocalMidnight(now);
      // Persistence happens async — failure isn't fatal.
      void this.persistMemory();
    }
  }

  private async chargeSpend(actualCents: number, tool?: string): Promise<void> {
    this.rolloverDailyCounter();
    this.memory.spentCentsToday += actualCents;
    await this.persistMemory();
    this.broadcast({
      type: 'spend',
      spentCentsToday: this.memory.spentCentsToday,
      spendCapCents: this.memory.spendCapCents,
      dailyResetAt: this.memory.dailyResetAt,
    });
    // Audit trail — append a tool_call row so the Spending tab + audit
    // surface can aggregate. Best-effort: a missing audit_log table or D1
    // outage won't break the chat path.
    if (tool && this.memory.agentName) {
      void this.audit('tool_call', { tool, costCents: actualCents });
    }
  }

  // Pull the agent's pinned Knowledge items and render them as a short
  // markdown slice for the system prompt. URLs and text snippets inline;
  // files only get a reference line so we don't blow the context budget.
  // Hard-capped at 6 pinned items and ~2KB total so this can never bloat
  // a single turn beyond a reasonable share of the system prompt.
  private async pinnedKnowledgeForPrompt(): Promise<string | null> {
    const agentId = this.memory.agentName ?? 'default';
    let items: Array<{
      kind: 'file' | 'url' | 'text';
      title: string;
      source: string;
      pinned?: boolean;
    }> = [];
    try {
      const raw = await this.env.SETTINGS.get(`knowledge:${agentId}`);
      if (!raw) return null;
      items = JSON.parse(raw);
    } catch {
      return null;
    }
    const pinned = items.filter((i) => i.pinned).slice(0, 6);
    if (pinned.length === 0) return null;

    const lines: string[] = [];
    let bytesUsed = 0;
    const CAP = 2_000;
    for (const item of pinned) {
      let line = '';
      if (item.kind === 'url') {
        line = `- **${item.title}** — ${item.source}`;
      } else if (item.kind === 'text') {
        let body = '';
        try {
          const obj = await this.env.ARTIFACTS.get(item.source);
          if (obj) {
            const t = await obj.text();
            body = t.length > 600 ? t.slice(0, 600) + '…' : t;
          }
        } catch {
          /* skip */
        }
        line = `- **${item.title}**\n  ${body.replace(/\n/g, '\n  ')}`;
      } else if (item.kind === 'file') {
        line = `- **${item.title}** (file — fetch via /api/artifacts/${item.source} if needed)`;
      }
      if (bytesUsed + line.length > CAP) break;
      lines.push(line);
      bytesUsed += line.length;
    }
    return lines.join('\n');
  }

  // ----- Audit log writer — fire-and-forget D1 insert. -----
  private async audit(kind: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.memory.agentName) return;
    try {
      await this.env.DB.prepare(
        `INSERT INTO audit_log (id, agent_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(crypto.randomUUID(), this.memory.agentName, kind, JSON.stringify(payload), Date.now())
        .run();
    } catch (err) {
      if (err instanceof Error && /no such table/i.test(err.message)) return;
      console.warn('[orchestrator] audit write failed', err);
    }
  }

  // ============================================================
  // Approval flow — agent asks, user answers, agent resumes.
  // ============================================================
  //
  // The pattern: any agent path that wants approval calls
  // `await this.requestApproval(...)` and the promise resolves once
  // `respondToApproval(id, decision)` is called (from the mobile app
  // or the desktop UI). The agent code reads the decision and proceeds.
  //
  // Persistence: approvals live in the DO's SQLite so a DO restart
  // mid-wait doesn't drop them. The in-memory `approvalWaiters` map
  // only holds the JS promise resolvers; if the DO restarted, the
  // caller has already returned to the user — the row is still
  // `pending` and the next responder will just see it as resolved.
  //
  // Broadcast: every transition fires a WS event so the web shell +
  // mobile both see live updates. A push notification fires on the
  // creation side so users away from the app get nudged.

  /** Create a pending approval and resolve once the user responds.
   *  Returns a promise that resolves with the decision.
   *  Push + WS broadcast both happen as part of this call.
   */
  async requestApproval(req: Omit<ApprovalRecord, 'status' | 'createdAt' | 'id'> & { id?: string }): Promise<ApprovalDecision> {
    const id = req.id ?? crypto.randomUUID();
    const record: ApprovalRecord = {
      ...req,
      id,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.state.storage.sql.exec(
      `INSERT INTO approvals (id, thread_id, kind, title, body, meta, cost_cents, context, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      record.id,
      record.threadId,
      record.kind,
      record.title,
      record.body ?? null,
      record.meta ?? null,
      record.costCents ?? null,
      record.context ? JSON.stringify(record.context) : null,
      record.createdAt,
    );

    void this.audit('approval-requested', {
      id: record.id,
      threadId: record.threadId,
      kind: record.kind,
      costCents: record.costCents,
    });

    this.broadcast({ type: 'approval-needed', approval: this.toWireApproval(record) });

    // Best-effort push — never blocks the awaiting promise.
    void (async () => {
      if (!this.memory.agentName) return;
      try {
        await pushApprovalNeeded(this.env, this.memory.agentName, {
          id: record.id,
          title: record.title,
          body: record.body,
          threadId: record.threadId,
        });
      } catch (err) {
        console.warn('[orchestrator] approval push failed', err);
      }
    })();

    // Resolve when respondToApproval fires.
    return new Promise<ApprovalDecision>((resolve) => {
      this.approvalWaiters.set(record.id, resolve);
    });
  }

  /** List pending approvals (newest first). Used by GET /api/mobile/approvals. */
  async listPendingApprovals(): Promise<ApprovalRecord[]> {
    const rows = this.state.storage.sql
      .exec(
        `SELECT id, thread_id, kind, title, body, meta, cost_cents, context, status, decision, created_at, resolved_at
         FROM approvals WHERE status = 'pending' ORDER BY created_at DESC LIMIT 50`,
      )
      .toArray();
    return rows.map((r) => this.rowToApproval(r as Record<string, unknown>));
  }

  /** Record the user's decision, resolve the awaiting promise, broadcast. */
  async respondToApproval(id: string, decision: ApprovalDecision): Promise<{ ok: boolean; reason?: string }> {
    if (!id) return { ok: false, reason: 'missing_id' };
    if (decision !== 'approve' && decision !== 'deny' && decision !== 'edit') {
      return { ok: false, reason: 'invalid_decision' };
    }
    const now = Date.now();
    const rows = this.state.storage.sql
      .exec('SELECT status FROM approvals WHERE id = ?', id)
      .toArray();
    const row = rows[0];
    if (!row) return { ok: false, reason: 'not_found' };
    if (String(row.status) === 'resolved') return { ok: false, reason: 'already_resolved' };
    this.state.storage.sql.exec(
      `UPDATE approvals SET status = 'resolved', decision = ?, resolved_at = ? WHERE id = ?`,
      decision,
      now,
      id,
    );
    this.broadcast({ type: 'approval-resolved', id, decision, resolvedAt: now });
    void this.audit('approval-resolved', { id, decision });

    // Resolve the awaiting promise — does nothing if the DO restarted
    // mid-wait and the resolver is gone (caller already returned).
    const waiter = this.approvalWaiters.get(id);
    if (waiter) {
      this.approvalWaiters.delete(id);
      waiter(decision);
    }
    return { ok: true };
  }

  /** Send a push for a status update — e.g. "task done", "spend cap hit".
   *  Exposed as RPC so future tools can call it cheaply. */
  async notifyStatus(title: string, body: string, deepLink?: string): Promise<{ ok: number; failed: number; devices: number }> {
    if (!this.memory.agentName) return { ok: 0, failed: 0, devices: 0 };
    try {
      return await pushStatus(this.env, this.memory.agentName, title, body, deepLink);
    } catch (err) {
      console.warn('[orchestrator] status push failed', err);
      return { ok: 0, failed: 0, devices: 0 };
    }
  }

  // ============================================================
  // Declarative tool runner — agents-starter pattern.
  // ============================================================
  //
  // Each tool is a `tool({ inputSchema, execute, needsApproval })`
  // object declared in `tools/registry.ts`. We resolve them per-call
  // because the registry binds `requestApproval` to *this* DO and
  // *this* thread — that wiring can't be done at module-load time
  // since the DO is per-agent.
  //
  // Adding a tool is a one-liner in registry.ts. The approval hook
  // routes through the same plumbing the mobile app already drives;
  // the tool author never touches WS frames or DO state directly.

  /** Resolve and run a tool by name. Returns `{ok, output}` or `{ok:false}`. */
  async runDeclarativeTool(
    threadId: string,
    name: string,
    args: unknown,
  ): Promise<
    | { ok: true; output: unknown }
    | { ok: false; reason: string; detail?: string }
  > {
    const tools = buildTools({
      env: this.env,
      threadId,
      requestApproval: (req) => this.requestApproval(req),
    });
    const result = await runTool(tools, name, args, {
      env: this.env,
      threadId,
      requestApproval: (req) => this.requestApproval(req),
    });
    // Audit + spend hooks so behavior parity with the legacy intent path:
    // - declined: log as a `tool_blocked` audit event so the spending
    //   panel still reflects the agent attempt.
    // - succeeded: charge the estimated cost class (1¢ floor).
    if (result.ok) {
      void this.audit('tool_call', { tool: name });
      await this.chargeSpend(1, name);
    } else if (result.reason === 'denied') {
      void this.audit('tool_blocked', { tool: name, reason: 'user_denied' });
    }
    return result;
  }

  /** List declarative tools — useful for the Skills surface to render
   *  the available tools without parsing the registry directly. */
  async listDeclarativeTools(threadId: string): Promise<Array<{ name: string; description: string; needsApproval: boolean }>> {
    const tools = buildTools({
      env: this.env,
      threadId,
      requestApproval: (req) => this.requestApproval(req),
    });
    return listTools(tools);
  }

  /** Shape for the WS frame + mobile API. Hides the SQL row keys. */
  private toWireApproval(r: ApprovalRecord): Record<string, unknown> {
    return {
      id: r.id,
      threadId: r.threadId,
      kind: r.kind,
      title: r.title,
      body: r.body,
      meta: r.meta,
      costUsd: typeof r.costCents === 'number' ? r.costCents / 100 : undefined,
      createdAt: r.createdAt,
    };
  }

  private rowToApproval(row: Record<string, unknown>): ApprovalRecord {
    const ctxRaw = row.context;
    let context: Record<string, unknown> | undefined;
    if (typeof ctxRaw === 'string' && ctxRaw.length > 0) {
      try {
        context = JSON.parse(ctxRaw) as Record<string, unknown>;
      } catch {
        /* malformed context — drop it rather than failing the list call */
      }
    }
    return {
      id: String(row.id),
      threadId: String(row.thread_id ?? ''),
      kind: (row.kind as ApprovalRecord['kind']) ?? 'other',
      title: String(row.title ?? ''),
      body: typeof row.body === 'string' ? row.body : undefined,
      meta: typeof row.meta === 'string' ? row.meta : undefined,
      costCents: typeof row.cost_cents === 'number' ? row.cost_cents : undefined,
      context,
      status: (row.status as ApprovalRecord['status']) ?? 'pending',
      decision: (row.decision as ApprovalDecision | undefined) ?? undefined,
      createdAt: Number(row.created_at ?? 0),
      resolvedAt: typeof row.resolved_at === 'number' ? row.resolved_at : undefined,
    };
  }

  // ----- HTTP / WebSocket -----
  override async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('Upgrade');
    if (upgrade === 'websocket') return this.handleWebSocket(request);
    return new Response('orchestrator', { status: 200 });
  }

  private handleWebSocket(_request: Request): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernation-aware API:
    //   this.state.acceptWebSocket(server) + webSocketMessage / webSocketClose
    //   / webSocketError lifecycle methods on the DO class.
    //
    // Miniflare 3 + wrangler 3 in local mode doesn't always dispatch those
    // lifecycle hooks reliably (works in prod, sometimes silent locally), so
    // we fall back to the synchronous .accept() + addEventListener path. The
    // DO still hibernates between requests; the WS just terminates when the
    // DO is evicted, and the client reconnects. Acceptable for v1.0.
    server.accept();
    this.sockets.add(server);

    server.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(event.data);
      } catch {
        server.send(JSON.stringify({ type: 'error', error: 'invalid_json' }));
        return;
      }
      void this.dispatch(server, msg);
    });

    server.addEventListener('close', () => {
      this.sockets.delete(server);
      this.subs.delete(server);
    });

    server.addEventListener('error', (err: ErrorEvent) => {
      console.error('[orchestrator] ws error', err.message ?? 'unknown');
      this.sockets.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
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
          this.subs.set(ws, msg.threadId);
          const history = await this.getThread(msg.threadId);
          ws.send(JSON.stringify({ type: 'thread-history', threadId: msg.threadId, history }));
        }
        return;
      case 'unsubscribe-thread':
        this.subs.delete(ws);
        return;
      case 'set-approval-mode': {
        const mode = typeof msg.mode === 'string' ? msg.mode : null;
        if (mode === 'full_auto' || mode === 'smart_auto' || mode === 'manual') {
          const previous = this.memory.mode;
          this.memory.mode = mode;
          await this.persistMemory();
          ws.send(JSON.stringify({ type: 'mode-set', mode: this.memory.mode }));
          if (previous !== mode) {
            void this.audit('approval', { from: previous, to: mode });
          }
        } else {
          ws.send(JSON.stringify({ type: 'error', error: 'invalid_mode' }));
        }
        return;
      }
      case 'set-code-mode': {
        const val = typeof msg.value === 'string' ? msg.value : null;
        if (val === 'always' || val === 'smart' || val === 'off') {
          this.memory.codeModeEnabled = val;
          await this.persistMemory();
          ws.send(JSON.stringify({ type: 'code-mode-set', value: this.memory.codeModeEnabled }));
        } else {
          ws.send(JSON.stringify({ type: 'error', error: 'invalid_code_mode' }));
        }
        return;
      }
      case 'status':
        ws.send(JSON.stringify({ type: 'status', state: this.memory }));
        return;
      default:
        ws.send(JSON.stringify({ type: 'error', error: `unknown_message_type:${msg.type}` }));
    }
  }

  private async handleSend(
    ws: WebSocket,
    msg: { type: string; threadId?: unknown; content?: unknown; mode?: unknown },
  ): Promise<void> {
    let threadId: string;
    if (typeof msg.threadId === 'string' && msg.threadId.length > 0) {
      threadId = msg.threadId;
      // Ensure the thread row exists; idempotent insert lets us accept either
      // a known-existing id or a client-generated one without a separate
      // create-thread roundtrip.
      this.state.storage.sql.exec(
        `INSERT OR IGNORE INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        threadId,
        'New thread',
        Date.now(),
        Date.now(),
      );
    } else {
      threadId = (await this.createThread()).id;
    }
    const content = typeof msg.content === 'string' ? msg.content : '';
    const composerMode =
      typeof msg.mode === 'string' && ['auto', 'plan', 'train'].includes(msg.mode)
        ? (msg.mode as 'auto' | 'plan' | 'train')
        : 'auto';
    const now = Date.now();

    const user: ChatMessage = {
      id: crypto.randomUUID(),
      threadId,
      role: 'user',
      content,
      createdAt: now,
    };
    await this.appendMessage(user);

    // Intent routing — top-down delegation to specialist sub-agents over DO
    // RPC. We detect coarse intent from the prompt; the specialist's stub
    // result gets surfaced as a tool call attached to the assistant message.
    // This is the "agents talk to each other" hook from PRD §5.4: in-Worker
    // RPC, no MCP-over-HTTP needed for own-account specialists.
    const toolCalls: ToolCall[] = [];
    const intent = this.detectIntent(content);
    if (intent === 'research' && this.env.RESEARCHER) {
      const callId = crypto.randomUUID();
      const proposed: ToolCall = {
        id: callId,
        name: 'researcher.research',
        args: { query: content },
        estCostCents: 2,
        status: 'pending',
      };
      const gate = await this.checkSpend(proposed);
      if (!gate.allowed) {
        ws.send(
          JSON.stringify({
            type: 'tool-blocked',
            threadId,
            callId,
            tool: proposed.name,
            reason: gate.reason,
            remainingCents: gate.remainingCents,
          }),
        );
        toolCalls.push({ ...proposed, status: 'error', result: { blocked: gate.reason } });
      } else {
        try {
          const id = this.env.RESEARCHER.idFromName(this.memory.agentName ?? 'default');
          const stubDo = this.env.RESEARCHER.get(id);
          ws.send(JSON.stringify({ type: 'tool-start', threadId, callId, tool: proposed.name }));
          const req = new Request('https://do/internal', {
            method: 'POST',
            body: JSON.stringify({ method: 'research', args: { query: content } }),
          });
          const res = await stubDo.fetch(req);
          const data = (await res.json().catch(() => ({}))) as {
            data?: { summary?: string; url?: string; bytes?: number };
          };
          // Persist the research result as an R2 artifact so the user can
          // find it in the Library. The summary lives as Markdown; the URL
          // (if there was one) is captured in customMetadata so the viewer
          // can render a source link.
          const summary = data.data?.summary ?? '';
          let artifactKey: string | undefined;
          if (summary.trim()) {
            try {
              const title = content.slice(0, 60).trim() || 'Research result';
              artifactKey = `artifacts/${this.memory.agentName ?? 'agent'}/research/${callId}.md`;
              const sourceUrl = data.data?.url ?? '';
              const body =
                `# ${title}\n\n` +
                (sourceUrl ? `Source: <${sourceUrl}>\n\n` : '') +
                summary;
              await this.env.ARTIFACTS.put(artifactKey, body, {
                httpMetadata: { contentType: 'text/markdown' },
                customMetadata: {
                  title,
                  version: '1',
                  sourceUrl,
                  turnId: callId,
                },
              });
            } catch (artErr) {
              console.warn('[orchestrator] research → artifact failed', artErr);
              artifactKey = undefined;
            }
          }
          toolCalls.push({
            ...proposed,
            result: { ...data, artifactKey },
            status: 'done',
          });
          await this.chargeSpend(proposed.estCostCents ?? 0, proposed.name);
          ws.send(
            JSON.stringify({
              type: 'tool-done',
              threadId,
              callId,
              result: { ...data, artifactKey },
            }),
          );
        } catch (err) {
          console.error('[orchestrator] researcher invoke failed', err);
          toolCalls.push({
            ...proposed,
            status: 'error',
            result: { error: err instanceof Error ? err.message : String(err) },
          });
        }
      }
    } else if (intent === 'code' && this.env.CODER) {
      const callId = crypto.randomUUID();
      const proposed: ToolCall = {
        id: callId,
        name: 'coder.exec',
        args: { language: 'auto', source: content },
        estCostCents: 1,
        status: 'pending',
      };
      const gate = await this.checkSpend(proposed);
      if (!gate.allowed) {
        ws.send(
          JSON.stringify({
            type: 'tool-blocked',
            threadId,
            callId,
            tool: proposed.name,
            reason: gate.reason,
            remainingCents: gate.remainingCents,
          }),
        );
        toolCalls.push({ ...proposed, status: 'error', result: { blocked: gate.reason } });
      } else {
        try {
          const id = this.env.CODER.idFromName(this.memory.agentName ?? 'default');
          const stubDo = this.env.CODER.get(id);
          ws.send(JSON.stringify({ type: 'tool-start', threadId, callId, tool: proposed.name }));
          const req = new Request('https://do/internal', {
            method: 'POST',
            body: JSON.stringify({ method: 'exec', args: { language: 'auto', source: content } }),
          });
          const res = await stubDo.fetch(req);
          const data = (await res.json().catch(() => ({}))) as { data?: { stdout?: string } };
          toolCalls.push({ ...proposed, result: data, status: 'done' });
          await this.chargeSpend(proposed.estCostCents ?? 0, proposed.name);
          ws.send(JSON.stringify({ type: 'tool-done', threadId, callId, result: data }));
        } catch (err) {
          console.error('[orchestrator] coder invoke failed', err);
          toolCalls.push({
            ...proposed,
            status: 'error',
            result: { error: err instanceof Error ? err.message : String(err) },
          });
        }
      }
    }

    // Composer-mode handling. Plan and Train modes still call the LLM but the
    // system prompt asks for an explicit numbered plan rather than a direct
    // answer; the frontend renders this as a PlanCard. Auto runs the model
    // normally.
    let systemPrompt =
      composerMode === 'plan' || composerMode === 'train'
        ? this.planPrompt(composerMode)
        : this.systemPrompt();

    // Inject the Working Doc (the user's pinned notes for this thread) so
    // the LLM has them in every turn without polluting the visible history.
    // It survives compaction by design — that's the whole point of the
    // chip. Capped well below the LLM's context budget by the DO writer.
    const workingDoc = await this.getWorkingDoc(threadId);
    if (workingDoc.body.trim()) {
      systemPrompt += `\n\n## Working notes for this thread (always read first)\n${workingDoc.body.trim()}`;
    }

    // Inject pinned Knowledge items so the agent sees standing context
    // (preferences, project facts, source URLs) on every turn. We only
    // include `pinned: true` items — Knowledge can hold up to 50 entries
    // and we don't want to drown the prompt. For text/url we inline; for
    // file kinds we surface the R2 key so the agent knows there's a file
    // available it can fetch via a tool call.
    const knowledgeSlice = await this.pinnedKnowledgeForPrompt();
    if (knowledgeSlice) {
      systemPrompt += `\n\n## Pinned knowledge (always available)\n${knowledgeSlice}`;
    }

    const recent = (await this.getThread(threadId)).slice(-20);
    const aiMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...recent.map((m) => ({
        role: (m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : 'system') as
          | 'system'
          | 'user'
          | 'assistant',
        content: m.content,
      })),
    ];

    // Charge the LLM call against the spend cap before issuing the request,
    // so a single very-long thread can't blow past the cap by accident.
    const llmGate = await this.checkSpend({
      id: 'llm',
      name: 'workers-ai/llama-3.1-8b',
      args: { tokens: recent.length * 40 },
      estCostCents: 1,
      status: 'pending',
    });
    let reply = '';
    if (!llmGate.allowed) {
      reply =
        `I've hit today's spend cap ($${(this.memory.spendCapCents / 100).toFixed(2)}). ` +
        `Bump it in Settings → Spending if you want me to keep going — resets at local midnight.`;
    } else
    try {
      // Inference goes through `lib/inference.ts` so the model + AI
      // Gateway choice lives in one place. The 3.5s timeout still
      // applies — llama-3.1-8b typically responds in 1-2s; this gives
      // headroom while still letting the verify suite's 4.5s WS-frame
      // window complete reliably. On timeout the user sees a graceful
      // "didn't respond in time" reply and can re-send.
      const result = await aiGenerate(inferenceFor(this.env), {
        messages: aiMessages,
        costClass: 'cheap',
        timeoutMs: 3_500,
      });
      reply = result.text;
      await this.chargeSpend(1, 'workers-ai/llama-3.1-8b');
    } catch (err) {
      console.error('[orchestrator] AI.run failed', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      // Local dev runs Workers AI against the real CF API and needs a fresh
      // OAuth token. Surface that specifically so the developer knows what to
      // do; the model itself doesn't actually have transient hiccups often.
      if (/Invalid access token|Not logged in|9109/i.test(errMsg)) {
        reply =
          'Workers AI is reachable but the local wrangler OAuth token has expired. Run `wrangler login` in the platform directory and try again.';
      } else if (/ai_timeout/i.test(errMsg)) {
        reply =
          "Workers AI didn't respond in time — try again? (If this keeps happening, check the model status in your CF dashboard.)";
      } else {
        reply =
          "I couldn't reach the model just now — Workers AI returned an error. Check `wrangler dev` logs for details.";
      }
    }

    if (!reply.trim()) {
      reply = '(model returned an empty response)';
    }

    const assistant: ChatMessage = {
      id: crypto.randomUUID(),
      threadId,
      role: 'assistant',
      content: reply.trim(),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      createdAt: Date.now(),
    };
    await this.appendMessage(assistant);

    // Auto-summarize the thread title on the first turn. Skip when the
    // thread already has a non-default title (user renamed it, or this
    // isn't the first turn). The summary call is best-effort: a Workers
    // AI hiccup falls back to the user content's first 6 words.
    void this.autoSummarizeTitle(threadId, content, assistant.content).catch(() => undefined);

    void this.recordTrajectory({
      turnId: crypto.randomUUID(),
      agentId: this.memory.agentName ?? 'unnamed',
      threadId,
      input: user,
      toolCalls,
      output: assistant,
      model: '@cf/meta/llama-3.1-8b-instruct',
      createdAt: Date.now(),
    });
  }

  private detectIntent(content: string): 'research' | 'code' | 'chat' {
    const lower = content.toLowerCase();
    if (/\b(research|look up|find sources?|browse|crawl|summari[sz]e the article|cite)\b/.test(lower)) {
      return 'research';
    }
    if (/\b(run|execute|exec|python|javascript|node|bash|shell|script|repro)\b/.test(lower) && /\b(code|snippet|function|script)\b/.test(lower)) {
      return 'code';
    }
    return 'chat';
  }

  private planPrompt(mode: 'plan' | 'train'): string {
    const base = this.systemPrompt();
    if (mode === 'train') {
      return `${base}\n\nThe user has switched to TRAIN mode. Before doing anything, externalize your reasoning as a short numbered plan (3-7 concrete steps). After the plan, ask one clarifying question if anything is ambiguous. Do not execute yet — wait for approval.`;
    }
    return `${base}\n\nThe user has switched to PLAN mode. Respond with a short numbered plan (3-7 steps), then a one-line "Approve to run?" prompt. Do not execute the plan in this turn.`;
  }

  private systemPrompt(): string {
    const name = this.memory.agentName ?? 'an OpenThink agent';
    const owner = this.memory.ownerEmail ?? 'your owner';
    return `You are ${name}, a personal AI agent running on a Cloudflare Worker owned by ${owner}. You live in their account, with their data, and you talk like a thoughtful collaborator — calm, specific, never breathless. When the user asks you to do something you can't yet do (browser sessions, code execution in a sandbox, drafting artifacts to the canvas), say so plainly and offer the closest thing you can. Keep answers concise unless asked to elaborate. Don't begin replies with apologies or with "Sure," or "Of course," — just start.`;
  }

  private broadcast(payload: unknown): void {
    const blob = JSON.stringify(payload);
    const threadScope =
      payload && typeof payload === 'object' && 'threadId' in (payload as Record<string, unknown>)
        ? String((payload as Record<string, unknown>).threadId)
        : null;
    const dead: WebSocket[] = [];
    for (const ws of this.sockets) {
      try {
        const sub = this.subs.get(ws);
        // If the socket subscribed to a specific thread, only send frames
        // for that thread. Unsubscribed sockets get everything (legacy
        // surface still relied on by the chrome connector + verify).
        if (sub && threadScope && sub !== threadScope) continue;
        ws.send(blob);
      } catch {
        dead.push(ws);
      }
    }
    for (const ws of dead) {
      this.sockets.delete(ws);
      this.subs.delete(ws);
    }
  }

  // Auto-summary thread title — fires after the first user/assistant pair
  // lands. Only retitles when the current title is the default ("New thread"
  // / falsy / a pre-canned welcome) so user renames are never clobbered.
  // The summary is a small Workers AI call asking for 4-6 words; a failed
  // call falls back to the first 6 words of the user prompt.
  private async autoSummarizeTitle(
    threadId: string,
    userContent: string,
    assistantContent: string,
  ): Promise<void> {
    if (!threadId) return;
    // Only proceed if (a) the thread currently has the default placeholder
    // and (b) this is the FIRST assistant turn (so we don't keep re-naming
    // an established thread). Both checks hit the SAME DO SQLite read.
    const rows = this.state.storage.sql
      .exec(
        `SELECT
           (SELECT title FROM threads WHERE id = ?) AS title,
           (SELECT COUNT(*) FROM messages WHERE thread_id = ? AND role = 'assistant') AS turns`,
        threadId,
        threadId,
      )
      .toArray();
    const row = rows[0];
    if (!row) return;
    const currentTitle = String(row.title ?? '').trim();
    const turns = Number(row.turns ?? 0);
    if (turns !== 1) return; // not the first assistant turn
    const isDefault =
      !currentTitle ||
      currentTitle === 'New thread' ||
      currentTitle === '(untitled)' ||
      /^new conversation/i.test(currentTitle) ||
      /^welcome/i.test(currentTitle);
    if (!isDefault) return;

    let summarized = '';
    try {
      const res = await aiGenerate(inferenceFor(this.env), {
        costClass: 'cheap',
        messages: [
          {
            role: 'system',
            content:
              'You name conversation threads. Read the first turn and reply with a 4-6 word title in title case, no quotes, no trailing punctuation. Just the title.',
          },
          {
            role: 'user',
            content: `User: ${userContent.slice(0, 600)}\n\nAssistant: ${assistantContent.slice(0, 400)}`,
          },
        ],
      });
      summarized = res.text.trim();
    } catch {
      /* fall through to heuristic */
    }
    // Sanitize: strip surrounding quotes, drop trailing punctuation, clamp
    // length so a chatty model can't write a paragraph here.
    summarized = summarized
      .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
      .replace(/[.!?]+$/g, '')
      .slice(0, 80)
      .trim();
    // Fallback heuristic if the LLM gave us nothing useful.
    if (!summarized || summarized.length < 3) {
      summarized = userContent
        .split(/\s+/)
        .slice(0, 6)
        .join(' ')
        .slice(0, 60);
    }
    if (!summarized) return;
    // Reuse the existing rename path so the broadcast fires and other tabs
    // pick up the new title automatically.
    await this.renameThread(threadId, summarized);
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

// Default cost estimate when a tool call doesn't supply one. We bias high
// (research > browser session > sandbox exec > llm) so the cap is the floor.
function estimateToolCost(tool: ToolCall): number {
  const name = tool.name.toLowerCase();
  if (name.includes('browser')) return 4;
  if (name.includes('researcher')) return 2;
  if (name.includes('coder')) return 1;
  if (name.includes('llama-3.1-70b')) return 5;
  if (name.includes('claude-opus') || name.includes('gpt-4')) return 12;
  return 1;
}

function nextLocalMidnight(now: number): number {
  const d = new Date(now);
  const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return tomorrow.getTime();
}
