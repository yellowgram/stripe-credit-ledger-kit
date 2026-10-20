# Changelog

Versions here match `package.json`. Entries before 0.3.0 describe releases published under the previous license and are kept as history.

## 0.4.0 — 2026-10-19

- **Template check from a clean copy.** `npm run template:smoke` (CI job `template-from-clean-clone`) copies only committed files into an empty directory, then installs, typechecks, migrates, runs the demo, builds, and imports the ledger library. `npm pack` now refuses with a message, because the kit ships as a GitHub template, not an npm package.
- **Reaper deadlock fixed (Postgres).** The reaper locked a batch of holds and then each user's balance row; `reserve`, `finalize`, and `release` lock the balance row first. A reaper racing `finalize` could deadlock and fail one side with 40P01. Each hold is now expired in its own transaction, balance row first, on both engines. Several reapers can run at once; each hold is still expired once.
- **Deadlock retry.** The Postgres adapter retries a transaction once when Postgres reports 40P01. `Db.transaction` callbacks may therefore run twice and should only touch the database.
- **`balanceBreakdown` reads one snapshot.** It read the entry sums and the balance in two statements, so a hold expiring between them made a consistent ledger report `balance !== expected`. Both now come from one statement.
- **Reserve no longer scans on every call.** `reserve` reaps at most once every 30 seconds per database handle (`OPPORTUNISTIC_REAP_INTERVAL_MS`, exported), and a failure in that pass no longer fails the reservation. Production still runs `npm run holds:reap`.
- **Scripts no longer override your environment.** `db:migrate`, `demo`, `demo:webhook`, and `holds:reap` loaded `.env.local` with override, so a stray `.env.local` beat an explicit `DATABASE_URL` or `SQLITE_PATH` (a production reaper or migrate could hit the dev database). The process environment now wins, then `.env.local`, then `.env`.
- **Grant vs refund race fixed (Postgres).** A refund or dispute that arrived while the grant transaction was still open could miss the grant and park a pending clawback the grant had already looked past, leaving refunded credits spendable. Both paths now take `pg_advisory_xact_lock` on every payment intent, charge and Checkout session id the event carries (in hash order), so they serialize per payment. `npm run holds:reap` also applies pending clawbacks whose grant exists (`applyOrphanedClawbacks`, exported from `webhook`) and logs `clawbacks_applied=N`. It only picks pending rows that a grant matches, so a backlog of rows that never match (refunds for things the ledger never sold) can't starve newer ones, and a row consumed by a racing grant before the reaper's lock is not counted as applied. `Db.transaction` now hands its callback a `TxExecutor` with a **required** `lockKeys` (breaking for custom adapters: a hand-written transaction executor without it fails to typecheck, and the webhook handlers and `holds:reap` refuse it at run time with `executor_missing_lockKeys` instead of silently losing the refund).
- **A `lockKeys` that takes no lock is refused (Postgres).** A custom executor whose `lockKeys` resolved without taking the advisory locks (for example `async () => {}`) passed the required-`lockKeys` check, and a refund racing its grant could stay pending until the next `holds:reap`. After locking, the webhook handlers and the backstop now check `pg_locks` for each key's `pg_advisory_xact_lock(hashtext(key))` and throw `lock_not_held` (HTTP 500, event not stored, Stripe retries). SQLite executors skip the check; a custom SQLite `lockKeys` can carry the exported `SERIALIZED_LOCK` marker. `SerializedLock` and `TxExecutor` are exported types.
- **Deadlocks are observable.** `createPostgresDb(url, { onDeadlockRetry })` is called each time a transaction is retried after 40P01. The deadlock test asserts it never fires, so the retry can no longer hide a lock-order regression.
- Node 22 and 24 (Node 20 is end of life); CI runs `tsc --noEmit`; script output no longer prints dotenv tips; "Using this template" checklist in the README.
- Tests: `tests/lock-verified.test.ts`, `tests/postgres-deadlock.test.ts` (its holds are dated before any other row, so leftover holds in a shared database can't fill the reaper's batch and hide a regression), `tests/reaper-throttle.test.ts`, `tests/script-env.test.ts`. `tests/postgres-webhook-race.test.ts`. `tests/phase-b.test.ts` is now `tests/clawback-and-migrate.test.ts`.
- Docs: five-minute offline quickstart (the old `cp` line was missing its spaces), a threat model, hold-TTL and `better-sqlite3` notes, the removed `v0.1.0` / `v0.1.1` tags, and leftover sales wording removed. A dead link to `BUYER_START_HERE.md` now points at `START_HERE.md`.

