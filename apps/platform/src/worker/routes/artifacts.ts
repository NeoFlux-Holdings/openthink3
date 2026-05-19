import { Hono } from 'hono';

import type { Env, Variables } from '../env';

export const artifacts = new Hono<{ Bindings: Env; Variables: Variables }>();

// PRD §5 — the Library surface needs a list endpoint, not just per-id GETs.
// Two listings shipped:
//   GET /api/artifacts/list           every artifact for the platform
//   GET /api/artifacts/list/<agent>   filtered to `artifacts/<agent>/…`
//
// We use R2's prefix listing for both; metadata (title, version, type) is
// embedded in the object's `customMetadata` so a future migration can move
// the durable record to D1 without changing the client contract.

interface ArtifactRow {
  id: string;
  key: string;
  type: string;
  title: string;
  version: number;
  size: number;
  uploadedAt: number;
  starred?: boolean;
  /** Optional user-curated tags. JSON-encoded in `artifact-tags:<key>` KV. */
  tags?: string[];
}

function inferType(key: string, contentType: string | undefined): string {
  const lower = (contentType ?? '').toLowerCase();
  if (lower.startsWith('image/')) return 'image';
  if (lower.includes('json')) return 'code';
  if (lower.startsWith('text/')) return 'document';
  // Filename heuristics as a fallback.
  if (/\.md$/i.test(key)) return 'document';
  if (/\.(ts|tsx|js|jsx|py|go|c|cpp|rs|sql)$/i.test(key)) return 'code';
  if (/\.(png|jpe?g|gif|svg|webp)$/i.test(key)) return 'image';
  if (/\.(csv|tsv|xlsx?)$/i.test(key)) return 'table';
  if (/\.(html?|webpage)$/i.test(key)) return 'webpage';
  if (/\.(pptx?|slides?)$/i.test(key)) return 'slides';
  return 'document';
}

function titleFromKey(key: string): string {
  const last = key.split('/').pop() ?? key;
  return last.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
}

artifacts.get('/list', async (c) => listArtifacts(c, ''));
artifacts.get('/list/:agentId', async (c) => listArtifacts(c, c.req.param('agentId')));

async function listArtifacts(
  c: import('hono').Context<{ Bindings: Env; Variables: Variables }>,
  agentId: string,
): Promise<Response> {
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50')));
  const prefix = agentId ? `artifacts/${agentId}/` : 'artifacts/';
  try {
    const list = await c.env.ARTIFACTS.list({ prefix, limit });
    // Pull rename overrides + star flags + tag lists from KV in
    // parallel. Each key lives at `artifact-title:<r2 key>` /
    // `artifact-star:<r2 key>` / `artifact-tags:<r2 key>`. Falls
    // back to R2 customMetadata.title when no override exists.
    const [overrides, stars, tagsRaw] = await Promise.all([
      Promise.all(list.objects.map((o) => c.env.SETTINGS.get(`artifact-title:${o.key}`))),
      Promise.all(list.objects.map((o) => c.env.SETTINGS.get(`artifact-star:${o.key}`))),
      Promise.all(list.objects.map((o) => c.env.SETTINGS.get(`artifact-tags:${o.key}`))),
    ]);
    const rows: ArtifactRow[] = list.objects
      // Skip directory-marker objects (zero bytes, no `/` suffix needed).
      .filter((o) => o.size > 0)
      .map((o, i): ArtifactRow => {
        let tags: string[] | undefined;
        if (tagsRaw[i]) {
          try {
            const parsed = JSON.parse(tagsRaw[i]!);
            if (Array.isArray(parsed)) {
              const cleaned = sanitizeArtifactTagList(parsed);
              if (cleaned.length > 0) tags = cleaned;
            }
          } catch {
            /* corrupt cell — leave tags undefined */
          }
        }
        return {
          id: o.key,
          key: o.key,
          type: inferType(o.key, o.httpMetadata?.contentType),
          title:
            overrides[i] ??
            (o.customMetadata?.title as string | undefined) ??
            titleFromKey(o.key),
          version: Number(o.customMetadata?.version ?? 1),
          size: o.size,
          uploadedAt: o.uploaded.getTime(),
          starred: stars[i] === '1',
          ...(tags ? { tags } : {}),
        };
      })
      // Starred first, then newest. Stable within each group.
      .sort((a, b) => {
        if (!!a.starred !== !!b.starred) return a.starred ? -1 : 1;
        return b.uploadedAt - a.uploadedAt;
      });

    if (rows.length > 0) {
      return c.json({ artifacts: rows, source: 'r2' });
    }
  } catch (err) {
    console.warn('[artifacts] list failed', err);
  }

  // Fallback when R2 has nothing yet — the Library still wants something
  // to render so the empty-state doesn't feel broken.
  return c.json({ artifacts: stubArtifacts(agentId), source: 'stub' });
}

