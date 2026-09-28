# Stripe credit ledger kit

Cloneable credit ledger for indie AI SaaS. **Your** Stripe. **Your** database. A real-time hard gate before the expensive call.

Buy a credit pack in Stripe Checkout → webhook grants a balance → `check` / `reserve` → `finalize` or `release` → a small balance page. This repository is that billing module plus a thin demo shell. It is not a chat app, not a hosted wallet, and not Stripe Credit Grants.

yellowgram sells the kit on Polar. Polar is not in this codebase. Your customers pay on your Stripe account. We never hold their balances.

Source version **0.2.0** (`package.json`). Polar delivers `stripe-credit-ledger-kit-0.2.0.zip` (tag `v0.2.0`, commit `ed435e2`, SHA-256 `2e6d6088f93a79c7b141982cb0c06e26eeb6ad28af5cc4135532a30677b734c5`). Buyers of that zip get PolyForm Noncommercial 1.0.0 plus a Credit Ledger commercial grant. The public license is not MIT. Price is **$79 once**, with **no money-back window**. Unzipped from Polar? Start at [BUYER_START_HERE.md](BUYER_START_HERE.md). The prior sold zip `v0.1.2`, and tags `v0.1.0` and `v0.1.1`, stay as shipped and are not resealed. They are not the current Polar file. Digests: [docs/CHECKSUMS.md](docs/CHECKSUMS.md). Changes: [CHANGELOG.md](CHANGELOG.md).

## Use Autumn or Metronome instead when…

Do not keep this ledger if a hosted product fits the job better.

