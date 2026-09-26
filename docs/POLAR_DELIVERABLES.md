# Polar listing — Stripe credit ledger kit

Paste the sections below into the Polar product. Version **0.1.0**. Price **$79**. Auto-delivered digital good only. Polar is the storefront. It is not imported by this repository.

---

## Product name

Stripe credit ledger kit — $79

## Short description

Cloneable credit ledger for indie AI SaaS. Your Stripe. Your database. A real-time hard gate before the expensive call. Owned code you copy into the app you already have.

---

## What you get

- **Billing module** (`src/billing`). Pack catalog (100 / 500 / 2,000), Stripe Checkout (`userId`, `credits`, `packId`), signature-checked idempotent webhooks, and `check` / `reserve` / `finalize` / `release` / `track`. Postgres and SQLite adapters. Copy this folder into your app. `ledger.ts`, `types.ts`, and `errors.ts` are also MIT (`src/billing/LICENSE.MIT`).
- **Demo shell** (`src/app`, `src/demo`). Balance page plus spend, race, and reset so you can watch the edges. Replace it. `NODE_ENV=production` forces the shell closed.
- **Tests** (`tests/`). Webhook idempotency, out-of-order events, last-credit races, provider failure after reserve, refund and dispute clawback, shell gates. `npm test` needs no Stripe network.
- **Free honesty chapter** (`docs/stripe-credit-grants-are-invoice-time.md`). When to use Stripe Credit Grants, this ledger, Metronome, or Autumn. It ships in the zip and stays public. Do not paywall it.
- **Hold reaper** (`scripts/reap-holds.ts`). `npm run holds:reap` returns credits from holds older than `CREDIT_HOLD_TTL_SECONDS` (default 15 minutes).
- **CI** (`.github/workflows/test.yml`). GitHub Actions runs the suite on SQLite and on Postgres.
- **Known limits**, written in the README. Production closes the demo shell. `x-ledger-secret` still bills `DEMO_USER_ID`. A refund that arrives before its grant is not applied to a later grant. Partial refunds claw back the whole pack. A won dispute does not return credits. Reserve replay matches user, key, and amount (no payload hash). The balance column is the spendable number, explained by the journal.

## What you do not get

- A hosted SaaS, wallet, or dashboard that yellowgram operates. Buyers run the code on their own Stripe account and their own database.
- An Autumn or Metronome clone. No plans, entitlements, rollovers, dimensional pricing, or Stripe Connect on this path.
- Live chat, a call, an SLA, or support after **60 days** of GitHub Issues.
- Polar inside the kit. No Polar SDK, Polar webhooks, or Polar customer portal.
- A chat app, auth product, or full AI SaaS boilerplate.
- Implementation services, Lock, or Audit. This Polar product is the download only.

## How delivery works

Polar delivers one zip: the **v0.1.0** source tree from the GitHub Release asset `stripe-credit-ledger-kit-0.1.0.zip`.

Unzip it (or clone the `v0.1.0` tag). You own that tree. There is no account to activate and no hosted app to log into.

The zip omits `node_modules`, secret env files (`.env`, `.env.local`), SQLite databases, and `.git`. It includes `.env.example`.

## Setup

Node.js 20+.

```bash
npm install && cp .env.example .env.local && npm run db:migrate && npm run dev
```

Open http://localhost:3000.

That one-liner uses the SQLite demo (`SQLITE_PATH` in `.env.example`). For anything you ship, use Postgres: `docker compose up -d`, set `DATABASE_URL`, and comment `SQLITE_PATH`. Put `sk_test_...` and the Stripe CLI `whsec_...` in `.env.local`. Set `ALLOW_DEMO_CONTROLS=true` before migrate if you want the seeded balance and the spend, race, and reset buttons. The default is `false`. The rest is in `README.md`.

## Support

GitHub Issues for **60 days** from the purchase date. Best-effort, no SLA, capped at about two hours a week. Include the failing test name or a Stripe **test-mode** event id. Do not paste live secret keys, webhook signing secrets, or customer payment details.

## Refunds

The kit states no money-back window for this $79 purchase. “Refunds” in the README are Stripe `charge.refunded` on a **customer’s** credit pack (full-pack clawback inside the ledger). That behavior does not refund the kit download.

## License

One organization. Use and modify the kit for that organization’s own products. No resale, redistribution, sublicensing, or republishing the kit (or a substantial portion of it) as a competing starter, boilerplate, template, theme, or course. No hosted service whose purpose is to hand third parties this kit. No warranty. You are responsible for billing correctness in production. Not affiliated with Stripe, Autumn, or Metronome. Full text: `LICENSE`.

---

## CoS notes (do not paste into the public listing)

- Attach `stripe-credit-ledger-kit-0.1.0.zip` from GitHub Release **v0.1.0** as the Polar file. The repository is private, so the release asset URL is not a public download link.
- Confirm Polar’s refund toggle. The README does not promise a purchase refund.
- Grant buyers a way to open GitHub Issues for 60 days. The kit repo is private.
- The free chapter still ends with `[WAITLIST_URL]` and a soft “would you pay ~$79” ask. Soft-WTP is off for this listing. Replace or remove that line before you treat the chapter as final public copy.
- No screenshots, logo, or cover image ship in the repo.
- Leave Polar out of the application code. Do not add a Polar SDK.
