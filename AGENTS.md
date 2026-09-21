# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

Durable product decisions:
- Explore, Launch, and Token are separate hash routes; leaving a token route must fully unmount its trade screen.
- Token charts must use indexed confirmed trades and functional time ranges. Never draw fake market history.
- User-created tokens require an image. Production images and metadata belong in persistent shared storage, with browser storage only as a local-development fallback.
- Keep the MVP compatible with Cloudflare's free tiers: compressed WebP artwork in R2, D1 for metadata/history, bounded and cached API reads.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
