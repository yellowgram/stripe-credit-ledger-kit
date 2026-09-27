# Changelog

The $79 once purchase is the tree you received. There is no perpetual update entitlement. Read this file before you replace a pinned zip. Soft-WTP stays off. This log does not promise a later update SKU.

Versions here match `package.json`. The current Polar file is tag `v0.1.2`, asset `stripe-credit-ledger-kit-0.1.2.zip`, SHA-256 `b63b1c834646030c0e201db9a0b2240cb1b8ac547fb1fb610794431491955832` (commit `593a2d1`). That zip is inside the PolyForm Noncommercial 1.0.0 + Suthirth Commercial Grant fence. The public license is not MIT. `v0.1.0` and `v0.1.1` remain grandfathered history and are not resealed.

## Unreleased

Ops and buyer-copy only. Ledger behavior is unchanged from 0.1.2. No env renames. No webhook status changes. No reserve-replay changes. No clawback-policy changes. No pack-schema changes. No demo-flag behavior changes. No version bump. The 0.1.2 zip is not resealed.

- Buyer copy names the Polar file as `stripe-credit-ledger-kit-0.1.2.zip` (tag `v0.1.2`, commit `593a2d1`, SHA-256 `b63b1c834646030c0e201db9a0b2240cb1b8ac547fb1fb610794431491955832`) under PolyForm Noncommercial 1.0.0 plus the Suthirth Commercial Grant. That zip stays inside the license fence. `v0.1.0` and `v0.1.1` stay grandfathered notes. Soft-WTP stays off. Price stays $79 once. No money-back window.
- `npm run demo` is a sealed local fixture smoke: a signed `checkout.session.completed` for `pack_100`, a grant on the migrated database, then a replay of that same event id. No Stripe network and no card charge. `npm run demo:webhook` still posts that fixture to a running dev server. Soft-WTP stays off.

## 0.1.2 — 2026-09-27

License fence for the sold zip. Ledger behavior is unchanged from 0.1.0 and 0.1.1. No env renames. No webhook status changes. No reserve-replay changes. No clawback-policy changes. No pack-schema changes. No demo-flag behavior changes.

- Sold file: `stripe-credit-ledger-kit-0.1.2.zip`, tag `v0.1.2`, commit `593a2d1`, SHA-256 `b63b1c834646030c0e201db9a0b2240cb1b8ac547fb1fb610794431491955832`. This zip is the license fence in this section. Price $79 once. No money-back window.
- Whole kit is source-available under PolyForm Noncommercial 1.0.0 (`LICENSE`) plus a Suthirth Commercial Grant (`docs/COMMERCIAL_GRANT.md`). Claims: source-available = true. OSI open source = false. Copyright holder remains yellowgram (`Copyright (c) 2026 yellowgram`). Seller: Suthirth solutions. Contact: hello@yellowgram.dev. Product name: Credit Ledger (Stripe credit ledger kit). Current SKU: $79 once.
- MIT extract dropped going forward. `src/billing/LICENSE.MIT` is deleted. MIT headers are removed from `src/billing/ledger.ts`, `types.ts`, and `errors.ts`. The free chapter is not MIT. `package.json` `"license"` is `LicenseRef-PolyForm-Noncommercial-1.0.0`.
- Soft-WTP stays off. The free chapter no longer contains a “would you pay ~$79” ask or `[WAITLIST_URL]`. No coupons. No cold invoices. No Polar checkout URLs in the README or zip-bound docs.
- Prior tags are grandfathered and **not resealed**. Rights already granted for those sealed artifacts are not clawed back.
  - `v0.1.0` — `stripe-credit-ledger-kit-0.1.0.zip` — SHA-256 `aa558100add2a3585190656ab1eb4b217cda6fafe596eaafe0dd02f9a9a33d94`. Shipped with an MIT carve-out on `src/billing/ledger.ts`, `types.ts`, `errors.ts`, and the free chapter for that file alone.
  - `v0.1.1` — `stripe-credit-ledger-kit-0.1.1.zip` — SHA-256 `a9bc28d82f673afc0eafbd1c3ad20c3047e95c7eb71ad70dd96f4b88473d41a8` (commit `c633584`). Same MIT carve-out as `v0.1.0`.

## 0.1.1 — 2026-09-26

Hygiene only. Ledger behavior is the 0.1.0 baseline below. No env renames. No webhook status changes. No reserve-replay changes. No clawback-policy changes. No pack-schema changes. No demo-flag behavior changes.

- `BUYER_START_HERE.md` is the zip front door: offline `npm test`, demo flag, graduation off `DEMO_USER_ID` / `x-ledger-secret`, hold reaper and `unpauseUser` owned by the buyer, support boundary.
- `x-ledger-secret` still bills `DEMO_USER_ID`. That warning is on the front door and beside Environment / Known limits.
- `docs/TROUBLESHOOTING.md`, `docs/REFUND_GLOSSARY.md`, `SUPPORT.md` (including the out-of-scope reply), `SECURITY.md`, `docs/CHECKSUMS.md`.
- Issue form requires a repro pack. Missing repro is closed after 7 days.
- Expected Issues path for the private repo: post-purchase collaborator invite with Read. Documented in `SUPPORT.md`. The maintainer sends the invite.
- GitHub Actions runs Node **20** and **22** on both the SQLite job and the Postgres job. `engines.node` stays `>=20`.
- As shipped in this tag only: commercial kit license, with an MIT carve-out scoped to `src/billing/ledger.ts`, `types.ts`, and `errors.ts`, plus the free chapter for that file only. That carve-out is not the license of 0.1.2. This 0.1.1 zip is not rewritten. See 0.1.2.

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
