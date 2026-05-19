import { Hono } from 'hono';
import { z } from 'zod';

import type { Env, Variables } from '../env';

export const sync = new Hono<{ Bindings: Env; Variables: Variables }>();

// PRD §6 — Sync between this agent's local code and the upstream public repo
// at NeoFlux-Holdings/openthink3. Two flows:
//
//   1. "Pull" — every nightly cron tick checks the upstream HEAD against
//      whatever SHA was deployed last. If there's drift, we surface a one-shot
//      diff in the Settings → Sync panel so the user can approve before
//      shipping. The status endpoint here is what powers that panel.
//
//   2. "PR back" — the agent has discovered a new skill / fixed a bug locally
//      and wants to contribute upstream. We create a branch, commit, and open
//      a PR via the GitHub API. The commit author rule from the PRD applies:
//      committer = the user's email, author = the agent's deploy-specific
//      email, and no model attribution in the commit message.
//
// Auth: GITHUB_TOKEN must be bound as a Workers Secret (set via
// `wrangler secret put GITHUB_TOKEN`). When it's missing — local dev or fresh
// deploy that hasn't run the secret rotation — the routes still respond with
// shape-correct data so the UI doesn't blow up, but they log a warning so
// the operator knows the live path didn't fire.

const UPSTREAM_REPO_DEFAULT = 'NeoFlux-Holdings/openthink3';
const GITHUB_API = 'https://api.cloudflare.com/client/v4'; // overridden per route
const SAMPLE_DIFF = `--- a/apps/platform/src/web/shell/canvas/Canvas.tsx
+++ b/apps/platform/src/web/shell/canvas/Canvas.tsx
@@ -42,6 +42,9 @@ export function Canvas({ artifacts, agentName }: Props) {
       <header className="canvas__header">
         <span className="canvas__title">
           {mode === 'single' && active ? active.title : 'Artifacts'}
         </span>
+        {hasUpdates && (
+          <span className="ot-pill ot-pill--accent">sync available</span>
+        )}
         <div className="canvas__mode" role="tablist" aria-label="Canvas window mode">`;

interface SyncStatus {
  upstreamSha: string;
  localSha: string;
  ahead: number;
  behind: number;
  summary: string;
  lastChecked: number;
  commits: Array<{ sha: string; author: string; message: string; ts: number }>;
  recentPRs: Array<{
    number: number;
    title: string;
    url: string;
    state: string;
    draft?: boolean;
    requestedReviewers?: number;
    /**
     * True when this PR's base.sha differs from the current upstream
     * HEAD — i.e. main has moved forward since this PR was last
     * synced and the branch likely needs a rebase before it can
     * be cleanly merged. We compute this server-side from the SHAs
     * we already pull for the status payload, so it costs zero
     * additional GitHub round-trips.
     */
    staleBehind?: boolean;
  }>;
  source: 'github' | 'stub' | 'cached';
}

async function githubFetch(
  path: string,
  init: RequestInit & { token?: string },
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('User-Agent', 'OpenThink-Agent/1.0');
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  return fetch(`https://api.github.com${path}`, { ...init, headers });
}

function repoFromEnv(env: Env): string {
  return env.OPENTHINK_UPSTREAM_REPO ?? UPSTREAM_REPO_DEFAULT;
}

async function readLocalSha(env: Env): Promise<string> {
  const raw = await env.SETTINGS.get('sync:local-sha');
  return raw ?? 'unknown';
}

async function writeLocalSha(env: Env, sha: string): Promise<void> {
  await env.SETTINGS.put('sync:local-sha', sha);
}

