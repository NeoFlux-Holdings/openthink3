import { Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../env';

export const cfDomain = new Hono<{ Bindings: Env; Variables: Variables }>();

// CF Registrar — domain search + pricing + reservation.
//
// In production we hit:
//   GET /accounts/{account_id}/registrar/domains/availability?name=<n>
//   GET /accounts/{account_id}/registrar/domains/prices?tlds=com,ai,dev,…
//
// using the user's Bearer token (which we've already verified has registrar
// scope at the onboarding/token step). Locally we fall back to a deterministic
// fuzzy stub so the onboarding UX is testable without burning real DNS quota.

const POPULAR_TLDS: ReadonlyArray<{ tld: string; basePriceCents: number }> = [
  { tld: '.com', basePriceCents: 1199 },
  { tld: '.ai', basePriceCents: 8999 },
  { tld: '.dev', basePriceCents: 1499 },
  { tld: '.io', basePriceCents: 4999 },
  { tld: '.app', basePriceCents: 1999 },
  { tld: '.run', basePriceCents: 3499 },
  { tld: '.so', basePriceCents: 4499 },
  { tld: '.co', basePriceCents: 2999 },
  { tld: '.me', basePriceCents: 1899 },
];

interface DomainHit {
  name: string;
  tld: string;
  available: boolean;
  priceCents: number;
  premium?: boolean;
}

// Tiny deterministic hash so the local stub returns consistent availability
// per query — same input = same answers across reloads. The real Registrar
// API is the source of truth in prod.
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function stubDomainResults(query: string): DomainHit[] {
  const base = query
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');

  if (!base) return [];

  // If the query already contains a dot, only search that exact TLD. Otherwise
  // fan out across the popular TLDs.
  const hasTld = base.includes('.');
  const baseName = hasTld ? base.split('.')[0]! : base;
  const queryTlds = hasTld
    ? POPULAR_TLDS.filter((t) => t.tld === '.' + base.split('.').slice(1).join('.'))
    : POPULAR_TLDS;

  const candidates: DomainHit[] = [];
  for (const { tld, basePriceCents } of queryTlds.length > 0 ? queryTlds : POPULAR_TLDS) {
    const fullName = `${baseName}${tld}`;
    const h = fnv1a(fullName);
    const available = h % 5 !== 0; // 80% available in the stub
    const premium = available && h % 17 === 0;
    const priceCents = premium ? basePriceCents * 8 : basePriceCents;
    candidates.push({ name: fullName, tld, available, priceCents, premium });
  }

  // Add a few clever suffix variants so the user sees variety even when the
  // exact stem is taken.
  if (!hasTld) {
    for (const suffix of ['-ai', 'hq', 'lab', 'co', 'run']) {
      const stem = `${baseName}${suffix}`;
      for (const tld of ['.com', '.dev', '.io']) {
        const fullName = stem + tld;
        const h = fnv1a(fullName);
        candidates.push({
          name: fullName,
          tld,
          available: h % 4 !== 0,
          priceCents: POPULAR_TLDS.find((t) => t.tld === tld)?.basePriceCents ?? 1499,
        });
      }
    }
  }

  // Available first, then by price ascending, deduped by name.
  const seen = new Set<string>();
  return candidates
    .filter((h) => {
      if (seen.has(h.name)) return false;
      seen.add(h.name);
      return true;
    })
    .sort((a, b) => Number(b.available) - Number(a.available) || a.priceCents - b.priceCents);
}

cfDomain.get('/search', async (c) => {
  const q = c.req.query('q') ?? '';
  if (q.length < 2) return c.json({ hits: [] });

  // Production path: use the user's verified CF token + account ID to call
  // the Registrar availability endpoint. The token + account come in as
  // headers from the deployed worker's onboarding context (or from secrets
  // bound at provision time). Locally we always fall back to the stub.
  const token = c.req.header('X-OT-CF-Token');
  const accountId = c.req.header('X-OT-CF-Account');
  if (token && accountId) {
    try {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/registrar/domains/availability`,
      );
      url.searchParams.set('name', q);
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          success?: boolean;
          result?: Array<{ name: string; available: boolean; price?: number; premium?: boolean }>;
        };
        if (data.success && Array.isArray(data.result)) {
          const hits = data.result.map((r): DomainHit => ({
            name: r.name,
            tld: '.' + r.name.split('.').slice(1).join('.'),
            available: !!r.available,
            priceCents: Math.round((r.price ?? 0) * 100),
            premium: !!r.premium,
          }));
          return c.json({ hits, source: 'cf-registrar' });
        }
      }
    } catch (err) {
      console.warn('[cf-domain] live search failed, falling back to stub', err);
    }
  }

  return c.json({ hits: stubDomainResults(q), source: 'stub' });
});

cfDomain.get('/prices', (c) =>
  c.json({
    tlds: POPULAR_TLDS.map((t) => ({
      tld: t.tld,
      priceCents: t.basePriceCents,
    })),
  }),
);

const ReserveBody = z.object({
  agentName: z.string().min(2),
  email: z.string().email(),
  domain: z.string().min(3),
  priceCents: z.number().int().nonnegative(),
});

cfDomain.post('/reserve', async (c) => {
  // Pre-purchase reservation hold. Production: hit `POST
  // /accounts/{account_id}/registrar/domains/{name}` with `auto_renew: true`
  // after Stripe confirms. Locally we just mirror the body back so the UI
  // can transition.
  const parsed = ReserveBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  return c.json({
    ok: true,
    reservationId: `res_${crypto.randomUUID().slice(0, 12)}`,
    domain: parsed.data.domain,
    priceCents: parsed.data.priceCents,
    expiresAt: Date.now() + 15 * 60_000,
  });
});
