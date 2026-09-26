# Changelog

The $79 purchase is the tree you received. There is no perpetual update entitlement. Read this file before you replace a pinned zip. Soft-WTP stays off. This log does not promise a later update SKU.

Versions here match `package.json`, the git tag, and the Release asset `stripe-credit-ledger-kit-<version>.zip`.

## 0.1.1 — 2026-09-26

Hygiene only. Ledger behavior is the 0.1.0 baseline below. No env renames. No webhook status changes. No reserve-replay changes. No clawback-policy changes. No pack-schema changes. No demo-flag behavior changes.

- `BUYER_START_HERE.md` is the zip front door: offline `npm test`, demo flag, graduation off `DEMO_USER_ID` / `x-ledger-secret`, hold reaper and `unpauseUser` owned by the buyer, support boundary.
- `x-ledger-secret` still bills `DEMO_USER_ID`. That warning is on the front door and beside Environment / Known limits.
- `docs/TROUBLESHOOTING.md`, `docs/REFUND_GLOSSARY.md`, `SUPPORT.md` (including the out-of-scope reply), `SECURITY.md`, `docs/CHECKSUMS.md`.
- Issue form requires a repro pack. Missing repro is closed after 7 days.
- Expected Issues path for the private repo: post-purchase collaborator invite with Read. Documented in `SUPPORT.md`. The maintainer sends the invite.
- GitHub Actions runs Node **20** and **22** on both the SQLite job and the Postgres job. `engines.node` stays `>=20`.
- Commercial kit license, not MIT. Use and modify the kit in a commercial product. No revenue royalty. No redistributing the kit as a starter, boilerplate, template, theme, or course. MIT stays scoped to `src/billing/ledger.ts`, `types.ts`, and `errors.ts`. The free chapter is MIT for that file only. The README reserve/finalize/release example may be copied into an application and does not MIT the README.

## 0.1.0 — 2026-09-26

First Polar-ready cut. Behavior below is the contract 0.1.1 still implements.

- **Demo flag.** `ALLOW_DEMO_CONTROLS` defaults false. `NODE_ENV=production` forces the shell closed (seed, spend, race, reset, and the flag).
- **Secret.** `LEDGER_API_SECRET` / `x-ledger-secret` opens demo checkout, check, and track only. Those routes still bill `DEMO_USER_ID`. Not multi-tenant auth.
- **Webhooks.** Signature, missing or placeholder secret, livemode mismatch: HTTP 400. Livemode mismatch does not store the event id. Database failure or pack amount/currency mismatch: HTTP 500 and the event insert rolls back. Refund or dispute for an unknown payment intent: HTTP 200 `ignored_unknown_payment_intent` (not applied to a later grant).
- **Grant authority.** Pack catalog plus `amount_total` and `currency`. `metadata.credits` is not authority.
- **Checkout origin.** `success_url` and `cancel_url` use `NEXT_PUBLIC_APP_URL` only.
- **Reserve replay.** Same user, idempotency key, and amount. No payload hash. A finished key does not spend again.
- **Clawback.** `charge.refunded` and `charge.dispute.created` take the full pack, including a partial refund. A won dispute (`charge.dispute.closed`) does not return credits. Shortfall can pause the user. Grants do not unpause. Buyer calls `unpauseUser`.
- **Holds.** Default TTL 900 seconds. Production must run `npm run holds:reap`. The demo server reaps once on the first database request. `reserve` reaps before each reservation. `track` does not. One pass expires at most 200 holds.
- **Zip.** Release asset `stripe-credit-ledger-kit-0.1.0.zip` omits `node_modules`, secret env files, SQLite databases, and `.git`. It includes `.env.example`.