sync.get('/status', async (c) => {
  const repo = repoFromEnv(c.env);
  const token = c.env.GITHUB_TOKEN;
  const cacheKey = `sync:status:${repo}`;

  // Serve a 60-second KV cache so the Sync panel doesn't burn rate limit on
  // every page load.
  const cached = await c.env.SETTINGS.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as SyncStatus & { cachedAt: number };
      if (Date.now() - parsed.cachedAt < 60_000) {
        return c.json({ ...parsed, source: 'cached' });
      }
    } catch {
      /* fall through */
    }
  }

  const localSha = await readLocalSha(c.env);

  if (!token) {
    // Dev / unbound — return a deterministic snapshot so the UI flows.
    console.warn('[sync] GITHUB_TOKEN unset, returning stub status');
    const stub = stubStatus(localSha);
    return c.json(stub);
  }

  try {
    // 1. Latest commit on main upstream.
    const headRes = await githubFetch(`/repos/${repo}/commits/main`, { token });
    if (!headRes.ok) {
      throw new Error(`github_${headRes.status}`);
    }
    const head = (await headRes.json()) as { sha: string };

    // 2. The 5 most recent commits, so the panel can show a changelog.
    const listRes = await githubFetch(`/repos/${repo}/commits?per_page=5`, { token });
    const list = (await listRes.json()) as Array<{
      sha: string;
      commit: { author: { name: string; date: string }; message: string };
    }>;

    // 3. Open PRs (so the user knows what's already in flight).
    // We pull `base.sha` so we can flag PRs whose base hasn't
    // caught up to main's current HEAD — those are the ones a user
    // would have to rebase before merging cleanly. GitHub's list
    // endpoint already returns this, so no extra round-trip
    // required.
    const prsRes = await githubFetch(`/repos/${repo}/pulls?state=open&per_page=5`, { token });
    const prs = (await prsRes.json()) as Array<{
      number: number;
      title: string;
      html_url: string;
      state: string;
      draft?: boolean;
      requested_reviewers?: unknown[];
      base?: { sha?: string };
    }>;

    const behind =
      localSha === 'unknown' || localSha === head.sha
        ? 0
        : list.findIndex((c) => c.sha === localSha) === -1
          ? list.length // local SHA not in last 5 → at least this many behind
          : list.findIndex((c) => c.sha === localSha);

    const status: SyncStatus & { cachedAt: number } = {
      upstreamSha: head.sha.slice(0, 7),
      localSha: localSha === 'unknown' ? '—' : localSha.slice(0, 7),
      ahead: 0,
      behind,
      summary:
        behind === 0
          ? 'You are caught up with upstream.'
          : `${behind} commit${behind === 1 ? '' : 's'} since your last deploy.`,
      lastChecked: Date.now(),
      commits: list.slice(0, behind || list.length).map((c) => ({
        sha: c.sha.slice(0, 7),
        author: c.commit.author.name,
        message: c.commit.message.split('\n')[0] ?? '',
        ts: new Date(c.commit.author.date).getTime(),
      })),
      recentPRs: (Array.isArray(prs) ? prs : []).map((p) => {
        // staleBehind: PR's base.sha differs from current upstream
        // HEAD. We compare full SHAs (not the truncated 7-char form
        // we expose elsewhere) to avoid prefix collisions. Missing
        // base.sha → can't compute, fall through to undefined so the
        // client can render "unknown" instead of a wrong negative.
        const baseSha = p.base?.sha;
        const staleBehind =
          typeof baseSha === 'string' && baseSha.length >= 7
            ? baseSha !== head.sha
            : undefined;
        return {
          number: p.number,
          title: p.title,
          url: p.html_url,
          state: p.state,
          draft: p.draft ?? false,
          requestedReviewers: Array.isArray(p.requested_reviewers)
            ? p.requested_reviewers.length
            : 0,
          staleBehind,
        };
      }),
      source: 'github',
      cachedAt: Date.now(),
    };

    await c.env.SETTINGS.put(cacheKey, JSON.stringify(status), { expirationTtl: 5 * 60 });
    return c.json(status);
  } catch (err) {
    console.warn('[sync] live status failed, returning stub', err);
    return c.json(stubStatus(localSha));
  }
});

function stubStatus(localSha: string): SyncStatus {
  return {
    upstreamSha: 'e593b06',
    localSha: localSha === 'unknown' ? '—' : localSha.slice(0, 7),
    ahead: 0,
    behind: 3,
    summary:
      "Three commits since your local: the canvas grew eight artifact types, train mode landed with a Save-as-skill diff, and the WS bridge now falls back to a local echo when the Worker isn't reachable.",
    lastChecked: Date.now() - 4 * 60_000,
    commits: [
      {
        sha: 'e593b06',
        author: 'tzarebczan',
        message: 'WS bridge: shell ↔ orchestrator with graceful local-echo fallback',
        ts: Date.now() - 30 * 60_000,
      },
      {
        sha: '492f6b5',
        author: 'tzarebczan',
        message: 'train mode plan card + library/skills/learning/settings pages',
        ts: Date.now() - 90 * 60_000,
      },
      {
        sha: '0ce2681',
        author: 'tzarebczan',
        message: 'artifact canvas: 8 types, 3 window modes, thumbnail strip',
        ts: Date.now() - 180 * 60_000,
      },
    ],
    recentPRs: [],
    source: 'stub',
  };
}