function stubArtifacts(agentId: string): ArtifactRow[] {
  const now = Date.now();
  const owner = agentId || 'agent';
  return [
    { id: 'stub-1', key: `artifacts/${owner}/weekly-digest.md`, type: 'document', title: 'Weekly digest — research focus', version: 1, size: 2_400, uploadedAt: now - 60 * 60_000 },
    { id: 'stub-2', key: `artifacts/${owner}/orchestrator.ts`, type: 'code', title: 'orchestrator.ts', version: 3, size: 12_000, uploadedAt: now - 4 * 60 * 60_000 },
    { id: 'stub-3', key: `artifacts/${owner}/spend.csv`, type: 'table', title: 'Spend so far today', version: 1, size: 900, uploadedAt: now - 90 * 60_000 },
    { id: 'stub-4', key: `artifacts/${owner}/openthink-one-pager.html`, type: 'webpage', title: 'OpenThink one-pager', version: 2, size: 8_400, uploadedAt: now - 3 * 24 * 60 * 60_000 },
  ];
}

artifacts.get('/:id', async (c) => {
  // Honor HTTP Range requests so callers (e.g. the Library hover-
  // preview snippet fetch) can pull just the first few KB of a
  // potentially-large artifact without paying for the full body.
  // We only accept the common `bytes=0-N` shape; multi-range
  // suffixes and tail-from-end (`bytes=-N`) fall through to a full
  // body so we don't have to implement every edge of RFC 7233.
  const id = c.req.param('id');
  const rangeHeader = c.req.header('range');
  let rangeOpt: { offset: number; length?: number } | undefined;
  let parsedRange: { start: number; end: number } | undefined;
  if (rangeHeader && /^bytes=\d+-\d*$/.test(rangeHeader)) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (m) {
      const start = Number.parseInt(m[1]!, 10);
      const endStr = m[2]!;
      const end = endStr ? Number.parseInt(endStr, 10) : -1;
      if (Number.isFinite(start) && start >= 0) {
        rangeOpt =
          end >= start
            ? { offset: start, length: end - start + 1 }
            : { offset: start };
        parsedRange = { start, end };
      }
    }
  }
  const obj = rangeOpt
    ? await c.env.ARTIFACTS.get(id, { range: rangeOpt })
    : await c.env.ARTIFACTS.get(id);
  if (!obj) return c.notFound();
  const headers: Record<string, string> = {
    'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
    'Cache-Control': 'private, max-age=3600',
    'Accept-Ranges': 'bytes',
  };
  // R2 returns the full object's size on `obj.size` even when we
  // requested a range; use that for the Content-Range header.
  if (rangeOpt && parsedRange) {
    const total = obj.size;
    const realEnd =
      parsedRange.end >= 0 ? parsedRange.end : total - 1;
    headers['Content-Range'] = `bytes ${parsedRange.start}-${realEnd}/${total}`;
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(obj.body, { headers });
});

artifacts.put('/:id', async (c) => {
  const body = await c.req.arrayBuffer();
  await c.env.ARTIFACTS.put(c.req.param('id'), body, {
    httpMetadata: { contentType: c.req.header('Content-Type') ?? 'application/octet-stream' },
    customMetadata: {
      title: c.req.header('X-Artifact-Title') ?? '',
      version: c.req.header('X-Artifact-Version') ?? '1',
    },
  });
  return c.json({ ok: true });
});