- **You do not need a hard gate.** Basic Stripe Billing Credits (Credit Grants) apply when the invoice finalizes. Customers can spend past the grant mid-cycle. Stripe’s own comparison says that is invoice-time, and that real-time prepaid drawdown is on Metronome. If “they owe us at the end of the month” is acceptable, use [Meters + Credit Grants](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits) and stop. Read [the free chapter](docs/stripe-credit-grants-are-invoice-time.md).
- **You do not want to own failure modes.** Duplicate webhooks, out-of-order events, two requests for the last credit, and a provider 500 after you already decremented are your bugs now. If you want hosted `check` / `track` and you will accept a control plane, start on [Autumn](https://useautumn.com). Free tier, then a real bill — confirm the live pricing page.
- **You need Stripe’s real-time prepaid platform.** Dimensional pricing, commits, burndown, payment-gated credit release: [Metronome](https://docs.stripe.com/billing/how-metronome-works-with-stripe). Startup pricing is a percent of billing volume plus ingest fees — confirm [the live page](https://metronome.com/pricing). Stripe’s compare table lists **Connect: not supported** on the Metronome column.
- **You need plans, entitlements, rollovers, or multi-feature credit systems.** That is a control plane (Autumn or Metronome), not three SQL tables.
- **You need Stripe Connect** for this billing path. This kit is not Connect. Metronome’s Connect cell is “not supported” in Stripe’s docs. A DIY ledger you extend, or an Autumn-class product, is the usual fork.
- **You wanted a full AI SaaS boilerplate** (chat, streaming, auth, product chrome). This repo will feel unfinished on purpose. Copy `src/billing` into the app you already have.

Stay if you want owned Postgres (or SQLite) on your Stripe Checkout, a hard stop at zero, and tests for the edges above.

## Not an API auth header

`LEDGER_API_SECRET` / `x-ledger-secret` does not pick a customer. Checkout, check, and track still bill `DEMO_USER_ID` (default `demo_user`). That is one shared demo balance, not multi-tenant auth. A `userId` in the JSON body is ignored. Leave the secret unset. Copy `src/billing` and pass `userId` from your session. The same warning sits on [BUYER_START_HERE.md](BUYER_START_HERE.md), in [Environment](#environment), and under [Known limits](#known-limits).

## What you get

| Piece | Where |
|---|---|
| Pack catalog (100 / 500 / 2,000) | `src/billing/packs.ts` |
| Checkout Session (`userId`, `credits`, `packId`) | `src/billing/checkout.ts` |
| Webhook: signature check + idempotent `stripe_events` | `src/billing/webhook.ts` |
| `check`, `reserve`, `finalize`, `release`, `track` | `src/billing/ledger.ts` |
| Tables | `credit_balances`, `credit_ledger_entries`, `stripe_events` |
| Demo balance UI | `src/app` — replace this |
| Edge-case tests | `tests/` |

Reservations are rows in `credit_ledger_entries` (`kind = 'reserve'`, status `held` → `finalized` or `released`). There is no fourth balance table.

## Quick start (Stripe test mode)

Requirements: Node.js 20+.

```bash
npm install
cp .env.example .env.local
```

**Postgres (use this for anything you ship).**

```bash
docker compose up -d
```

In `.env.local`, comment `SQLITE_PATH` and set:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/credits
```

Neon or Supabase: use their connection string and add `?sslmode=require` if the host requires TLS.

**SQLite (zero-ops demo).** Leave `DATABASE_URL` unset. `SQLITE_PATH=./data/ledger.sqlite` in `.env.example` is enough. Same SQL, same tests. Do not treat a single SQLite file as a multi-server production database.

For the local walkthrough, set `ALLOW_DEMO_CONTROLS=true` in `.env.local` before the commands below. That seeds the demo user with **100** credits and shows spend, race, and reset. The default is `false`: no seed, and those routes return 404. There is no login. Do not deploy the demo shell as a public app.

```bash
npm run db:migrate
npm run demo
```

`npm run demo` is the sealed fixture smoke. It signs a local `checkout.session.completed` for `pack_100`, grants those **100** credits to `DEMO_USER_ID` on the database you just migrated (`DATABASE_URL` when it is Postgres, otherwise `SQLITE_PATH`), then delivers that same event id again. The first delivery grants. The replay leaves the balance where it is. The signature is checked in-process with a built-in fixture secret. There is no Stripe API call and no card charge. Each run uses a new event id, so a second `npm run demo` grants another 100. The dev server does not need to be running.

The kit purchase is **$79 once** and has **no money-back window**. This command does not send a customer `charge.refunded` (that event is a full-pack clawback inside the ledger). See [docs/REFUND_GLOSSARY.md](docs/REFUND_GLOSSARY.md).

```bash
npm run dev
```

Open http://localhost:3000.

### Optional: a real test payment

Stripe CLI Checkout is the optional real test payment: Stripe’s hosted page and a test-mode card.

1. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli) and `stripe login`.
2. `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
3. Copy the CLI `whsec_...` into `STRIPE_WEBHOOK_SECRET`. That secret is not the one in the Dashboard. Restart `npm run dev`.
4. Put `sk_test_...` in `STRIPE_SECRET_KEY`.
5. Click **Buy** on a pack. Card `4242 4242 4242 4242`, any future expiry, any CVC, any postal code.
6. The balance increases when `checkout.session.completed` is processed (`payment_status=paid`), not when the success page loads.
7. Replay the same event. The balance must not move.

```bash
stripe events resend evt_...
```

Delayed payment methods (no instant capture) grant on `checkout.session.async_payment_succeeded` instead. `payment_intent.succeeded` is stored and ignored so it cannot grant a second time.

### Idempotency against the dev server

`npm run demo` already checks grant-once on the migrated database. To post the same kind of signed fixture at the running app, start `npm run dev` and set `STRIPE_WEBHOOK_SECRET` to a real `whsec_` value (generate one with `stripe listen`, or any secret you also put in `.env.local`):

```bash
npm run demo:webhook          # signed checkout.session.completed, +100 credits
npm run demo:webhook -- --replay   # same event id, balance unchanged
```

This posts to `NEXT_PUBLIC_APP_URL` (default `http://localhost:3000`). It does not charge a card. Checkout above is the hosted test payment.

### Watch the edge cases in the UI

- **Spend 10 (succeeds)** — reserve, then finalize. Balance drops by 10.
- **Spend 10 (provider fails)** — reserve, fake HTTP 500, release. Balance returns.
- **Last-credit race** — sets the balance to 10, fires two spends of 10. One succeeds, one is insufficient, balance ends at 0.
- **Reset demo balance to 100** — demo only. These four controls exist only when `ALLOW_DEMO_CONTROLS=true`.

`npm test` runs the same edges against SQLite files. It does not call Stripe. GitHub Actions runs the same suite on Node 20 and Node 22, on SQLite and on Postgres. Failures to check first: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Environment

**`x-ledger-secret` still bills `DEMO_USER_ID`.** Matching `LEDGER_API_SECRET` opens checkout, check, and track only. It does not select a customer and it is not multi-tenant auth. Leave `LEDGER_API_SECRET` unset. Copy `src/billing` and pass `userId` from your session.

See `.env.example`.

| Variable | Required | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | To open Checkout | `sk_test_...` while you are testing. Never commit a live key. |
| `STRIPE_WEBHOOK_SECRET` | To accept webhooks | `whsec_...` from `stripe listen` or the Dashboard endpoint. |
| `NEXT_PUBLIC_APP_URL` | Recommended | The only origin for Checkout `success_url` and `cancel_url`. Default `http://localhost:3000`. `x-forwarded-host` is ignored. |
| `DATABASE_URL` | Production | `postgres://` or `postgresql://`. Wins over SQLite when set. |
| `SQLITE_PATH` | Dev alternate | File path. Ignored when `DATABASE_URL` is Postgres. |
| `DEMO_USER_ID` | Demo | Balance owner for the shell. Default `demo_user`. |
| `ALLOW_DEMO_CONTROLS` | Demo | Default **false**. `true` seeds 100 credits and enables spend, race, reset, checkout, check, and track. Ignored when `NODE_ENV=production`. The shell is not production. |
| `LEDGER_API_SECRET` | Optional | When the demo flag is off, `POST /api/checkout`, `/api/credits/check`, and `/api/credits/track` accept header `x-ledger-secret`. It does not select a customer. Those routes still bill `DEMO_USER_ID`. Leave unset. |
| `CREDIT_HOLD_TTL_SECONDS` | Optional | How long a hold stays `held` before the reaper returns the credits. Default `900` (15 minutes). |
| `CREDIT_HOLD_REAP_INTERVAL_SECONDS` | Optional | Sleep between passes of `npm run holds:reap`. Default `60`. |
| `STRIPE_EXPECT_LIVEMODE` | Optional | `true` or `false` overrides the key prefix. Unset: `sk_live_` expects live events; every other key expects test events. |

The app creates tables on boot (`ensureSchema`, which runs the versioned migrations). It seeds the demo user (`seed:<userId>`) only when `ALLOW_DEMO_CONTROLS=true`. `npm run db:migrate` is the buyer path and runs those same migrations.

## Flows

### 1. Top-up

1. `POST /api/checkout` with `{ "packId": "pack_500" }` creates a Checkout Session in `mode: "payment"`.
2. Metadata and `payment_intent_data.metadata` are `{ userId, credits, packId }`. `client_reference_id` repeats `userId`. `credits` is written for the Dashboard. It is **not** the grant authority.
3. On `checkout.session.completed` with `payment_status=paid` (or `checkout.session.async_payment_succeeded`), the handler verifies the Stripe signature, checks livemode, inserts `stripe_events.id`, and grants inside **one** transaction.
4. The grant size is `getPack(packId).credits`. `session.amount_total` must equal that pack’s `amountCents`, and `currency` must match. A mismatch throws and **rolls the event insert back**. Fix the bug; Stripe retries (HTTP 500).
5. The same `event.id` again is a no-op. A second event for the same Checkout Session id does not grant again.
6. `livemode` is stored on `stripe_events` and on the grant row. A live event against a test key (or the reverse) is rejected before the event id is inserted.

### 2. Check

`check(userId, amount)` reads the spendable balance. It does not lock. Use it to disable a button. Do not treat it as the spend.

`POST /api/credits/check` with `{ "amount": 10 }` → `{ "ok": true, "balance": 100 }`.

### 3. Reserve, then finalize or release

Default policy: **bill the reserved amount**. Credits leave the balance at reserve time. `finalize` writes an audit row and does not change the balance. It does not accept a lesser actual-use amount. `release` puts the full reservation back. Partial token billing is not implemented.

```ts
const reserved = await reserve(db, { userId, amount: 10, idempotencyKey });
if (!reserved.ok) {
  // 402 — do not call the model
}
try {
  const output = await callYourModel();
  await finalize(db, userId, idempotencyKey);
  return output;
} catch {
  await release(db, userId, idempotencyKey);
  throw;
}
```

Idempotency is `(user_id, idempotency_key)`. Two users may use the same key. `reserve` returns `ok: true` only when that user’s key is still `held` and the amount matches. A replay of a released, finalized, or expired hold returns an error and does not spend again. A different amount on the same key returns `idempotency_amount_mismatch`. A key that failed only because the balance was short is **not** burned; retry it after a top-up.

`POST /api/credits/track` requires a client `idempotencyKey`. The server does not invent one. `track(userId, amount, idempotencyKey)` is the simpler at-most-once decrement for work you will not roll back. Prefer reserve around LLM calls.

The hard gate is one statement, after the user’s balance row is locked in the transaction:

```sql
UPDATE credit_balances
SET balance = balance - ?
WHERE user_id = ? AND balance >= ?
RETURNING balance
```

Zero rows means insufficient credits. Two connections cannot both take the last credit.

### 4. Failed or partial call

`POST /api/demo/generate` with `{ "credits": 10, "fail": true }` reserves 10, throws a fake provider 500, and releases. Net balance change: 0. Ledger kinds: `reserve` (status `released`) and `release`.

A successful call finalizes. Releasing a finalized reservation returns `already_finalized` and does not refund. Releasing twice is a replay and does not refund twice. Calling `reserve` again with that finished key returns an error. It is not a second free inference.

## Hold TTL and the reaper

Production **must** run:

```bash
npm run holds:reap
```

That process is the reaper. A crash after `reserve` and before `finalize` or `release` leaves credits `held` until it runs. Holds older than `CREDIT_HOLD_TTL_SECONDS` (default **900**, fifteen minutes) are expired: status becomes `expired`, an `expire` journal row is appended, and the reserved credits return to the balance.

`npm run holds:reap` is `scripts/reap-holds.ts`. It loops. `CREDIT_HOLD_REAP_INTERVAL_SECONDS` defaults to 60. `npm run holds:reap -- --once` expires one batch and exits. One call expires at most 200 holds. An expired key stays consumed (`hold_expired`). Start a new key for a new call.

`reserve` still calls `reapExpiredHolds` before each reservation, and the demo server calls it once on the first database request. Those calls are opportunistic. They are not the production strategy. `track` does not reap. This kit does not ship a scheduler.

Two reaper processes must not double-expire one hold. Postgres claims a batch with `FOR UPDATE SKIP LOCKED`. SQLite claims each hold with `UPDATE ... WHERE status = 'held'`, so only one process returns the credits.

## Refunds and disputes

Two words: the kit purchase has **no money-back window**. Below is a **customer** Stripe refund or dispute. See [docs/REFUND_GLOSSARY.md](docs/REFUND_GLOSSARY.md).

`charge.refunded` and `charge.dispute.created` claw back the **full pack**, not a prorated cent amount. The payment intent is read from `payment_intent`, then from `charge.payment_intent`, then by a stored charge id or Checkout session id. One `clawback` row is written per payment intent.

Open holds for that user are released in the **same** transaction, then the spendable balance is debited. A later reaper pass cannot put those credits back. The user is paused only when spendable cannot cover the pack after that release. Releasing a hold does not pause by itself when the balance covers the pack. A shortfall is journaled (`kind = shortfall`, delta 0) only when credits are actually missing. `reserve` and `track` then return `account_paused`.

A new grant does **not** clear the pause. Call `unpauseUser` from your admin path. The demo reset button does that. There is no dispute state machine.

A refund or dispute that arrives before the grant (or with no grant row yet) is stored as a **pending clawback** and returns HTTP 200 (`pending_clawback`) so Stripe stops. When the matching grant arrives, that pending row is applied in the **same** grant transaction. A second refund or dispute for the same payment intent is `already_clawed_back` once the clawback exists, or another `pending_clawback` while the grant is still missing. A payload with no payment intent, charge id, or Checkout session id is `ignored_unknown_payment_intent` (HTTP 200) because nothing can match a later grant.

If a dispute payload has only `charge` and no payment intent, the webhook loads the Charge and uses its payment intent. `charge.dispute.closed` does not give credits back when you win. There is no dispute state machine.

A Checkout event with no `userId` or `packId` is stored and ignored (`invalid_metadata`, HTTP 200). A paid session with no payment intent is HTTP 500 and is not granted, so a later refund can still find the grant.

Partial refunds are a full pack reversal. Proration is not implemented.

## Balance invariant

For each user, the spendable balance equals:

`sum(grant deltas) − finalized spends − held reserves − clawbacks`

Finalized spends are track amounts plus reserve rows with status `finalized`. Released and expired reserves are omitted, because those credits are already back. Release, expire, finalize, and shortfall journal rows are not added a second time. `balanceBreakdown` computes this and the tests require `expected === balance`.

## Pack catalog

Edit `src/billing/packs.ts`. Three packs ship in the kit:

| id | Credits | Test price |
|---|---:|---:|
| `pack_100` | 100 | $5 |
| `pack_500` | 500 | $20 |
| `pack_2000` | 2000 | $60 |

Prices are demo numbers. Change them in `src/billing/packs.ts`. Changing price (`amountCents`) or `currency` requires a **new packId**. Do not change price or currency on an existing packId in place. The webhook grants `pack.credits` only when `amount_total` and currency match that row. A mismatch rolls the grant back. Checkout uses `price_data` (no Dashboard Price objects required). There is no frozen pack snapshot.

## Tests

```bash
npm test
```

| Test | What it proves |
|---|---|
| `tests/webhook-idempotency.test.ts` | Signature verify. Same event twice does not double-grant. Two connections delivering one event grant once. Amount mismatch rolls back. `metadata.credits` is ignored. |
| `tests/out-of-order.test.ts` | `payment_intent.succeeded` does not grant. Unpaid `checkout.session.completed` does not grant. A later async success grants once. A late paid completion for that session does not grant again. |
| `tests/concurrent-race.test.ts` | Two processes, two SQLite connections, one balance of 10. One reserve wins. The demo race helper agrees. |
| `tests/failed-after-reserve.test.ts` | Provider failure releases. Second release does not refund. Finalize then release does not refund. `track` is at-most-once. |
| `tests/review-fixes.test.ts` | Fail-closed replay, per-user keys, reaper, refund/dispute clawback, livemode, currency, balance invariant. |
| `tests/phase-b.test.ts` | Pending clawback then grant, pause only on shortfall, NULL-key rejection, versioned migrate, concurrent reaper. |
| `tests/webhook-status.test.ts` | Signature and placeholder secret are HTTP 400. Livemode mismatch is HTTP 400. Amount mismatch is HTTP 500. Track requires a client key. Demo controls default off. Checkout origin is `NEXT_PUBLIC_APP_URL`. |
| `tests/shell-gates.test.ts` | Checkout, check, and track are 404 when the demo flag is off. A matching `x-ledger-secret` or the demo flag opens them. |
| `tests/postgres-concurrency.test.ts` | Skipped unless `DATABASE_URL` is Postgres. Two-process last-credit race and webhook replay on Postgres. |

The race test spawns two processes so the decrement is not just serialized on one connection’s mutex. `npm test` needs no Postgres and no Stripe network. The GitHub Actions `postgres` job sets `DATABASE_URL` and runs the same suite, including the Postgres race, on Node 20 and Node 22. The gate stays `UPDATE … AND balance >= ?`. It does not require `SERIALIZABLE`.

## Copy the billing module

`src/billing` does not import Next.js. Copy the folder. Wire your own user id (from your auth, not from the client body). Keep `ensureSchema` on boot or run `npm run db:migrate` (`migrate` in `src/billing/schema.ts`).

You can implement `Db` yourself and still use `ledger.ts`, `types.ts`, and `errors.ts`. Those files are part of this kit. They are not a separate license. Adapters in `src/billing/db.ts`, Checkout, webhook, and catalog are the same license as the rest of the tree: PolyForm Noncommercial 1.0.0, plus a Credit Ledger commercial grant for commercial production. See `LICENSE` and [docs/COMMERCIAL_GRANT.md](docs/COMMERCIAL_GRANT.md).

Delete the demo shell when it is no longer useful:

- `src/app` (balance page)
- `src/demo` (fake LLM, reset, race)
- `src/app/api/demo/*`
- `POST /api/credits/track` if you call `track` from your server instead

Routes in this repo attribute every call to `DEMO_USER_ID`, and only when `ALLOW_DEMO_CONTROLS=true` (or `x-ledger-secret` matches `LEDGER_API_SECRET` for checkout, check, and track). When you copy `src/billing`, the Checkout `userId` must come from your session. Never pass `DEMO_USER_ID` or any other env default as the customer. Ignore any `userId` in the JSON body.

## Failure modes

Short runbook for the cases below: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

| What happened | What the kit does |
|---|---|
| Bad or missing `Stripe-Signature` | HTTP 400. No database write. |
| Webhook secret missing or still `replace_me` | HTTP 400. |
| Livemode does not match the Stripe key | HTTP 400. The event id is not stored. Stripe stops. |
| Database down, amount or currency mismatch | HTTP 500. The `stripe_events` insert rolls back. Stripe retries. |
| Refund or dispute before the grant row exists | HTTP 200, event stored, `pending_clawback`. Stripe stops. The matching grant applies that clawback in the same transaction. |
| Refund or dispute with no payment intent, charge, or session id | HTTP 200, `ignored_unknown_payment_intent`. Nothing was stored to match a later grant. |
| Retry storm of the same `event.id` | Unique `stripe_events.id`. One grant. |
| `checkout.session.completed` and `async_payment_succeeded` for one session | Unique `checkout_session_id` on the grant row. One grant. |
| Unpaid `checkout.session.completed` | Event stored. No grant. The async success event can still grant. |
| `charge.refunded` or `charge.dispute.created` | Full-pack clawback, including a partial refund. Open holds are released in that transaction, then the balance is debited. Pause only when spendable cannot cover the pack. |
| Checkout, check, or track while the demo flag is off | HTTP 404, unless `x-ledger-secret` matches `LEDGER_API_SECRET`. |
| Balance too low | `reserve` / `track` return `insufficient_credits`. Demo spend routes use HTTP 402. |
| Provider error after reserve | `release` returns the credits. |
| Same key after release, finalize, or expiry | Error. Not `ok: true`. |
| Hold older than the TTL | Reaper returns the credits. |
| Two spends of the last credit | One `UPDATE ... WHERE balance >= ?` wins. |

Stripe retries non-2xx responses for days. Return 500 only when a retry could succeed (database blip, bug you are about to fix). Signature failures stay 400 so Stripe stops.

## Known limits

- `NODE_ENV=production` forces the demo shell closed, including seed, spend, race, reset, and the demo flag. Do not deploy `src/app` as your product.
- `x-ledger-secret` is not multi-tenant auth. It opens checkout, check, and track only, and it still uses `DEMO_USER_ID`. Copy `src/billing` and pass the user id from your session. Never take `userId` from the JSON body.
- A refund that arrives before its grant is a pending clawback and is applied when the grant arrives.
- Partial refunds claw back the whole pack. A won dispute does not return credits.
- Reserve replay matches user, key, and amount. There is no payload hash.
- The balance column is the spendable number. The journal explains it. It is not an event-sourced ledger.

## SQLite instead of Postgres

Postgres is the database to ship: one `DATABASE_URL`, row locks, more than one app server. SQLite is the documented alternate for a solo demo and for `npm test`. Set `SQLITE_PATH` and do not set a `postgres://` `DATABASE_URL`. The driver enables WAL and a 5 second busy timeout. The statements in `schema.ts` are the same text on both engines (`BIGINT`, `ON CONFLICT`, `RETURNING`).

If you run more than one Node process against one SQLite file, expect lock waits under load. Move to Postgres before you do that on purpose.

## Project layout

```
src/billing/     ledger, schema, Checkout, webhook, Postgres + SQLite adapters
src/app/         demo UI and HTTP routes
src/demo/        fake LLM and demo reset — not a product
src/server/      process-wide DB handle and demo user id
tests/           edge cases
scripts/         migrate, signed webhook fixture, hold reaper loop
docs/            free chapter, commercial grant, listing paste, troubleshooting, refund glossary, checksums
```

## Paid delta

Without a purchase, [LICENSE](LICENSE) is PolyForm Noncommercial 1.0.0 only (source-available; not an OSI-approved license). Paying for Credit Ledger buys the [Credit Ledger commercial grant](docs/COMMERCIAL_GRANT.md) for **one organization** and the **named tag**, plus the Polar zip `stripe-credit-ledger-kit-0.2.0.zip` (SHA-256 `2e6d6088f93a79c7b141982cb0c06e26eeb6ad28af5cc4135532a30677b734c5`). Legal seller: Suthirth Solutions, operating as yellowgram.

## License

Source-available under the PolyForm Noncommercial License 1.0.0. Claims: source-available = true. OSI open source = false. Copyright (c) 2026 yellowgram. The copyright holder is yellowgram. Seller is Suthirth solutions.

Commercial production use requires a paid **Credit Ledger commercial grant** for **Credit Ledger** (this repository is the Stripe credit ledger kit). One organization. Perpetual for the named tag delivered with that purchase. Current SKU price: **$79 once**. No resale and no republishing this kit, or a substantial portion of it, as a competing starter, boilerplate, template, theme, or course. Terms: [docs/COMMERCIAL_GRANT.md](docs/COMMERCIAL_GRANT.md). Public license text: `LICENSE`.

The zip Polar sells now is **0.2.0** (`stripe-credit-ledger-kit-0.2.0.zip`). The whole tree in that zip uses this fence, including `src/billing/ledger.ts`, `types.ts`, `errors.ts`, and the free chapter. There is no separate extract. The prior sold zip `v0.1.2` is withdrawn from the shelf. Anyone who already bought it keeps the rights for that zip. It is not resealed. Tags `v0.1.0` and `v0.1.1`, and their Release zips, are grandfathered history: rights already granted, and those artifacts are not resealed. They are not the current Polar file. What those artifacts granted is in the grant’s prior-distributions section and in [CHANGELOG.md](CHANGELOG.md).

No warranty. You are responsible for billing correctness in production. Not affiliated with Stripe, Autumn, or Metronome.

Contact: hello@yellowgram.dev · https://www.yellowgram.dev/credit-ledger

## Support

GitHub Issues on the public repository `yellowgram/stripe-credit-ledger-kit` for **60 days** from the purchase date. Best-effort, no SLA, capped at about two hours a week. Include the failing test name or a Stripe **test-mode** event id. Do not paste live secret keys, webhook signing secrets, or customer payment details. Contact: hello@yellowgram.dev.

Full boundary and the out-of-scope reply: [SUPPORT.md](SUPPORT.md). Vulnerability reports: [SECURITY.md](SECURITY.md). Purchase refund versus customer clawback: [docs/REFUND_GLOSSARY.md](docs/REFUND_GLOSSARY.md).

## Free chapter

[Stripe Credit Grants Are Invoice-Time](docs/stripe-credit-grants-are-invoice-time.md) — when to use Grants, this kind of ledger, Metronome, or Autumn. It is public on purpose. Do not paywall it.