sync.post('/pull', async (c) => {
  const repo = repoFromEnv(c.env);
  const token = c.env.GITHUB_TOKEN;
  const localSha = await readLocalSha(c.env);

  if (!token || localSha === 'unknown') {
    return c.json({ ok: true, diff: SAMPLE_DIFF, source: 'stub' });
  }

  try {
    // Compare local…HEAD via the compare API. Returns the diff URL + file list.
    const res = await githubFetch(
      `/repos/${repo}/compare/${localSha}...main`,
      {
        token,
        headers: { Accept: 'application/vnd.github.diff' },
      },
    );
    if (!res.ok) throw new Error(`github_compare_${res.status}`);
    const diff = await res.text();
    return c.json({ ok: true, diff: diff || '(no diff)', source: 'github' });
  } catch (err) {
    console.warn('[sync] pull failed', err);
    return c.json({ ok: true, diff: SAMPLE_DIFF, source: 'stub' });
  }
});

// Per-commit diff — powers the inline expansion in "Recent upstream
// commits" so the user can scan what each landed commit actually
// changed without leaving the panel. Hits GitHub's commit endpoint
// with `Accept: application/vnd.github.diff` so we get the unified
// patch directly (same shape parseDiff already understands in the
// SyncPanel). Falls through to a stub message when the token is
// missing so the dev UX renders gracefully.
sync.get('/commits/:sha/diff', async (c) => {
  const sha = c.req.param('sha');
  if (!sha || !/^[a-f0-9]{6,40}$/i.test(sha)) {
    return c.json({ ok: false, error: 'invalid_sha' }, 400);
  }
  const repo = repoFromEnv(c.env);
  const token = c.env.GITHUB_TOKEN;
  if (!token) {
    return c.json({
      ok: true,
      sha,
      diff: SAMPLE_DIFF,
      source: 'stub',
    });
  }
  try {
    const res = await githubFetch(`/repos/${repo}/commits/${sha}`, {
      token,
      headers: { Accept: 'application/vnd.github.diff' },
    });
    if (!res.ok) {
      const txt = await res.text();
      console.warn('[sync] commit diff failed', res.status, txt);
      return c.json(
        {
          ok: false,
          sha,
          error: res.status === 404 ? 'not_found' : `github_${res.status}`,
          source: 'github',
        },
        res.status === 404 ? 404 : 502,
      );
    }
    const diff = await res.text();
    return c.json({
      ok: true,
      sha,
      diff: diff || '(no diff)',
      source: 'github',
    });
  } catch (err) {
    console.warn('[sync] commit diff threw', err);
    return c.json(
      {
        ok: false,
        sha,
        error: err instanceof Error ? err.message : 'unknown',
        source: 'github',
      },
      502,
    );
  }
});

// Per-PR diff — same shape as the commit diff endpoint, but
// scoped to a pull request. Used by the SyncPanel's "Preview ↧"
// inline-expand affordance so reviewers can scan what a PR
// actually changes before merging without flipping over to GitHub.
sync.get('/pulls/:number/diff', async (c) => {
  const numRaw = c.req.param('number');
  const prNumber = Number.parseInt(numRaw ?? '', 10);
  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    return c.json({ ok: false, error: 'invalid_number' }, 400);
  }
  const repo = repoFromEnv(c.env);
  const token = c.env.GITHUB_TOKEN;
  if (!token) {
    return c.json({
      ok: true,
      number: prNumber,
      diff: SAMPLE_DIFF,
      source: 'stub',
    });
  }
  try {
    const res = await githubFetch(`/repos/${repo}/pulls/${prNumber}`, {
      token,
      headers: { Accept: 'application/vnd.github.diff' },
    });
    if (!res.ok) {
      const txt = await res.text();
      console.warn('[sync] pr diff failed', res.status, txt);
      return c.json(
        {
          ok: false,
          number: prNumber,
          error: res.status === 404 ? 'not_found' : `github_${res.status}`,
          source: 'github',
        },
        res.status === 404 ? 404 : 502,
      );
    }
    const diff = await res.text();
    return c.json({
      ok: true,
      number: prNumber,
      diff: diff || '(no diff)',
      source: 'github',
    });
  } catch (err) {
    console.warn('[sync] pr diff threw', err);
    return c.json(
      {
        ok: false,
        number: prNumber,
        error: err instanceof Error ? err.message : 'unknown',
        source: 'github',
      },
      502,
    );
  }
});

