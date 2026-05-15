// @openthink/memory — hybrid retrieval over Vectorize (semantic) + D1 FTS5 (keyword)
// fused with reciprocal rank fusion (RRF).
// Iteration 6 wires this to the MemoryAgent DO. Iteration 1 ships the pure-fn fusion.

export interface RankedHit<T> {
  item: T;
  score: number;     // higher is better
  source: 'vector' | 'keyword';
}

export interface FusedHit<T> {
  item: T;
  score: number;
  contributors: { vector?: number; keyword?: number };
}

// Reciprocal rank fusion. k=60 is the canonical Robertson default. Returns a sorted list.
export function rrfFuse<T>(
  vectorHits: RankedHit<T>[],
  keywordHits: RankedHit<T>[],
  selectKey: (item: T) => string,
  k = 60,
): FusedHit<T>[] {
  const table = new Map<string, FusedHit<T>>();

  const incorporate = (hits: RankedHit<T>[], source: 'vector' | 'keyword') => {
    hits.forEach((hit, rank) => {
      const key = selectKey(hit.item);
      const contribution = 1 / (k + rank + 1);
      const existing = table.get(key);
      if (existing) {
        existing.score += contribution;
        existing.contributors[source] = contribution;
      } else {
        table.set(key, {
          item: hit.item,
          score: contribution,
          contributors: { [source]: contribution },
        });
      }
    });
  };

  incorporate(vectorHits, 'vector');
  incorporate(keywordHits, 'keyword');

  return Array.from(table.values()).sort((a, b) => b.score - a.score);
}
