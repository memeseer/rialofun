# RialoFun zero-cost backend

The app can run without cloud bindings during local development. In that mode,
compressed token images and confirmed trades remain in the current browser.

For shared, persistent data the worker requires one Cloudflare Free-plan
binding and supports a second optional binding:

- `DB`: D1 database for market metadata and indexed trades.
- `IMAGES` (optional): R2 Standard bucket for content-addressed token artwork.
  Without it the MVP stores the same bounded WebP blobs in D1, so R2 checkout
  and a payment method are not required.

Use `wrangler.toml.example` as the deployment template and apply
`migrations/0001_initial.sql` to the D1 database. Never commit the generated
`wrangler.toml` if it contains account-specific identifiers.

## Cost guards

- Images are converted in the browser to a 640 × 640 WebP and kept below
  roughly 320 KB.
- The API rejects uploads above 350 KB and deduplicates them by SHA-256.
- A D1-backed atomic quota stops new artwork at 2 GB total; the API returns
  `507` instead of creating overage.
- Trade reads are capped at 500 rows per request and cached for 10 seconds.
- Market metadata reads are capped at 500 rows and cached for 15 seconds.
- The frontend falls back to local browser storage when bindings are absent;
  it does not require a paid service to remain usable.

## Indexer

The Worker runs `runIndexer` every minute and also starts a bounded background
pass when `/api/markets` is requested. It reads Rialo's
`getSignaturesForAddress` and `getTransaction` RPC methods for the RialoFun
program, decodes the instruction tags, snapshots market state, and writes only
successful transactions as `verified = 1`. The API exposes verified trades,
holder balances, and aggregated candles.

## Trust boundary

New browser-submitted trade rows are marked `verified = 0`. The scheduled
indexer promotes only successful RPC transactions to canonical history. This
keeps optimistic UI feedback separate from authoritative on-chain data.