## 0.3.0 — 2026-10-19

- Relicensed to MIT; no longer sold. `LICENSE` is the MIT License (Copyright (c) 2026 yellowgram). The commercial grant and Polar listing packet were removed (they remain in git history). Price, money-back, and support-window copy is gone from README, START_HERE (was `BUYER_START_HERE.md`), SUPPORT, SECURITY, docs, and issue templates.
- The kit stays a template: `package.json` keeps `private: true` and is not published to npm. Adds `homepage`, `repository`, `bugs`, and `author`.
- No ledger, webhook, or schema behavior change.
- Releases before 0.3.0 were published under the previous license.

## 0.2.0 — 2026-09-27

Policy decisions in this release: a refund or dispute before its grant is stored and answered with HTTP 200; the user is paused only on a real shortfall; a won dispute does not restore credits; a price or currency change needs a new packId; production must run `npm run holds:reap`; `finalize` bills the reservation.

- **Release zip.** `stripe-credit-ledger-kit-0.2.0.zip`, tag `v0.2.0`, commit `ed435e2`, SHA-256 `2e6d6088f93a79c7b141982cb0c06e26eeb6ad28af5cc4135532a30677b734c5`.
- **Pending clawback.** `charge.refunded` and `charge.dispute.created` with no grant row persist a `pending_clawbacks` row and return HTTP 200 (`pending_clawback`) so Stripe stops. The matching grant applies that clawback in the same grant transaction. A payload with no payment intent, charge id, or Checkout session id stays `ignored_unknown_payment_intent`.
- **Pause only on shortfall.** Open holds are still released before the debit. The user is paused only when spendable cannot cover the pack. Releasing a hold does not pause when the balance covers the pack. Grants do not unpause.
- **Won dispute.** `charge.dispute.closed` stays `ignored_event`. Credits are not restored.
- **Unique keys.** Non-null idempotency keys, Stripe event ids, checkout sessions, grant payment intents, grant charge ids, and clawback payment intents are unique. NULL is not a replay wildcard: `grant`, `reserve`, and `track` reject a blank idempotency key; a clawback rejects a blank payment intent. Journal rows may still use NULL keys. A duplicate non-null key is rejected.
- **Versioned migrate.** `schema_migrations` records `001_baseline` and `002_pending_clawback_and_unique_keys`. Fresh databases and existing 0.1.2 databases both go through `migrate`. `npm run db:migrate` and boot `ensureSchema` call it. SQLite and Postgres both run.
- **Pack identity.** README and `src/billing/packs.ts` say a price or currency change requires a new packId. Catalog plus `amount_total` and currency remain the grant authority. Mismatch still rolls back. No snapshot store.
- **Reaper.** Postgres claims holds with `FOR UPDATE SKIP LOCKED`. SQLite claims with `UPDATE ... WHERE status = 'held'`. README requires `npm run holds:reap` in production. Hold TTL defaults are unchanged. `track` does not reap. `reserve` may still reap opportunistically. That is not the production path. No scheduler.
- **Finalize.** Still bills the reservation. No lesser actual-use amount.
- `npm run demo` is a sealed local fixture.

## 0.1.2 — 2026-09-27

License change only. Ledger behavior is unchanged from 0.1.0 and 0.1.1. No env renames. No webhook status changes. No reserve-replay changes. No clawback-policy changes. No pack-schema changes. No demo-flag behavior changes.

