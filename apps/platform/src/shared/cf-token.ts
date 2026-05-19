// Canonical scope set for the pre-filled CF API token URL.
//
// The format Cloudflare's dashboard pre-fill accepts is a JSON-encoded array
// of `{key, type}` objects passed via the `permissionGroupKeys` query
// parameter, plus `accountId=*` (any account in the token issuer's org) and
// `zoneId=all` (every zone the token holder owns).
//
// Example (URL-decoded) from the PRD §2:
//
//   https://dash.cloudflare.com/profile/api-tokens
//     ?permissionGroupKeys=[{"key":"workers_scripts","type":"edit"},...]
//     &accountId=*
//     &zoneId=all
//     &name=Open Think - My Personal Agent
//
// The earlier `key:type,key:type` shape silently no-op'd at Cloudflare — the
// user landed on the token editor with zero scopes pre-selected. That was the
// "one-click" promise breaking.

export interface CfTokenScope {
  key: string;
  type: 'edit' | 'read';
}

export const CANONICAL_SCOPE_OBJECTS: ReadonlyArray<CfTokenScope> = [
  { key: 'workers_scripts', type: 'edit' },
  { key: 'artifacts', type: 'edit' },
  { key: 'cloudchamber', type: 'edit' },
  { key: 'containers', type: 'edit' },
  { key: 'd1', type: 'edit' },
  { key: 'workers_r2', type: 'edit' },
  { key: 'queues', type: 'edit' },
  { key: 'vectorize', type: 'edit' },
  { key: 'workers_ai', type: 'read' },
  { key: 'ai_gateway', type: 'edit' },
  { key: 'cloudflare_pages', type: 'edit' },
  { key: 'workers_kv_storage', type: 'edit' },
  { key: 'access', type: 'edit' },
  { key: 'zone', type: 'read' },
  { key: 'dns', type: 'edit' },
  { key: 'workers_routes', type: 'edit' },
  { key: 'account_settings', type: 'read' },
  { key: 'user_details', type: 'read' },
];

// Back-compat alias used by older callers (and tests). New code should prefer
// CANONICAL_SCOPE_OBJECTS — the flat string form was the bug.
export const CANONICAL_SCOPES: ReadonlyArray<string> = CANONICAL_SCOPE_OBJECTS.map(
  (s) => `${s.key}:${s.type}`,
);

export function buildTokenUrl(displayName = 'Open Think - My Personal Agent'): string {
  const params = new URLSearchParams();
  params.set('permissionGroupKeys', JSON.stringify(CANONICAL_SCOPE_OBJECTS));
  params.set('accountId', '*');
  params.set('zoneId', 'all');
  params.set('name', displayName);
  return `https://dash.cloudflare.com/profile/api-tokens?${params.toString()}`;
}
