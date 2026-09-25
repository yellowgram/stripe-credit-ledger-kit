# Stripe credit ledger kit

Cloneable credit ledger for indie AI SaaS. **Your** Stripe. **Your** database. A real-time hard gate before the expensive call.

Buy a credit pack in Stripe Checkout → webhook grants a balance → `check` / `reserve` → `finalize` or `release` → a small balance page. This repository is that billing module plus a thin demo shell. It is not a chat app, not a hosted wallet, and not Stripe Credit Grants.

yellowgram sells the kit on Polar. Polar is not in this codebase. Your customers pay on your Stripe account. We never hold their balances.

## Use Autumn or Metronome instead when…

Do not keep this ledger if a hosted product fits the job better.

- **You do not need a hard gate.** Basic Stripe Billing Credits (Credit Grants) apply when the invoice finalizes. Customers can spend past the grant mid-cycle. Stripe’s own comparison says that is invoice-time, and that real-time prepaid drawdown is on Metronome. If “they owe us at the end of the month” is acceptable, use [Meters + Credit Grants](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits) and stop. Read [the free chapter](docs/stripe-credit-grants-are-invoice-time.md).
- **You do not want to own failure modes.** Duplicate webhooks, out-of-order events, two requests for the last credit, and a provider 500 after you already decremented are your bugs now. If you want hosted `check` / `track` and you will accept a control plane, start on [Autumn](https://useautumn.com). Free tier, then a real bill — confirm the live pricing page.
- **You need Stripe’s real-time prepaid platform.** Dimensional pricing, commits, burndown, payment-gated credit release: [Metronome](https://docs.stripe.com/billing/how-metronome-works-with-stripe). Startup pricing is a percent of billing volume plus ingest fees — confirm [the live page](https://metronome.com/pricing). Stripe’s compare table lists **Connect: not supported** on the Metronome column.
- **You need plans, entitlements, rollovers, or multi-feature credit systems.** That is a control plane (Autumn or Metronome), not three SQL tables.
- **You need Stripe Connect** for this billing path. This kit is not Connect. Metronome’s Connect cell is “not supported” in Stripe’s docs. A DIY ledger you extend, or an Autumn-class product, is the usual fork.
- **You wanted a full AI SaaS boilerplate** (chat, streaming, auth, product chrome). This repo will feel unfinished on purpose. Copy `src/billing` into the app you already have.

Stay if you want owned Postgres (or SQLite) on your Stripe Checkout, a hard stop at zero, and tests for the edges above.

## What you get

| Piece | Where |
|---|---|
| Pack catalog (100 / 500 / 2,000) | `src/billing/packs.ts` |
| Checkout Session (`userId`, `credits`, `packId`) | `src/billing/checkout.ts` |
| Webhook: signature check + idempotent `stripe_events` | `src/billing/webhook.ts` |
| `check`, `reserve`, `finalize`, `release`, `track` | `src/billing/ledger.ts` (MIT extract) |
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

```bash
npm run db:migrate
npm run dev
```

Open http://localhost:3000. The demo user starts at **100** credits. There is no login. Every button on that page spends `DEMO_USER_ID`. Do not deploy the demo shell as a public app.

### Take a real test payment

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

### Idempotency without the CLI

With the dev server running and `STRIPE_WEBHOOK_SECRET` set to a real `whsec_` value (generate one with `stripe listen`, or any secret you also put in `.env.local`):

```bash
npm run demo:webhook          # signed checkout.session.completed, +100 credits
npm run demo:webhook -- --replay   # same event id, balance unchanged
```

This fixture is local. It does not charge a card. Use Checkout when you want to see Stripe’s hosted page.

### Watch the edge cases in the UI

- **Spend 10 (succeeds)** — reserve, then finalize. Balance drops by 10.
- **Spend 10 (provider fails)** — reserve, fake HTTP 500, release. Balance returns.
- **Last-credit race** — sets the balance to 10, fires two spends of 10. One succeeds, one is insufficient, balance ends at 0.
- **Reset demo balance to 100** — demo only. Turn it off with `ALLOW_DEMO_CONTROLS=false`.

`npm test` runs the same edges against SQLite files. It does not call Stripe.

## Environment

See `.env.example`.

| Variable | Required | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | To open Checkout | `sk_test_...` while you are testing. Never commit a live key. |
| `STRIPE_WEBHOOK_SECRET` | To accept webhooks | `whsec_...` from `stripe listen` or the Dashboard endpoint. |
| `NEXT_PUBLIC_APP_URL` | Recommended | Success and cancel URLs. Default `http://localhost:3000`. |
| `DATABASE_URL` | Production | `postgres://` or `postgresql://`. Wins over SQLite when set. |
| `SQLITE_PATH` | Dev alternate | File path. Ignored when `DATABASE_URL` is Postgres. |
| `DEMO_USER_ID` | Demo | Balance owner for the shell. Default `demo_user`. |
| `ALLOW_DEMO_CONTROLS` | Demo | `false` disables reset and the race button. |

The app creates tables on boot (`ensureSchema`) and seeds the demo user once (`seed:<userId>`). `npm run db:migrate` does the same without starting Next.js.

## Flows

### 1. Top-up

1. `POST /api/checkout` with `{ "packId": "pack_500" }` creates a Checkout Session in `mode: "payment"`.
2. Metadata and `payment_intent_data.metadata` are `{ userId, credits, packId }`. `client_reference_id` repeats `userId`. `credits` is the catalog value, not a client-supplied number.
3. On `checkout.session.completed` with `payment_status=paid` (or `checkout.session.async_payment_succeeded`), the handler verifies the Stripe signature, inserts `stripe_events.id`, and grants inside **one** transaction.
4. The same `event.id` again is a no-op. A second event for the same Checkout Session id does not grant again.
5. `credits` must match the pack in `src/billing/packs.ts`. A mismatch throws and **rolls the event insert back** so you notice. Fix the bug; Stripe will retry.

### 2. Check

`check(userId, amount)` reads the spendable balance. It does not lock. Use it to disable a button. Do not treat it as the spend.

`POST /api/credits/check` with `{ "amount": 10 }` → `{ "ok": true, "balance": 100 }`.

### 3. Reserve, then finalize or release

Default policy: **bill the reserved amount**. Credits leave the balance at reserve time. `finalize` writes an audit row and does not change the balance. `release` puts the full reservation back. Partial token billing is not implemented; change `finalize` if you need it.

```ts
const reserved = await reserve(db, { userId, amount: 10, idempotencyKey });
if (!reserved.ok) {
  // 402 — do not call the model
}
try {
  const output = await callYourModel();
  await finalize(db, idempotencyKey);
  return output;
} catch {
  await release(db, idempotencyKey);
  throw;
}
```

The same reserve key returns the existing hold and does not decrement again. A key that failed only because the balance was short is **not** burned; retry it after a top-up. A key that reserved successfully stays at-most-once.

`track(userId, amount, idempotencyKey)` is the simpler at-most-once decrement for work you will not roll back. Prefer reserve around LLM calls.

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

A successful call finalizes. Releasing a finalized reservation returns `already_finalized` and does not refund. Releasing twice is a replay and does not refund twice.

## Pack catalog

Edit `src/billing/packs.ts`. Three packs ship in the kit:

| id | Credits | Test price |
|---|---:|---:|
| `pack_100` | 100 | $5 |
| `pack_500` | 500 | $20 |
| `pack_2000` | 2000 | $60 |

Prices are demo numbers. Change them. The webhook refuses a grant whose `credits` do not match the pack id, so update both together. Checkout uses `price_data` (no Dashboard Price objects required).

## Tests

```bash
npm test
```

| Test | What it proves |
|---|---|
| `tests/webhook-idempotency.test.ts` | Signature verify. Same event twice does not double-grant. Two connections delivering one event grant once. Pack mismatch rolls back. |
| `tests/out-of-order.test.ts` | `payment_intent.succeeded` does not grant. Unpaid `checkout.session.completed` does not grant. A later async success grants once. A late paid completion for that session does not grant again. |
| `tests/concurrent-race.test.ts` | Two OS threads, two SQLite connections, one balance of 10. One reserve wins. The demo race helper agrees. |
| `tests/failed-after-reserve.test.ts` | Provider failure releases. Second release does not refund. Finalize then release does not refund. `track` is at-most-once. |

The race test spawns two processes so the decrement is not just serialized on one connection’s mutex. `npm test` needs no Postgres and no Stripe network.

## Copy the billing module

`src/billing` does not import Next.js. Copy the folder. Wire your own user id (from your auth, not from the client body). Keep `ensureSchema` on boot or run the statements in `src/billing/schema.ts` from your migrator.

Delete the demo shell when it is no longer useful:

- `src/app` (balance page)
- `src/demo` (fake LLM, reset, race)
- `src/app/api/demo/*`
- `POST /api/credits/track` if you call `track` from your server instead

The MIT extract is `src/billing/errors.ts`, `src/billing/types.ts`, and `src/billing/ledger.ts`, plus `src/billing/LICENSE.MIT`. You can drop that slice into another service and implement `Db` yourself. The adapters in `src/billing/db.ts`, Checkout, webhook, and catalog stay under the no-resale license in `LICENSE`.

Routes in this repo attribute every call to `DEMO_USER_ID`. In your app, ignore any `userId` in the JSON body.

## Failure modes

| What happened | What the kit does |
|---|---|
| Bad or missing `Stripe-Signature` | HTTP 400. No database write. |
| Webhook secret still `replace_me` | HTTP 400. |
| Database down mid-webhook | HTTP 500. The `stripe_events` insert rolls back. Stripe retries. A later success grants once. |
| Retry storm of the same `event.id` | Unique `stripe_events.id`. One grant. |
| `checkout.session.completed` and `async_payment_succeeded` for one session | Unique `checkout_session_id` on the grant row. One grant. |
| Unpaid `checkout.session.completed` | Event stored. No grant. The async success event can still grant. |
| Metadata missing or credits ≠ catalog | HTTP 500, transaction rolled back (including the event row) so the mistake stays loud. |
| Balance too low | `reserve` / `track` return `insufficient_credits`. Demo spend routes use HTTP 402. |
| Provider error after reserve | `release` returns the credits. |
| Two spends of the last credit | One `UPDATE ... WHERE balance >= ?` wins. |

Stripe retries non-2xx responses for days. Return 500 only when a retry could succeed (database blip, bug you are about to fix). Signature failures stay 400 so Stripe stops.

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
scripts/         migrate, signed webhook fixture
docs/            free chapter (invoice-time grants vs this ledger)
```

## License

Single organization. Use and modify it for your own products. **No resale** and no republishing this kit as a competing starter, boilerplate, template, or course. See `LICENSE`.

`src/billing/ledger.ts` (with `types.ts` and `errors.ts`) is also MIT so you can copy the gate without the kit license following it. See `src/billing/LICENSE.MIT`.

No warranty. You are responsible for billing correctness in production. Not affiliated with Stripe, Autumn, or Metronome.

## Support

GitHub Issues for **60 days** from the purchase date. Best-effort, no SLA, capped at about two hours a week. Include the failing test name or a Stripe **test-mode** event id. Do not paste live secret keys, webhook signing secrets, or customer payment details.

## Free chapter

[Stripe Credit Grants Are Invoice-Time](docs/stripe-credit-grants-are-invoice-time.md) — when to use Grants, this kind of ledger, Metronome, or Autumn. It is public on purpose. Do not paywall it.
