# personal-agent (starter)

The deploy template that a user's Cloudflare account receives during onboarding.
This is what gets pushed to the user's Worker — a single-Worker scaffold pre-wired
with the Orchestrator DO and the standard skill pack.

For iteration 1 this is intentionally minimal — the platform app (`apps/platform`)
*is* the deployable artifact today. We split this out in iteration 2 once the
provisioner is wired to Wrangler.
