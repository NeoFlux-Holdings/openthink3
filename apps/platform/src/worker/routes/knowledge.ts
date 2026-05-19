import { Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../env';

export const knowledge = new Hono<{ Bindings: Env; Variables: Variables }>();

// PRD §7 — Knowledge tab. Files and URLs the agent should always have in
// context. v1.0 persists metadata in KV under `knowledge:<agentId>` and
// stores file payloads in R2 under the same key. Vectorization happens
// downstream — when MEMORIES is bound, the ingestion endpoint also enqueues
// an embed-and-upsert job onto the trajectories queue (reusing the writeback
// pipeline) so the live agent can pull semantic snippets at inference time.
//
// The shape is deliberately small: a uniform Item with `kind: 'file' | 'url'`
// keeps the UI list rendering simple while leaving room for future
// `kind: 'thread'` / `kind: 'doc'` types.

interface KnowledgeItem {
  id: string;
  kind: 'file' | 'url' | 'text';
  title: string;
  source: string;        // URL or filename
  bytes?: number;
  mime?: string;
  addedAt: number;
  pinned?: boolean;
  // User-assigned category tags. Lowercase, hyphen-or-alphanum
  // tokens, max 24 chars each. Lets the user group items beyond
  // pin/unpin: e.g. tag a batch of URLs `auth-docs` and filter the
  // list to that group. Stored alongside the manifest in KV.
  tags?: string[];
}

// Sanitize a single tag — lowercase, alphanum + hyphens only, max 24
// chars. Returns null if the input is empty after sanitization. The
// same rule runs on the client and the server so a tag round-trips
// without surprise: paste with whitespace / punctuation, get back a
// canonical slug.
function sanitizeTag(raw: string): string | null {
  const t = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return t || null;
}

function sanitizeTagList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const t = sanitizeTag(typeof raw === 'string' ? raw : String(raw));
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

function key(agentId: string): string {
  return `knowledge:${agentId}`;
}

async function readList(env: Env, agentId: string): Promise<KnowledgeItem[]> {
  const raw = await env.SETTINGS.get(key(agentId));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as KnowledgeItem[];
  } catch {
    return [];
  }
}

async function writeList(env: Env, agentId: string, items: KnowledgeItem[]): Promise<void> {
  await env.SETTINGS.put(key(agentId), JSON.stringify(items));
}

knowledge.get('/:agentId', async (c) => {
  const items = await readList(c.env, c.req.param('agentId'));
  return c.json({ items });
});

const UrlBody = z.object({
  title: z.string().min(1).max(200).optional(),
  url: z.string().url(),
  pinned: z.boolean().optional(),
});

knowledge.post('/:agentId/url', async (c) => {
  const parsed = UrlBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const items = await readList(c.env, c.req.param('agentId'));
  const item: KnowledgeItem = {
    id: crypto.randomUUID(),
    kind: 'url',
    title: parsed.data.title ?? new URL(parsed.data.url).hostname,
    source: parsed.data.url,
    addedAt: Date.now(),
    pinned: parsed.data.pinned ?? false,
  };
  items.unshift(item);
  await writeList(c.env, c.req.param('agentId'), items);
  return c.json({ ok: true, item });
});

const TextBody = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(50_000),
  pinned: z.boolean().optional(),
});

knowledge.post('/:agentId/text', async (c) => {
  const parsed = TextBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const agentId = c.req.param('agentId');
  const items = await readList(c.env, agentId);
  const r2Key = `knowledge/${agentId}/${crypto.randomUUID()}.txt`;
  await c.env.ARTIFACTS.put(r2Key, parsed.data.body, {
    httpMetadata: { contentType: 'text/plain' },
  });
  const item: KnowledgeItem = {
    id: crypto.randomUUID(),
    kind: 'text',
    title: parsed.data.title,
    source: r2Key,
    bytes: parsed.data.body.length,
    mime: 'text/plain',
    addedAt: Date.now(),
    pinned: parsed.data.pinned ?? false,
  };
  items.unshift(item);
  await writeList(c.env, agentId, items);
  return c.json({ ok: true, item });
});

// Bulk-restore knowledge items from a snapshot. Accepts the export
// shape `{items: [...]}` or a bare array. URL kinds are inserted
// directly (no live page fetch — keeps the import cheap + offline-
// capable). File / text kinds whose R2 object isn't in this bucket
// land as orphans (the R2 payload would need to be uploaded
// separately) — the manifest entry still makes it in so the user
// has the metadata. Dedup by (kind, source).
const BulkItem = z.object({
  id: z.string().optional(),
  kind: z.enum(['url', 'file', 'text']),
  title: z.string().min(1).max(200),
  source: z.string().min(1).max(2_000),
  bytes: z.number().optional(),
  mime: z.string().optional(),
  pinned: z.boolean().optional(),
  addedAt: z.number().optional(),
  tags: z.array(z.string().max(48)).max(12).optional(),
});
const BulkBody = z.union([
  z.object({ items: z.array(BulkItem).max(500) }),
  z.array(BulkItem).max(500),
]);