// Delete a single artifact by R2 key. Idempotent — R2.delete on a missing
// key resolves successfully, so the route returns ok regardless. Used by
// the Library's bulk-select-and-delete flow. Also clears any rename
// override / star flag so a future upload to the same key starts clean.
artifacts.delete('/:id', async (c) => {
  await Promise.all([
    c.env.ARTIFACTS.delete(c.req.param('id')),
    c.env.SETTINGS.delete(`artifact-title:${c.req.param('id')}`),
    c.env.SETTINGS.delete(`artifact-star:${c.req.param('id')}`),
    c.env.SETTINGS.delete(`artifact-tags:${c.req.param('id')}`),
  ]);
  return c.json({ ok: true });
});

// Rename an artifact. R2 doesn't expose a metadata-only patch, and a
// full body re-upload to update one string is wasteful — so we write
// the new title into KV under `artifact-title:<key>` and the list
// endpoint reads it as an override. The override survives until the
// artifact is deleted or someone explicitly clears it.
artifacts.patch('/:id', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { title?: unknown };
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 200) {
    return c.json({ ok: false, error: 'invalid_title' }, 400);
  }
  await c.env.SETTINGS.put(
    `artifact-title:${c.req.param('id')}`,
    title,
    // No TTL — these live as long as the artifact does. Delete clears it.
  );
  return c.json({ ok: true, title });
});

// Sanitize tag strings same way knowledge tags + memory tags do —
// lowercase, alphanum + hyphens, max 24 chars per tag. Returns null
// for empty/invalid input so callers can filter them out.
function sanitizeArtifactTag(raw: string): string | null {
  const t = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return t || null;
}

function sanitizeArtifactTagList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const t = sanitizeArtifactTag(typeof raw === 'string' ? raw : String(raw));
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

// PUT /api/artifacts/:id/tags — full-replace tag list for one artifact.
// Stored under `artifact-tags:<r2-key>` as a JSON array; an empty list
// clears the KV entry so the response stays small. Mirrors the
// knowledge + memory tag sanitizer rules so a tag round-trips
// identically across surfaces.
artifacts.put('/:id/tags', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { tags?: unknown };
  const cleaned = sanitizeArtifactTagList(body.tags);
  const key = `artifact-tags:${c.req.param('id')}`;
  if (cleaned.length === 0) {
    await c.env.SETTINGS.delete(key);
  } else {
    await c.env.SETTINGS.put(key, JSON.stringify(cleaned));
  }
  return c.json({ ok: true, tags: cleaned });
});

// Star / unstar an artifact. Starred artifacts float to the top of the
// Library grid and can be filtered with the "Starred" chip. Kept in KV
// under `artifact-star:<key>` = "1"; `delete` clears the flag. Cleared
// automatically when the artifact is deleted (same pattern as the
// rename override).
artifacts.post('/:id/star', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { starred?: unknown };
  const starred = body.starred === true;
  const key = `artifact-star:${c.req.param('id')}`;
  if (starred) {
    await c.env.SETTINGS.put(key, '1');
  } else {
    await c.env.SETTINGS.delete(key);
  }
  return c.json({ ok: true, starred });
});

// Bulk delete — accepts a JSON body `{ keys: string[] }` and fans out to
// `R2.delete()` in parallel. The list-bound `Promise.all` is safe to bound
// because the Library UI caps the bulk select to whatever's visible (at most
// the 9 filter chips' worth of tiles in the grid). Returns the count.
artifacts.post('/delete', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { keys?: unknown };
  const keys = Array.isArray(body.keys)
    ? body.keys.filter((k): k is string => typeof k === 'string' && k.length > 0)
    : [];
  if (keys.length === 0) {
    return c.json({ ok: false, error: 'no_keys', deleted: 0 }, 400);
  }
  await Promise.all(keys.map((k) => c.env.ARTIFACTS.delete(k)));
  return c.json({ ok: true, deleted: keys.length });
});
