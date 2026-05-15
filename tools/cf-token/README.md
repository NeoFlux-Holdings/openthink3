# tools/cf-token

CF API-token deep-link URL builder and scope validator.

- `src/scopes.ts` — canonical scope set (PRD §4).
- `src/build-url.ts` — emits `dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=...&name=...`.
- `src/validate.ts` — fetches `/user/tokens/permission_groups` and asserts every canonical scope still exists.

Logic currently lives in `apps/platform/src/shared/cf-token.ts` while iteration 1 keeps the
provisioner inside the platform app. We extract it here in iteration 2 when the starter
template needs to call it during user onboarding.
