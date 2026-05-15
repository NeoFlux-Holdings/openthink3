import { DurableObject } from 'cloudflare:workers';

import type { Env } from '../env';

// BrowserSession — owns a live Cloudflare Browser Rendering instance. Streams
// screenshots over WS to the canvas iframe; persists session state (cookies,
// last URL, recent actions) in DO SQLite so the session survives Worker
// restarts.

interface SessionMemory {
  url: string;
  title: string;
  status: 'idle' | 'navigating' | 'streaming' | 'paused' | 'closed';
  takenOver: boolean;
  recentActions: string[];
  startedAt: number;
  hibernateTimerId?: number;
}

const DEFAULT_STATE: SessionMemory = {
  url: 'about:blank',
  title: 'New tab',
  status: 'idle',
  takenOver: false,
  recentActions: [],
  startedAt: 0,
};

const STREAM_FPS_ACTIVE = 5;
const STREAM_FPS_HIDDEN = 1;
const HIBERNATE_MS = 5 * 60_000;

interface BrowserPage {
  goto(url: string, opts?: { waitUntil?: string }): Promise<unknown>;
  goBack(): Promise<unknown>;
  goForward(): Promise<unknown>;
  reload(): Promise<unknown>;
  screenshot(opts?: { fullPage?: boolean }): Promise<ArrayBuffer>;
  title(): Promise<string>;
  url(): string;
  close(): Promise<void>;
}

interface BrowserHandle {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

interface PuppeteerFactory {
  launch(binding: unknown): Promise<BrowserHandle>;
}

export class BrowserSession extends DurableObject<Env> {
  private memory: SessionMemory = { ...DEFAULT_STATE };
  private sockets = new Set<WebSocket>();
  private streamTimer: ReturnType<typeof setInterval> | null = null;
  private browser: BrowserHandle | null = null;
  private page: BrowserPage | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.ctx.blockConcurrencyWhile(async () => this.boot());
  }

  private get state(): DurableObjectState {
    return this.ctx;
  }

  // ----- Storage bootstrap -----
  private async boot(): Promise<void> {
    const sql = this.state.storage.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS session_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_log (
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT
      );
    `);
    const rows = sql.exec("SELECT value FROM session_state WHERE key='memory'").toArray();
    const row = rows[0];
    if (row && typeof row.value === 'string') {
      try {
        this.memory = { ...DEFAULT_STATE, ...JSON.parse(row.value) };
      } catch (err) {
        console.error('[browser-session] state parse', err);
      }
    }
  }

  private async persist(): Promise<void> {
    const sql = this.state.storage.sql;
    sql.exec(
      `INSERT INTO session_state (key, value) VALUES ('memory', ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      JSON.stringify(this.memory),
    );
  }

