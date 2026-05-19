// MemoryAgent — persistent knowledge about the user, the work, and the world.
// Storage path:
//   - D1 `memories` for the row-of-truth + FTS5 index (`memories_fts`)
//   - Vectorize for semantic recall, when MEMORIES binding is bound
//
// The orchestrator (and other DOs) talk to this through DO RPC:
//   - ingest({category, content, whenToUse?, importance?})
//   - search({query, limit?, category?}) → ranked memories with snippets
//   - list({category?, limit?})           → recent memories, no scoring
//   - remove({id})                        → soft-delete (sets importance=0)
//
// If MEMORIES is bound we additionally embed every ingest + run a vector
// query alongside the FTS one and merge results (RRF). When it's not bound
// we degrade gracefully to FTS-only retrieval. The behavior is identical
// from the caller's perspective.

import { BaseRpcAgent } from './base-rpc-agent';

interface MemoryRow {
  id: string;
  category: string;
  content: string;
  importance: number;
  whenToUse?: string;
  createdAt: number;
  updatedAt: number;
  score?: number;
}

const VALID_CATEGORIES = new Set([
  'user_facts',
  'active_work',
  'preferences',
  'domain_knowledge',
  'people',
]);

export class MemoryAgent extends BaseRpcAgent {
  async invoke(method: string, args: unknown): Promise<unknown> {
    switch (method) {
      case 'ping':
        return { from: 'memory-agent', ts: Date.now() };
      case 'ingest':
      case 'remember': // legacy alias
        return this.ingest(args as Partial<MemoryRow>);
      case 'search':
      case 'recall':   // legacy alias
        return this.search(args as { query?: string; limit?: number; category?: string });
      case 'list':
        return this.list(args as { category?: string; limit?: number });
      case 'remove':
        return this.remove(args as { id?: string });
      default:
        throw new Error(`unknown_method:${method}`);
    }
  }