knowledge.post('/:agentId/bulk', async (c) => {
  const parsed = BulkBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const agentId = c.req.param('agentId');
  const items = await readList(c.env, agentId);
  const existing = new Set(items.map((it) => `${it.kind}:::${it.source}`));
  let added = 0;
  let skipped = 0;
  for (const m of Array.isArray(parsed.data) ? parsed.data : parsed.data.items) {
    const dedupKey = `${m.kind}:::${m.source}`;
    if (existing.has(dedupKey)) {
      skipped += 1;
      continue;
    }
    existing.add(dedupKey);
    const importedTags = sanitizeTagList(m.tags ?? []);
    const item: KnowledgeItem = {
      id: m.id ?? crypto.randomUUID(),
      kind: m.kind,
      title: m.title,
      source: m.source,
      bytes: m.bytes,
      mime: m.mime,
      addedAt: m.addedAt ?? Date.now(),
      pinned: m.pinned ?? false,
      ...(importedTags.length > 0 ? { tags: importedTags } : {}),
    };
    items.unshift(item);
    added += 1;
  }
  if (added > 0) await writeList(c.env, agentId, items);
  // Bulk-restore is destructive-adjacent (it changes the agent's
  // working set in a way the user can't undo with one click), so it
  // gets a `danger`-kind audit row under `__system__` for the
  // paper trail. Best-effort; a missing audit_log is fine.
  if (added > 0) {
    try {
      await c.env.DB.prepare(
        `INSERT INTO audit_log (id, agent_id, kind, payload, created_at) VALUES (?, ?, 'danger', ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          '__system__',
          JSON.stringify({
            action: 'knowledge_bulk_restore',
            agentId,
            added,
            skipped,
          }),
          Date.now(),
        )
        .run();
    } catch {
      /* audit table missing — non-fatal */
    }
  }
  return c.json({ ok: true, added, skipped });
});

knowledge.delete('/:agentId/:itemId', async (c) => {
  const agentId = c.req.param('agentId');
  const itemId = c.req.param('itemId');
  const items = await readList(c.env, agentId);
  const target = items.find((i) => i.id === itemId);
  const next = items.filter((i) => i.id !== itemId);
  // Best-effort R2 cleanup for blob-backed items.
  if (target && (target.kind === 'file' || target.kind === 'text')) {
    try {
      await c.env.ARTIFACTS.delete(target.source);
    } catch {
      // ignore — KV record is authoritative
    }
  }
  await writeList(c.env, agentId, next);
  return c.json({ ok: true, deleted: items.length - next.length });
});

// Clear every knowledge item for this agent. Returns the count cleared.
// Backed by the same R2-best-effort pattern as the single-item DELETE —
// missing blobs don't fail the call. Used by the Knowledge tab's bulk
// "Clear all" affordance.
knowledge.delete('/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const items = await readList(c.env, agentId);
  if (items.length === 0) return c.json({ ok: true, deleted: 0 });
  // Drop every blob-backed item in parallel. R2.delete is idempotent so
  // a phantom record doesn't fail the route.
  const blobKeys = items
    .filter((i) => i.kind === 'file' || i.kind === 'text')
    .map((i) => i.source)
    .filter((k): k is string => typeof k === 'string' && k.length > 0);
  await Promise.all(blobKeys.map((k) => c.env.ARTIFACTS.delete(k).catch(() => undefined)));
  await writeList(c.env, agentId, []);
  return c.json({ ok: true, deleted: items.length });
});

// Multipart file upload. Caps at 5MB to keep the worker memory comfortable
// + R2 PUT-bytes cheap. Content-Type rides through to R2 so the artifact
// viewer can render the right element on read.
knowledge.post('/:agentId/file', async (c) => {
  const agentId = c.req.param('agentId');
  const form = await c.req.formData().catch(() => null);
  if (!form) {
    return c.json({ ok: false, error: 'expected_multipart' }, 400);
  }
  const rawFile = form.get('file') as unknown;
  const title = String(form.get('title') ?? '').trim();
  const pinned = form.get('pinned') === 'true';
  // The Workers runtime exposes uploaded entries as Blob with extra `name`
  // and `type` props (the standard FormDataEntryValue → File shape). We
  // duck-type rather than `instanceof File` so the worker tsconfig (which
  // ships from miniflare-types) doesn't need the DOM lib.
  if (
    !rawFile ||
    typeof rawFile !== 'object' ||
    typeof (rawFile as { arrayBuffer?: unknown }).arrayBuffer !== 'function'
  ) {
    return c.json({ ok: false, error: 'missing_file' }, 400);
  }
  const file = rawFile as {
    name?: string;
    type?: string;
    size: number;
    arrayBuffer(): Promise<ArrayBuffer>;
  };
  if (!file.size) return c.json({ ok: false, error: 'empty_file' }, 400);
  if (file.size > 5 * 1024 * 1024) {
    return c.json({ ok: false, error: 'too_large', max: 5 * 1024 * 1024 }, 413);
  }

  const items = await readList(c.env, agentId);
  const id = crypto.randomUUID();
  const originalName = file.name ?? `upload-${id}.bin`;
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || `upload-${id}.bin`;
  const r2Key = `knowledge/${agentId}/${id}-${safeName}`;
  try {
    await c.env.ARTIFACTS.put(r2Key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
      customMetadata: { title: title || originalName, agentId },
    });
  } catch (err) {
    return c.json(
      { ok: false, error: 'r2_failed', reason: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
  const item: KnowledgeItem = {
    id,
    kind: 'file',
    title: title || originalName,
    source: r2Key,
    bytes: file.size,
    mime: file.type || 'application/octet-stream',
    addedAt: Date.now(),
    pinned,
  };
  items.unshift(item);
  await writeList(c.env, agentId, items);
  return c.json({ ok: true, item });
});

// Reorder the knowledge list — accepts a `{ ids: string[] }` body and
// writes a new list in that order. Items not in the supplied id list
// keep their relative order at the end (defensive against a stale
// client snapshot). Idempotent: missing ids are silently dropped.
const ReorderBody = z.object({ ids: z.array(z.string()).max(60) });

knowledge.put('/:agentId/order', async (c) => {
  const parsed = ReorderBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const agentId = c.req.param('agentId');
  const items = await readList(c.env, agentId);
  const byId = new Map(items.map((i) => [i.id, i] as const));
  const next: KnowledgeItem[] = [];
  for (const id of parsed.data.ids) {
    const it = byId.get(id);
    if (it) {
      next.push(it);
      byId.delete(id);
    }
  }
  // Any items the client didn't enumerate (e.g. one was added between
  // their fetch and this PUT) get appended in original order.
  for (const remaining of byId.values()) next.push(remaining);
  await writeList(c.env, agentId, next);
  return c.json({ ok: true, count: next.length });
});

// Refresh every URL knowledge item in one shot — pulls each live URL's
// title in parallel (capped at 6 concurrent so we don't slam the user's
// bandwidth or trigger upstream rate limits). Each fetch uses the same
// 6s AbortSignal timeout as the per-item refresh. Returns
// `{ refreshed, skipped, failed }` so the client can summarize.
knowledge.post('/:agentId/refresh-urls', async (c) => {
  const agentId = c.req.param('agentId');
  const items = await readList(c.env, agentId);
  const urlItems = items.filter((i) => i.kind === 'url');
  if (urlItems.length === 0) {
    return c.json({ ok: true, refreshed: 0, skipped: 0, failed: 0 });
  }
  let refreshed = 0;
  let failed = 0;
  // Per-id outcomes — lets the client pinpoint which URLs failed so
  // it can mark them in its failure tracker. Each entry rides through
  // the response array regardless of bulk success so a client that
  // wants to do partial bookkeeping can.
  const outcomes: Array<{ id: string; ok: boolean; reason?: string }> = [];
  // Run in cohorts of 6 to keep concurrency reasonable.
  const cohort = 6;
  for (let i = 0; i < urlItems.length; i += cohort) {
    const batch = urlItems.slice(i, i + cohort);
    const results = await Promise.all(
      batch.map(async (target) => {
        try {
          const res = await fetch(target.source, {
            signal: AbortSignal.timeout(6_000),
            redirect: 'follow',
            headers: {
              'User-Agent': 'OpenThink/1.0 (+knowledge-refresh-all)',
              Accept: 'text/html,application/xhtml+xml',
            },
          });
          if (!res.ok) {
            return {
              id: target.id,
              title: null as string | null,
              reason: `http_${res.status}`,
            };
          }
          const reader = res.body?.getReader();
          let html = '';
          if (reader) {
            const decoder = new TextDecoder();
            while (html.length < 32_768) {
              const { done, value } = await reader.read();
              if (done) break;
              html += decoder.decode(value, { stream: true });
              if (/<\/title>/i.test(html)) break;
            }
            await reader.cancel().catch(() => undefined);
          }
          const og = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
          const tit = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          const extracted = og?.[1] ?? tit?.[1] ?? '';
          const trimmed = extracted.trim().replace(/\s+/g, ' ').slice(0, 200);
          return {
            id: target.id,
            title: trimmed || null,
            reason: trimmed ? undefined : 'no_title',
          };
        } catch (err) {
          return {
            id: target.id,
            title: null as string | null,
            reason: err instanceof Error && err.name === 'TimeoutError'
              ? 'timeout'
              : 'fetch_failed',
          };
        }
      }),
    );
    // Fold the batch results back into the items array before persisting
    // — if a later batch fails we still want earlier wins committed.
    for (const r of results) {
      const idx = items.findIndex((it) => it.id === r.id);
      if (idx < 0) continue;
      if (r.title) {
        items[idx] = { ...items[idx]!, title: r.title, addedAt: Date.now() };
        refreshed += 1;
        outcomes.push({ id: r.id, ok: true });
      } else {
        failed += 1;
        outcomes.push({ id: r.id, ok: false, reason: r.reason });
      }
    }
    await writeList(c.env, agentId, items);
  }
  return c.json({
    ok: true,
    refreshed,
    failed,
    outcomes,
    skipped: items.filter((i) => i.kind !== 'url').length,
  });
});

// Re-fetch a URL knowledge item's title from the live page so a renamed
// or moved page reflects in the sidebar. Pulls a small HTML head, extracts
// the `<title>` tag (or `og:title` if present). Updates the item's title
// + bumps `addedAt` to now. Non-URL items return 400 — there's nothing
// to refresh for text/file kinds.
knowledge.post('/:agentId/:itemId/refresh', async (c) => {
  const agentId = c.req.param('agentId');
  const itemId = c.req.param('itemId');
  const items = await readList(c.env, agentId);
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx < 0) return c.json({ ok: false, error: 'not_found' }, 404);
  const target = items[idx]!;
  if (target.kind !== 'url') {
    return c.json({ ok: false, error: 'not_a_url' }, 400);
  }
  // Pull just enough HTML to find <title>. 32KB is plenty for any page's
  // head. AbortSignal.timeout caps the fetch at 6s so a slow upstream
  // doesn't hang the worker.
  let nextTitle = target.title;
  try {
    const res = await fetch(target.source, {
      signal: AbortSignal.timeout(6_000),
      redirect: 'follow',
      headers: {
        'User-Agent': 'OpenThink/1.0 (+knowledge-refresh)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (res.ok) {
      const reader = res.body?.getReader();
      let html = '';
      if (reader) {
        const decoder = new TextDecoder();
        while (html.length < 32_768) {
          const { done, value } = await reader.read();
          if (done) break;
          html += decoder.decode(value, { stream: true });
          if (/<\/title>/i.test(html)) break;
        }
        await reader.cancel().catch(() => undefined);
      }
      // Prefer og:title (cleaner on most modern pages), fall back to
      // the standard <title>. Strip whitespace + clamp to 200 chars.
      const og = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
      const tit = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const extracted = og?.[1] ?? tit?.[1] ?? '';
      const trimmed = extracted.trim().replace(/\s+/g, ' ').slice(0, 200);
      if (trimmed) nextTitle = trimmed;
    }
  } catch {
    /* keep prior title — surface as ok:false so the UI can hint */
    return c.json({ ok: false, error: 'fetch_failed', title: target.title });
  }
  items[idx] = { ...target, title: nextTitle, addedAt: Date.now() };
  await writeList(c.env, agentId, items);
  return c.json({ ok: true, title: nextTitle });
});

knowledge.post('/:agentId/:itemId/pin', async (c) => {
  const agentId = c.req.param('agentId');
  const itemId = c.req.param('itemId');
  const items = await readList(c.env, agentId);
  const next = items.map((i) => (i.id === itemId ? { ...i, pinned: !i.pinned } : i));
  await writeList(c.env, agentId, next);
  const target = next.find((i) => i.id === itemId);
  return c.json({ ok: true, item: target });
});

// PUT /:agentId/:itemId/tags — full replace of an item's tag list.
// Accepts `{ tags: string[] }`; runs each through `sanitizeTag` so the
// canonical form survives a paste with spaces or punctuation. Returns
// the persisted item so the client can reconcile its optimistic view.
const TagsBody = z.object({
  tags: z.array(z.string().max(48)).max(12),
});

knowledge.put('/:agentId/:itemId/tags', async (c) => {
  const parsed = TagsBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const agentId = c.req.param('agentId');
  const itemId = c.req.param('itemId');
  const items = await readList(c.env, agentId);
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx < 0) return c.json({ ok: false, error: 'not_found' }, 404);
  const cleaned = sanitizeTagList(parsed.data.tags);
  const target = items[idx]!;
  // Drop the `tags` field entirely when the list is empty so we don't
  // leave a useless `[]` on every untagged item.
  const next: KnowledgeItem = cleaned.length > 0
    ? { ...target, tags: cleaned }
    : (() => {
        const { tags: _tags, ...rest } = target;
        return rest as KnowledgeItem;
      })();
  items[idx] = next;
  await writeList(c.env, agentId, items);
  return c.json({ ok: true, item: next });
});