sync.post('/apply', async (c) => {
  // Record that the user accepted the dry-run. The actual re-deploy is
  // triggered by the GitHub Action when the agent's repo gets pushed to —
  // this endpoint just updates the local SHA so subsequent status calls
  // show "caught up".
  const repo = repoFromEnv(c.env);
  const token = c.env.GITHUB_TOKEN;
  if (token) {
    try {
      const headRes = await githubFetch(`/repos/${repo}/commits/main`, { token });
      if (headRes.ok) {
        const head = (await headRes.json()) as { sha: string };
        await writeLocalSha(c.env, head.sha);
      }
    } catch {
      /* swallow — the apply still succeeds at the orchestration level */
    }
  }
  return c.json({
    ok: true,
    deployVersion: `v${new Date().toISOString().slice(0, 10)}-1`,
    status: 'queued',
  });
});

const ProposePrBody = z.object({
  skillId: z.string().optional(),
  title: z.string().min(3),
  body: z.string().min(1).optional(),
  branchSuffix: z.string().optional(),
  patches: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string(),
      }),
    )
    .optional(),
});

sync.post('/propose-pr', async (c) => {
  const parsed = ProposePrBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const result = await proposePr(c.env, parsed.data);
  return c.json(result, result.ok ? 200 : 502);
});

// Inline merge action from the Settings → Sync panel. Users no longer
// need to roundtrip through github.com to land a ready PR opened by the
// agent. Squash-merge is the default and only mode for now: agent
// patches are small + single-purpose, and squashing keeps the upstream
// log clean. The route is permissive about input shape — `:number`
// validated as positive int, optional commit-title/body, optional
// `mergeMethod` override (squash | merge | rebase). Anything stronger
// gets pushed to GitHub and the API surfaces its own 405/409 errors.
const MergePrBody = z.object({
  commitTitle: z.string().min(1).max(120).optional(),
  commitMessage: z.string().max(2_000).optional(),
  mergeMethod: z.enum(['squash', 'merge', 'rebase']).optional(),
});

sync.put('/pulls/:number/merge', async (c) => {
  const numRaw = c.req.param('number');
  const prNumber = Number.parseInt(numRaw ?? '', 10);
  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    return c.json({ ok: false, error: 'invalid_number' }, 400);
  }
  const parsed = MergePrBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const repo = repoFromEnv(c.env);
  const token = c.env.GITHUB_TOKEN;
  if (!token) {
    // No live credentials — treat as stub-success so the panel can
    // optimistically render the merged state in dev / pre-secret-deploy.
    // The actual upstream commit will land once the operator wires the
    // token; until then the panel just shows the optimistic state.
    console.warn('[sync] merge-pr stubbed (no GITHUB_TOKEN)');
    return c.json({
      ok: true,
      merged: true,
      number: prNumber,
      source: 'stub',
    });
  }
  try {
    const body = {
      commit_title: parsed.data.commitTitle,
      commit_message: parsed.data.commitMessage,
      merge_method: parsed.data.mergeMethod ?? 'squash',
    };
    const res = await githubFetch(`/repos/${repo}/pulls/${prNumber}/merge`, {
      method: 'PUT',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.warn('[sync] merge-pr failed', res.status, txt);
      // GitHub returns 405 when not mergeable (conflicts / required reviews),
      // 409 when head SHA mismatch (someone pushed since we checked). Pass
      // the status through so the UI can render a useful inline error.
      return c.json(
        {
          ok: false,
          number: prNumber,
          status: res.status,
          error: res.status === 405
            ? 'not_mergeable'
            : res.status === 409
              ? 'sha_mismatch'
              : `github_${res.status}`,
          source: 'github',
        },
        res.status === 405 || res.status === 409 ? 200 : 502,
      );
    }
    const data = (await res.json()) as { sha?: string; merged?: boolean };
    return c.json({
      ok: true,
      merged: data.merged !== false,
      sha: data.sha,
      number: prNumber,
      source: 'github',
    });
  } catch (err) {
    console.warn('[sync] merge-pr threw', err);
    return c.json(
      {
        ok: false,
        number: prNumber,
        error: err instanceof Error ? err.message : 'unknown',
        source: 'github',
      },
      502,
    );
  }
});