  private async ingest(args: Partial<MemoryRow>): Promise<unknown> {
    const content = (args.content ?? '').trim();
    if (!content) return { ok: false, error: 'missing_content' };
    const category = args.category ?? 'domain_knowledge';
    if (!VALID_CATEGORIES.has(category)) return { ok: false, error: 'invalid_category' };

    const id = crypto.randomUUID();
    const now = Date.now();
    const importance = Math.min(10, Math.max(1, args.importance ?? 5));
    const whenToUse = args.whenToUse ?? '';

    let vectorizeId: string | null = null;
    if (this.env.MEMORIES) {
      try {
        const emb = (await this.env.AI.run('@cf/baai/bge-base-en-v1.5', {
          text: [content + (whenToUse ? ' :: ' + whenToUse : '')],
        })) as { data?: number[][] };
        const vector = emb.data?.[0];
        if (Array.isArray(vector)) {
          await this.env.MEMORIES.upsert([
            {
              id,
              values: vector,
              metadata: { category, importance },
            },
          ]);
          vectorizeId = id;
        }
      } catch (err) {
        console.warn('[memory-agent] embed/upsert failed', err);
      }
    }

    try {
      await this.env.DB.prepare(
        `INSERT INTO memories (id, category, content, importance, when_to_use, vectorize_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, category, content, importance, whenToUse, vectorizeId, now, now)
        .run();
      // Keep the FTS5 mirror in sync. Since the virtual table is configured
      // with `content='memories'`, we populate by rowid lookup.
      await this.env.DB.prepare(
        `INSERT INTO memories_fts (rowid, content, when_to_use)
         SELECT rowid, content, when_to_use FROM memories WHERE id = ?`,
      )
        .bind(id)
        .run();
    } catch (err) {
      console.error('[memory-agent] d1 ingest failed', err);
      return { ok: false, error: 'd1_failed', reason: errMsg(err) };
    }

    return { ok: true, id, vectorized: !!vectorizeId };
  }

  private async search(
    args: { query?: string; limit?: number; category?: string } = {},
  ): Promise<unknown> {
    const query = (args.query ?? '').trim();
    const limit = Math.min(20, Math.max(1, args.limit ?? 5));
    const category =
      args.category && VALID_CATEGORIES.has(args.category) ? args.category : null;
    if (!query) return { hits: [], source: 'noop' };

    let ftsHits: MemoryRow[] = [];
    try {
      const sql = category
        ? `SELECT m.id, m.category, m.content, m.importance, m.when_to_use, m.created_at, m.updated_at,
                  bm25(memories_fts) AS rank_score
           FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
           WHERE memories_fts MATCH ? AND m.category = ?
           ORDER BY rank_score LIMIT ?`
        : `SELECT m.id, m.category, m.content, m.importance, m.when_to_use, m.created_at, m.updated_at,
                  bm25(memories_fts) AS rank_score
           FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
           WHERE memories_fts MATCH ?
           ORDER BY rank_score LIMIT ?`;
      const stmt = this.env.DB.prepare(sql);
      const rows = category
        ? await stmt.bind(query, category, limit).all<FtsRow>()
        : await stmt.bind(query, limit).all<FtsRow>();
      ftsHits = (rows.results ?? []).map((r) => ({
        id: r.id,
        category: r.category,
        content: r.content,
        importance: r.importance,
        whenToUse: r.when_to_use ?? undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        // bm25 is lower-is-better; flip for merge.
        score: 1 / (1 + r.rank_score),
      }));
    } catch (err) {
      console.warn('[memory-agent] FTS5 search failed (table missing?)', err);
    }

    let vecHits: MemoryRow[] = [];
    if (this.env.MEMORIES) {
      try {
        const emb = (await this.env.AI.run('@cf/baai/bge-base-en-v1.5', {
          text: [query],
        })) as { data?: number[][] };
        const vector = emb.data?.[0];
        if (Array.isArray(vector)) {
          const result = (await this.env.MEMORIES.query(vector, {
            topK: limit,
            filter: category ? { category } : undefined,
            returnMetadata: 'all',
          })) as { matches?: Array<{ id: string; score: number }> };
          const ids = (result.matches ?? []).map((m) => m.id);
          if (ids.length > 0) {
            const placeholders = ids.map(() => '?').join(',');
            const rows = await this.env.DB.prepare(
              `SELECT id, category, content, importance, when_to_use, created_at, updated_at
               FROM memories WHERE id IN (${placeholders})`,
            )
              .bind(...ids)
              .all<{
                id: string;
                category: string;
                content: string;
                importance: number;
                when_to_use: string | null;
                created_at: number;
                updated_at: number;
              }>();
            const byId = new Map((rows.results ?? []).map((r) => [r.id, r]));
            vecHits = (result.matches ?? [])
              .filter((m) => byId.has(m.id))
              .map((m) => {
                const r = byId.get(m.id)!;
                return {
                  id: r.id,
                  category: r.category,
                  content: r.content,
                  importance: r.importance,
                  whenToUse: r.when_to_use ?? undefined,
                  createdAt: r.created_at,
                  updatedAt: r.updated_at,
                  score: m.score,
                };
              });
          }
        }
      } catch (err) {
        console.warn('[memory-agent] vectorize query failed', err);
      }
    }

    const merged = rrfMerge(ftsHits, vecHits, limit);
    return { hits: merged, source: vecHits.length > 0 ? 'hybrid' : 'fts5' };
  }

  private async list(args: { category?: string; limit?: number } = {}): Promise<unknown> {
    const limit = Math.min(50, Math.max(1, args.limit ?? 20));
    const category =
      args.category && VALID_CATEGORIES.has(args.category) ? args.category : null;
    try {
      const stmt = this.env.DB.prepare(
        category
          ? `SELECT id, category, content, importance, when_to_use, created_at, updated_at
             FROM memories WHERE category = ? AND importance > 0
             ORDER BY updated_at DESC LIMIT ?`
          : `SELECT id, category, content, importance, when_to_use, created_at, updated_at
             FROM memories WHERE importance > 0
             ORDER BY updated_at DESC LIMIT ?`,
      );
      const rows = category
        ? await stmt.bind(category, limit).all<MemoryDbRow>()
        : await stmt.bind(limit).all<MemoryDbRow>();
      return {
        memories: (rows.results ?? []).map((r): MemoryRow => ({
          id: r.id,
          category: r.category,
          content: r.content,
          importance: r.importance,
          whenToUse: r.when_to_use ?? undefined,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      };
    } catch (err) {
      console.warn('[memory-agent] list failed', err);
      return { memories: [] };
    }
  }

  private async remove({ id }: { id?: string } = {}): Promise<unknown> {
    if (!id) return { ok: false, error: 'missing_id' };
    try {
      await this.env.DB.prepare(
        `UPDATE memories SET importance = 0, updated_at = ? WHERE id = ?`,
      )
        .bind(Date.now(), id)
        .run();
      if (this.env.MEMORIES) {
        try {
          await this.env.MEMORIES.deleteByIds([id]);
        } catch {
          /* tolerate */
        }
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'd1_failed', reason: errMsg(err) };
    }
  }
}

interface FtsRow {
  id: string;
  category: string;
  content: string;
  importance: number;
  when_to_use: string | null;
  created_at: number;
  updated_at: number;
  rank_score: number;
}

interface MemoryDbRow {
  id: string;
  category: string;
  content: string;
  importance: number;
  when_to_use: string | null;
  created_at: number;
  updated_at: number;
}

function rrfMerge(a: MemoryRow[], b: MemoryRow[], limit: number, k = 60): MemoryRow[] {
  const scores = new Map<string, { row: MemoryRow; score: number }>();
  for (const [rank, row] of a.entries()) {
    scores.set(row.id, { row, score: 1 / (k + rank + 1) });
  }
  for (const [rank, row] of b.entries()) {
    const existing = scores.get(row.id);
    if (existing) existing.score += 1 / (k + rank + 1);
    else scores.set(row.id, { row, score: 1 / (k + rank + 1) });
  }
  return [...scores.values()]
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map(({ row, score }) => ({ ...row, score }));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