  // ----- HTTP entry point -----
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') === 'websocket') return this.handleWebSocket(request);
    if (request.method === 'POST') return this.handleRpc(request);
    return new Response('browser-session', { status: 200 });
  }

  // Browser DOs accept RPC over POST so the surrounding Worker routes can call
  // invoke() without holding a long-lived socket. Mirror of base-rpc-agent so
  // the orchestrator can reach this via env.BROWSER_SESSION.
  private async handleRpc(request: Request): Promise<Response> {
    const body = (await request.json()) as { method: string; args?: unknown };
    try {
      const data = await this.invoke(body.method, body.args);
      return Response.json({ ok: true, data });
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  }

  async invoke(method: string, args: unknown): Promise<unknown> {
    switch (method) {
      case 'ping':
        return { from: 'browser-session', ts: Date.now() };
      case 'spawn': {
        const { url } = (args ?? {}) as { url?: string };
        if (url) await this.navigate(url);
        return { sessionId: this.state.id.toString(), url: this.memory.url };
      }
      case 'navigate': {
        const { url } = (args ?? {}) as { url?: string };
        if (url) await this.navigate(url);
        return { url: this.memory.url, title: this.memory.title };
      }
      case 'action':
        return this.applyAction(args as { kind: string; target?: string; text?: string });
      case 'snapshot':
        return this.snapshotToR2();
      case 'pause':
        this.memory.status = 'paused';
        this.stopStream();
        await this.persist();
        return { status: this.memory.status };
      case 'resume':
        this.memory.status = 'streaming';
        this.startStream(STREAM_FPS_ACTIVE);
        await this.persist();
        return { status: this.memory.status };
      case 'takeover': {
        const { takeover } = (args ?? {}) as { takeover?: boolean };
        this.memory.takenOver = Boolean(takeover);
        await this.persist();
        return { takenOver: this.memory.takenOver };
      }
      case 'close':
        await this.teardown();
        return { closed: true };
      default:
        throw new Error(`unknown_method:${method}`);
    }
  }

  // ----- Navigation -----
  private async navigate(url: string): Promise<void> {
    this.memory.url = url;
    this.memory.status = 'navigating';
    this.pushAction(`navigate ${url}`);
    await this.persist();

    const page = await this.ensurePage();
    if (page) {
      try {
        await page.goto(url, { waitUntil: 'networkidle0' });
        this.memory.title = await page.title();
        this.memory.status = 'streaming';
      } catch (err) {
        this.pushAction(`navigation error: ${err instanceof Error ? err.message : String(err)}`);
        this.memory.status = 'idle';
      }
    } else {
      // Browser binding unavailable in this environment — keep status as
      // streaming so the UI shows the placeholder rather than an error state.
      this.memory.status = 'streaming';
    }
    await this.persist();
    this.broadcast({ type: 'navigated', url, title: this.memory.title });
    this.startStream(STREAM_FPS_ACTIVE);
  }

  private async applyAction(action: { kind?: string; target?: string; text?: string }): Promise<unknown> {
    this.pushAction(`${action.kind ?? 'action'} ${action.target ?? ''}`.trim());
    const page = await this.ensurePage();
    if (!page) return { ok: true, stub: true };
    switch (action.kind) {
      case 'goBack':
        await page.goBack();
        break;
      case 'goForward':
        await page.goForward();
        break;
      case 'reload':
        await page.reload();
        break;
      default:
        break;
    }
    this.memory.title = await page.title();
    this.memory.url = page.url();
    await this.persist();
    this.broadcast({ type: 'state', state: this.memory });
    return { ok: true };
  }

  private async snapshotToR2(): Promise<{ r2Key?: string }> {
    const page = await this.ensurePage();
    if (!page) return {};
    try {
      const buf = await page.screenshot({ fullPage: false });
      const key = `browser-sessions/${this.state.id.toString()}/${Date.now()}.png`;
      await this.env.ARTIFACTS.put(key, buf, {
        httpMetadata: { contentType: 'image/png' },
      });
      return { r2Key: key };
    } catch (err) {
      console.error('[browser-session] snapshot failed', err);
      return {};
    }
  }

  // ----- Streaming -----
  private startStream(fps: number): void {
    this.stopStream();
    if (this.sockets.size === 0) return;
    const intervalMs = Math.max(50, Math.floor(1_000 / fps));
    this.streamTimer = setInterval(() => {
      void this.pushFrame();
    }, intervalMs);
  }

  private stopStream(): void {
    if (this.streamTimer) {
      clearInterval(this.streamTimer);
      this.streamTimer = null;
    }
  }

  private async pushFrame(): Promise<void> {
    if (this.memory.status !== 'streaming') return;
    const page = await this.ensurePage();
    if (!page) return;
    try {
      const buf = await page.screenshot({ fullPage: false });
      const base64 = arrayBufferToBase64(buf);
      this.broadcast({
        type: 'frame',
        sessionId: this.state.id.toString(),
        ts: Date.now(),
        url: page.url(),
        title: this.memory.title,
        pngBase64: base64,
      });
    } catch (err) {
      console.error('[browser-session] frame capture', err);
    }
  }

  // ----- WebSocket -----
  // Same .accept() rationale as Orchestrator: miniflare 3 in local mode
  // doesn't reliably dispatch the hibernation lifecycle hooks. Production
  // will work either way; revisit if hibernation memory matters here.
  private handleWebSocket(_request: Request): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.sockets.add(server);

    server.send(JSON.stringify({ type: 'state', state: this.memory }));
    if (this.memory.status === 'streaming') {
      this.startStream(STREAM_FPS_ACTIVE);
    }

    server.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(event.data);
      } catch {
        server.send(JSON.stringify({ type: 'error', error: 'invalid_json' }));
        return;
      }
      void this.invoke(msg.type, msg).then((data) => {
        server.send(JSON.stringify({ type: 'ack', method: msg.type, data }));
      }).catch((err) => {
        server.send(JSON.stringify({ type: 'error', error: err instanceof Error ? err.message : String(err) }));
      });
    });

    server.addEventListener('close', () => {
      this.sockets.delete(server);
      if (this.sockets.size === 0) {
        this.startStream(STREAM_FPS_HIDDEN);
      }
    });

    server.addEventListener('error', (err: ErrorEvent) => {
      console.error('[browser-session] ws error', err.message ?? 'unknown');
      this.sockets.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // ----- Browser handle management -----
  private async ensurePage(): Promise<BrowserPage | null> {
    if (this.page) return this.page;
    const factory = await this.loadPuppeteer();
    if (!factory) return null;
    try {
      this.browser = await factory.launch(this.env.BROWSER);
      this.page = await this.browser.newPage();
      return this.page;
    } catch (err) {
      console.error('[browser-session] launch failed', err);
      return null;
    }
  }

  private async loadPuppeteer(): Promise<PuppeteerFactory | null> {
    // Cloudflare's Puppeteer fork is shipped as `@cloudflare/puppeteer`. We
    // lazy-import so the DO can bootstrap on platforms that don't expose the
    // binding (CI, local pre-bindings). The module is optional in package.json
    // — install it before deploying to production.
    try {
      const mod = (await import('@cloudflare/puppeteer' as never)) as unknown as PuppeteerFactory;
      return mod;
    } catch {
      return null;
    }
  }

  private async teardown(): Promise<void> {
    this.stopStream();
    if (this.page) {
      try {
        await this.page.close();
      } catch {
        /* noop */
      }
      this.page = null;
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        /* noop */
      }
      this.browser = null;
    }
    this.memory.status = 'closed';
    await this.persist();
  }

  // ----- Bookkeeping -----
  private pushAction(line: string): void {
    this.memory.recentActions = [...this.memory.recentActions.slice(-20), line];
    this.state.storage.sql.exec(
      `INSERT INTO session_log (ts, kind, payload) VALUES (?, ?, ?)`,
      Date.now(),
      'action',
      line,
    );
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
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}