// Inline draft → ready transition. GitHub doesn't expose this as a
// REST endpoint, so we have to two-step it: REST fetch the PR by
// number to read its `node_id`, then fire the
// `markPullRequestReadyForReview` GraphQL mutation. That mutation
// drops the PR's `isDraft` flag and lets reviewers see it / approve
// it / be auto-requested via CODEOWNERS. The route is shaped to
// match the merge endpoint — same `:number` validation, same
// stub-success path when the token is missing, same structured
// error returns for the UI to render inline.
sync.put('/pulls/:number/ready', async (c) => {
  const numRaw = c.req.param('number');
  const prNumber = Number.parseInt(numRaw ?? '', 10);
  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    return c.json({ ok: false, error: 'invalid_number' }, 400);
  }
  const repo = repoFromEnv(c.env);
  const token = c.env.GITHUB_TOKEN;
  if (!token) {
    console.warn('[sync] mark-ready stubbed (no GITHUB_TOKEN)');
    return c.json({
      ok: true,
      ready: true,
      number: prNumber,
      source: 'stub',
    });
  }
  try {
    // Step 1 — REST GET to pluck the node_id. Faster than running a
    // GraphQL query for the same field, and surfaces 404s cleanly so
    // we can short-circuit the mutation.
    const lookupRes = await githubFetch(`/repos/${repo}/pulls/${prNumber}`, { token });
    if (!lookupRes.ok) {
      const txt = await lookupRes.text();
      console.warn('[sync] mark-ready lookup failed', lookupRes.status, txt);
      return c.json(
        {
          ok: false,
          number: prNumber,
          error:
            lookupRes.status === 404
              ? 'not_found'
              : `github_${lookupRes.status}`,
          source: 'github',
        },
        lookupRes.status === 404 ? 404 : 502,
      );
    }
    const lookup = (await lookupRes.json()) as {
      node_id?: string;
      draft?: boolean;
    };
    if (!lookup.node_id) {
      return c.json(
        {
          ok: false,
          number: prNumber,
          error: 'missing_node_id',
          source: 'github',
        },
        502,
      );
    }
    if (lookup.draft === false) {
      // Already ready — return success without re-firing the mutation
      // so the UI's optimistic update still lands clean.
      return c.json({
        ok: true,
        ready: true,
        number: prNumber,
        alreadyReady: true,
        source: 'github',
      });
    }
    // Step 2 — GraphQL mutation. POST /graphql with the standard
    // `query` + `variables` body. The mutation returns the updated
    // pullRequest so we can confirm `isDraft` flipped.
    const gqlRes = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'OpenThink-Agent/1.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `mutation MarkReady($id: ID!) {
          markPullRequestReadyForReview(input: { pullRequestId: $id }) {
            pullRequest { isDraft number }
          }
        }`,
        variables: { id: lookup.node_id },
      }),
    });
    if (!gqlRes.ok) {
      const txt = await gqlRes.text();
      console.warn('[sync] mark-ready graphql failed', gqlRes.status, txt);
      return c.json(
        {
          ok: false,
          number: prNumber,
          error: `graphql_${gqlRes.status}`,
          source: 'github',
        },
        502,
      );
    }
    const gqlData = (await gqlRes.json()) as {
      data?: {
        markPullRequestReadyForReview?: {
          pullRequest?: { isDraft?: boolean };
        };
      };
      errors?: Array<{ message: string }>;
    };
    if (gqlData.errors && gqlData.errors.length > 0) {
      console.warn('[sync] mark-ready graphql errors', gqlData.errors);
      return c.json(
        {
          ok: false,
          number: prNumber,
          error: gqlData.errors[0]?.message ?? 'graphql_error',
          source: 'github',
        },
        502,
      );
    }
    const isDraft =
      gqlData.data?.markPullRequestReadyForReview?.pullRequest?.isDraft;
    return c.json({
      ok: true,
      ready: isDraft === false,
      number: prNumber,
      source: 'github',
    });
  } catch (err) {
    console.warn('[sync] mark-ready threw', err);
    return c.json(
      {
        ok: false,
        number: prNumber,
        error: err instanceof Error ? err.message : 'unknown',
        source: 'github',
      },
      502,
    );
  }
});

export interface ProposePrInput {
  title: string;
  body?: string;
  skillId?: string;
  branchSuffix?: string;
  patches?: Array<{ path: string; content: string }>;
}

export interface ProposePrResult {
  ok: boolean;
  prUrl?: string;
  prNumber?: number;
  branch?: string;
  state?: string;
  source: 'github' | 'stub';
  error?: string;
}

// Shared so the skills route can call this directly (auto-PR-back on
// save-as-skill) without re-entering the worker over fetch().
export async function proposePr(env: Env, input: ProposePrInput): Promise<ProposePrResult> {
  const repo = env.OPENTHINK_UPSTREAM_REPO ?? 'NeoFlux-Holdings/openthink3';
  const token = env.GITHUB_TOKEN;
  const branch = `agent/${input.branchSuffix ?? input.skillId ?? crypto.randomUUID().slice(0, 8)}`;

  if (!token) {
    console.warn('[sync] GITHUB_TOKEN unset, returning stub PR');
    return {
      ok: true,
      prUrl: `https://github.com/${repo}/pull/draft-${Math.floor(Math.random() * 1_000)}`,
      branch,
      state: 'draft',
      source: 'stub',
    };
  }

  try {
    // 1. Find the SHA of main.
    const refRes = await githubFetch(`/repos/${repo}/git/ref/heads/main`, { token });
    if (!refRes.ok) throw new Error(`refs_${refRes.status}`);
    const refData = (await refRes.json()) as { object: { sha: string } };
    const baseSha = refData.object.sha;

    // 2. Create a branch off main. If it already exists, GitHub returns 422 —
    //    we treat that as "fine, push commits onto it".
    const createRefRes = await githubFetch(`/repos/${repo}/git/refs`, {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });
    if (!createRefRes.ok && createRefRes.status !== 422) {
      const errBody = await createRefRes.text();
      throw new Error(`create_ref_${createRefRes.status}: ${errBody}`);
    }

    // 3. For each patch, PUT the new file contents on the branch. The Contents
    //    API auto-creates a commit per file — fine for the small agent-authored
    //    patches we expect here.
    if (input.patches && input.patches.length > 0) {
      for (const patch of input.patches) {
        // Look up the file's current SHA on the branch (if it exists).
        let existingSha: string | undefined;
        try {
          const lookup = await githubFetch(
            `/repos/${repo}/contents/${encodeURIComponent(patch.path)}?ref=${branch}`,
            { token },
          );
          if (lookup.ok) {
            const data = (await lookup.json()) as { sha?: string };
            existingSha = data.sha;
          }
        } catch {
          /* file probably doesn't exist yet; create it */
        }
        const putRes = await githubFetch(
          `/repos/${repo}/contents/${encodeURIComponent(patch.path)}`,
          {
            method: 'PUT',
            token,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: `${input.title}\n\nAgent-authored patch.`,
              content: btoa(unescape(encodeURIComponent(patch.content))),
              branch,
              sha: existingSha,
            }),
          },
        );
        if (!putRes.ok) {
          const errBody = await putRes.text();
          throw new Error(`put_${putRes.status}: ${errBody}`);
        }
      }
    }

    // 4. Open the PR.
    const prRes = await githubFetch(`/repos/${repo}/pulls`, {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        head: branch,
        base: 'main',
        body:
          input.body ??
          'Opened by your OpenThink agent. Review and merge if it looks good.',
        draft: true,
      }),
    });
    if (!prRes.ok) {
      const errBody = await prRes.text();
      throw new Error(`pull_${prRes.status}: ${errBody}`);
    }
    const pr = (await prRes.json()) as { html_url: string; number: number; state: string };

    return {
      ok: true,
      prUrl: pr.html_url,
      prNumber: pr.number,
      branch,
      state: pr.state,
      source: 'github',
    };
  } catch (err) {
    console.warn('[sync] propose-pr failed', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'unknown',
      branch,
      source: 'github',
    };
  }
}
