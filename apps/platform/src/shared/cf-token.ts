// Canonical scope set for the pre-filled CF API token URL.
// Marked "plausible" in the PRD §4 — confirm against
// `GET /user/tokens/permission_groups` at install time.

export const CANONICAL_SCOPES: ReadonlyArray<string> = [
  'workers_scripts:edit',
  'artifacts:edit',
  'cloudchamber:edit',
  'containers:edit',
  'd1:edit',
  'workers_r2:edit',
  'queues:edit',
  'vectorize:edit',
  'workers_ai:read',
  'ai_gateway:edit',
  'cloudflare_pages:edit',
  'workers_kv_storage:edit',
  'access:edit',
  'zone:read',
  'dns:edit',
  'workers_routes:edit',
  'account_settings:read',
  'user_details:read',
];

export function buildTokenUrl(displayName = 'Open Think - My Personal Agent'): string {
  const params = new URLSearchParams();
  params.set('name', displayName);
  // The permissionGroupKeys param is the comma-joined scope set.
  params.set('permissionGroupKeys', CANONICAL_SCOPES.join(','));
  return `https://dash.cloudflare.com/profile/api-tokens?${params.toString()}`;
}