- Release zip: `stripe-credit-ledger-kit-0.1.2.zip`, tag `v0.1.2`, commit `593a2d1`, SHA-256 `b63b1c834646030c0e201db9a0b2240cb1b8ac547fb1fb610794431491955832`.
- Whole kit is source-available under PolyForm Noncommercial 1.0.0 (`LICENSE`) plus a Credit Ledger commercial grant (`docs/COMMERCIAL_GRANT.md`). Claims: source-available = true. OSI open source = false. Copyright holder remains yellowgram (`Copyright (c) 2026 yellowgram`). Contact: hello@yellowgram.dev.
- MIT extract dropped going forward. `src/billing/LICENSE.MIT` is deleted. MIT headers are removed from `src/billing/ledger.ts`, `types.ts`, and `errors.ts`. The free chapter is not MIT. `package.json` `"license"` is `LicenseRef-PolyForm-Noncommercial-1.0.0`.
- The free chapter no longer contains a pricing question or a waitlist link.
- Prior tags are grandfathered and **not resealed**. Rights already granted for those sealed artifacts are not clawed back.
  - `v0.1.0` — `stripe-credit-ledger-kit-0.1.0.zip` — SHA-256 `aa558100add2a3585190656ab1eb4b217cda6fafe596eaafe0dd02f9a9a33d94`. Shipped with an MIT carve-out on `src/billing/ledger.ts`, `types.ts`, `errors.ts`, and the free chapter for that file alone.
  - `v0.1.1` — `stripe-credit-ledger-kit-0.1.1.zip` — SHA-256 `a9bc28d82f673afc0eafbd1c3ad20c3047e95c7eb71ad70dd96f4b88473d41a8` (commit `c633584`). Same MIT carve-out as `v0.1.0`.

## 0.1.1 — 2026-09-26

Hygiene only. Ledger behavior is the 0.1.0 baseline below. No env renames. No webhook status changes. No reserve-replay changes. No clawback-policy changes. No pack-schema changes. No demo-flag behavior changes.

- `BUYER_START_HERE.md` (now `START_HERE.md`) is the front door: offline `npm test`, demo flag, graduation off `DEMO_USER_ID` / `x-ledger-secret`, hold reaper and `unpauseUser` owned by you, support boundary.
- `x-ledger-secret` still bills `DEMO_USER_ID`. That warning is on the front door and beside Environment / Known limits.
- `docs/TROUBLESHOOTING.md`, `docs/REFUND_GLOSSARY.md`, `SUPPORT.md` (including the out-of-scope reply), `SECURITY.md`, `docs/CHECKSUMS.md`.
- Issue form requires a repro pack. Missing repro is closed after 7 days.
- That tag’s `SUPPORT.md` described a post-purchase collaborator invite as the Issues path. That description is not current. See Unreleased.
- GitHub Actions runs Node **20** and **22** on both the SQLite job and the Postgres job. `engines.node` stays `>=20`.
- As shipped in this tag only: commercial kit license, with an MIT carve-out scoped to `src/billing/ledger.ts`, `types.ts`, and `errors.ts`, plus the free chapter for that file only. That carve-out is not the license of 0.1.2. This 0.1.1 zip is not rewritten. See 0.1.2.

## 0.1.0 — 2026-09-26

First release. Behavior below is the contract 0.1.1 still implements.

- **Demo flag.** `ALLOW_DEMO_CONTROLS` defaults false. `NODE_ENV=production` forces the shell closed (seed, spend, race, reset, and the flag).
- **Secret.** `LEDGER_API_SECRET` / `x-ledger-secret` opens demo checkout, check, and track only. Those routes still bill `DEMO_USER_ID`. Not multi-tenant auth.
- **Webhooks.** Signature, missing or placeholder secret, livemode mismatch: HTTP 400. Livemode mismatch does not store the event id. Database failure or pack amount/currency mismatch: HTTP 500 and the event insert rolls back. Refund or dispute for an unknown payment intent: HTTP 200 `ignored_unknown_payment_intent` (not applied to a later grant).
- **Grant authority.** Pack catalog plus `amount_total` and `currency`. `metadata.credits` is not authority.
- **Checkout origin.** `success_url` and `cancel_url` use `NEXT_PUBLIC_APP_URL` only.
- **Reserve replay.** Same user, idempotency key, and amount. No payload hash. A finished key does not spend again.
- **Clawback.** `charge.refunded` and `charge.dispute.created` take the full pack, including a partial refund. A won dispute (`charge.dispute.closed`) does not return credits. Shortfall can pause the user. Grants do not unpause. You call `unpauseUser`.
- **Holds.** Default TTL 900 seconds. Production must run `npm run holds:reap`. The demo server reaps once on the first database request. `reserve` reaps before each reservation. `track` does not. One pass expires at most 200 holds.
- **Zip.** Release asset `stripe-credit-ledger-kit-0.1.0.zip` omits `node_modules`, secret env files, SQLite databases, and `.git`. It includes `.env.example`.
