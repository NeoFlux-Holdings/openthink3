// Researcher specialist DO. Two real methods + the legacy stub:
//
//   - fetch_url   pull a URL and return its text + a one-shot summary
//   - research    open-ended query: try to extract a URL, fall back to
//                 a pure Workers AI summary based on the agent's knowledge
//   - ping        the original liveness probe — kept so the orchestrator's
//                 RPC contract stays stable.
//
// Production extension points: swap fetch() for the Browser Rendering API
// (so JS-rendered pages work), and wire Vectorize semantic search across
// the agent's pinned Knowledge items before falling back to ad-hoc fetches.

import { BaseRpcAgent } from './base-rpc-agent';
import { generate as aiGenerate, inferenceFor } from '../lib/inference';

const MAX_BODY_BYTES = 256 * 1024; // 256 KB — keep prompts cheap
const FETCH_TIMEOUT_MS = 8_000;

export class Researcher extends BaseRpcAgent {
  async invoke(method: string, args: unknown): Promise<unknown> {
    switch (method) {
      case 'ping':
        return { from: 'researcher', ts: Date.now() };
      case 'fetch_url':
        return this.fetchUrl((args ?? {}) as { url?: string; question?: string });
      case 'research':
        return this.research((args ?? {}) as { query?: string });
      default:
        throw new Error(`unknown_method:${method}`);
    }
  }

  private async fetchUrl({ url, question }: { url?: string; question?: string }): Promise<unknown> {
    if (!url) return { ok: false, error: 'missing_url' };
    const safe = sanitizeUrl(url);
    if (!safe) return { ok: false, error: 'unsafe_url' };

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let body: string;
    let contentType = '';
    try {
      const res = await fetch(safe, {
        headers: { 'User-Agent': 'OpenThink/1.0 (+https://openthink.run)' },
        signal: controller.signal,
        redirect: 'follow',
      });
      contentType = res.headers.get('content-type') ?? '';
      if (!res.ok) return { ok: false, error: 'http_error', status: res.status };
      const buf = await res.arrayBuffer();
      body = new TextDecoder('utf-8').decode(
        buf.byteLength > MAX_BODY_BYTES ? buf.slice(0, MAX_BODY_BYTES) : buf,
      );
    } catch (err) {
      return {
        ok: false,
        error: 'fetch_failed',
        reason: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(t);
    }

    const text = contentType.includes('text/html') ? stripHtml(body) : body;
    const trimmed = text.slice(0, 12_000);

    // One-shot summary. We keep the prompt strict so the model doesn't
    // hallucinate beyond the page — every claim must trace back to text.
    let summary = '';
    try {
      const result = await aiGenerate(inferenceFor(this.env), {
        costClass: 'cheap',
        messages: [
          {
            role: 'system',
            content:
              'You are a meticulous research assistant. Summarize the page strictly using its text. ' +
              'If the page doesn\'t answer the question, say "the page does not answer that". ' +
              'Reply in 3-6 sentences max. Cite section headings inline like (section: "X").',
          },
          {
            role: 'user',
            content:
              `URL: ${safe}\n` +
              (question ? `Question: ${question}\n` : '') +
              `\nPAGE TEXT:\n${trimmed}`,
          },
        ],
      });
      summary = result.text.trim();
    } catch (err) {
      summary = `(summary unavailable — ${err instanceof Error ? err.message : String(err)})`;
    }

    return {
      ok: true,
      url: safe,
      bytes: trimmed.length,
      contentType,
      summary,
    };
  }

  private async research({ query }: { query?: string }): Promise<unknown> {
    if (!query) return { ok: false, error: 'missing_query' };

    // If the query contains a URL, just dispatch to fetch_url. We use a
    // permissive URL regex — Workers AI will scrub anything weird.
    const m = query.match(/https?:\/\/[^\s)]+/i);
    if (m) {
      return this.fetchUrl({ url: m[0], question: query });
    }

    // Pure Q&A path — no live web fetch yet (Browser Rendering binding is
    // commented out for local dev). Use Workers AI as the sole knowledge
    // source so the chat surface always gets *something* back.
    try {
      const result = await aiGenerate(inferenceFor(this.env), {
        costClass: 'cheap',
        messages: [
          {
            role: 'system',
            content:
              'You are a careful researcher. Answer the question concisely. If you don\'t know, say so plainly. ' +
              'Do not invent sources. End your answer with "next, I could:" listing 2-3 concrete URLs to fetch ' +
              'if the user wanted to deepen the research.',
          },
          { role: 'user', content: query },
        ],
      });
      return {
        ok: true,
        query,
        summary: result.text.trim(),
        sources: [],
      };
    } catch (err) {
      return {
        ok: false,
        error: 'ai_failed',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// URL sanitizer — block private network ranges and unsupported schemes.
// Strict-by-default keeps the worker from being weaponized as an SSRF
// gateway against the user's own CF account internals.
function sanitizeUrl(input: string): string | null {
  try {
    const u = new URL(input);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return null;
    if (host.endsWith('.internal') || host.endsWith('.local')) return null;
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
      return null;
    }
    if (/^fe80::/i.test(host) || host === '::1') return null;
    return u.toString();
  } catch {
    return null;
  }
}

// Cheap-and-cheerful HTML→text. Good enough for the Llama prompt; if we want
// fidelity we'll swap in cheerio inside the BrowserSession DO later.
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
