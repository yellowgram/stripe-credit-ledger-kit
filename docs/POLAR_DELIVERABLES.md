# Polar listing — Stripe credit ledger kit

Paste the sections below into the Polar product. Version **0.1.1**. Price **$79**. Auto-delivered digital good only. Polar is the storefront. It is not imported by this repository. Ledger behavior matches 0.1.0; 0.1.1 is the hygiene cut in [CHANGELOG.md](../CHANGELOG.md).

---

## Product name

Stripe credit ledger kit — $79

## Short description

Cloneable credit ledger for indie AI SaaS. Your Stripe. Your database. A real-time hard gate before the expensive call. Owned code you copy into the app you already have.

---

## What you get

- **Billing module** (`src/billing`). Pack catalog (100 / 500 / 2,000), Stripe Checkout metadata (`userId`, `credits`, `packId`; `credits` is not the grant authority), signature-checked idempotent webhooks, and `check` / `reserve` / `finalize` / `release` / `track`. Postgres and SQLite adapters. Copy this folder into your app. `ledger.ts`, `types.ts`, and `errors.ts` are also MIT (`src/billing/LICENSE.MIT`).
- **Demo shell** (`src/app`, `src/demo`). Balance page plus spend, race, and reset so you can watch the edges. Replace it. `NODE_ENV=production` forces the shell closed.
- **Tests** (`tests/`). Webhook idempotency, out-of-order events, last-credit races, provider failure after reserve, refund and dispute clawback, shell gates. `npm test` needs no Stripe network.
- **Free honesty chapter** (`docs/stripe-credit-grants-are-invoice-time.md`). When to use Stripe Credit Grants, this ledger, Metronome, or Autumn. It ships in the zip and stays public. Do not paywall it.
- **Hold reaper** (`scripts/reap-holds.ts`). `npm run holds:reap` returns credits from holds older than `CREDIT_HOLD_TTL_SECONDS` (default 15 minutes).
- **CI** (`.github/workflows/test.yml`). GitHub Actions runs the suite on Node 20 and Node 22, on SQLite and on Postgres.
- **Known limits**, written in the README. Production closes the demo shell. `x-ledger-secret` still bills `DEMO_USER_ID` (it is not multi-tenant auth). A refund that arrives before its grant is not applied to a later grant. Partial refunds claw back the whole pack. A won dispute does not return credits. Reserve replay matches user, key, and amount (no payload hash). The balance column is the spendable number, explained by the journal.

## Money path

Same contract as the README. Do not soften it in the listing.

- Grant size is the pack catalog when `amount_total` and `currency` match. `metadata.credits` is not authority. A mismatch rolls the event insert back and returns HTTP 500 so Stripe retries.
- Livemode must match the key (`sk_live_` expects live events; any other key expects test events). Optional `STRIPE_EXPECT_LIVEMODE` overrides that. A mismatch is HTTP 400 and the event id is not stored.
- A bad signature, a missing secret, or a placeholder secret is HTTP 400. A database failure is HTTP 500.
- Checkout `success_url` and `cancel_url` use `NEXT_PUBLIC_APP_URL` only. The request Host is ignored.
- A customer `charge.refunded` or dispute is a full-pack clawback inside the buyer's ledger. It is not a refund of this $79 purchase. See `docs/REFUND_GLOSSARY.md`.

## What you do not get

- A hosted SaaS, wallet, or dashboard that yellowgram operates. Buyers run the code on their own Stripe account and their own database.
- An Autumn or Metronome clone. No plans, entitlements, rollovers, dimensional pricing, or Stripe Connect on this path.
- Live chat, a call, an SLA, or support after **60 days** of GitHub Issues.
- Polar inside the kit. No Polar SDK, Polar webhooks, or Polar customer portal.
- A chat app, auth product, or full AI SaaS boilerplate.
- Implementation services, Lock, or Audit. This Polar product is the download only.

## How delivery works

Polar delivers one zip: the **v0.1.1** source tree from the GitHub Release asset `stripe-credit-ledger-kit-0.1.1.zip`.

Unzip it (or clone the `v0.1.1` tag). You own that tree. There is no account to activate and no hosted app to log into. Start at `BUYER_START_HERE.md`.

The zip omits `node_modules`, secret env files (`.env`, `.env.local`), SQLite databases, and `.git`. It includes `.env.example`. SHA-256 of the Release asset is in the GitHub Release notes and in `docs/CHECKSUMS.md` (the packed copy of that file points at the Release notes, because the digest cannot sit inside the bytes it describes). Verify with `sha256sum`.

## Setup

Node.js 20+.

```bash
npm install && cp .env.example .env.local && npm run db:migrate && npm run dev
```

Open http://localhost:3000.

That one-liner uses the SQLite demo (`SQLITE_PATH` in `.env.example`). For anything you ship, use Postgres: `docker compose up -d`, set `DATABASE_URL`, and comment `SQLITE_PATH`. Put `sk_test_...` and the Stripe CLI `whsec_...` in `.env.local`. Set `ALLOW_DEMO_CONTROLS=true` before migrate if you want the seeded balance and the spend, race, and reset buttons. The default is `false`. The rest is in `README.md`.

## Support

GitHub Issues for **60 days** from the purchase date. Best-effort, no SLA, capped at about two hours a week. Include the failing test name or a Stripe **test-mode** event id. Do not paste live secret keys, webhook signing secrets, or customer payment details. Full text, the out-of-scope reply, and the issue template rules are in `SUPPORT.md`.

The repository is private. After purchase the maintainer sends a GitHub collaborator invite (Read) so you can open Issues. Polar messages are not the support queue. `SECURITY.md` is the private vulnerability path. Do not put zero-days in Issues.

## Refunds

The kit states no money-back window for this $79 purchase. “Refunds” in the README are Stripe `charge.refunded` on a **customer’s** credit pack (full-pack clawback inside the ledger, including the holes in `docs/REFUND_GLOSSARY.md`). That behavior does not refund the kit download.

## License

One organization. Use and modify the kit for that organization’s own products. No resale, redistribution, sublicensing, or republishing the kit (or a substantial portion of it) as a competing starter, boilerplate, template, theme, or course. No hosted service whose purpose is to hand third parties this kit. No warranty. You are responsible for billing correctness in production. Not affiliated with Stripe, Autumn, or Metronome. Full text: `LICENSE`.

---

## CoS notes (do not paste into the public listing)

- Attach `stripe-credit-ledger-kit-0.1.1.zip` from GitHub Release **v0.1.1** as the Polar file. The repository is private, so the release asset URL is not a public download link. Paste this SHA-256 into the Polar delivery note: `491885f71fe36ca8b224c6c34e339a7cef24c72e817e9262a031a4723b5dc8c7`. `docs/CHECKSUMS.md` on the default branch records the same digest. The copy of that file inside the zip points at the Release notes.
- Set Polar’s refund toggle to **none**. The kit states no money-back window. A platform default that still offers a refund contradicts `docs/REFUND_GLOSSARY.md`.
- **Issues access (you execute this):** after purchase, invite the buyer’s GitHub account as a collaborator with **Read** on `yellowgram/stripe-credit-ledger-kit` (open Issues, no push). An equivalent private mirror is allowed only if you actually read those Issues. Polar direct messages are not the 60-day queue. The kit documents this path in `SUPPORT.md`; it does not send the invite.
- Enable GitHub private vulnerability reporting so `SECURITY.md`’s advisory form works. Buyers must not put zero-days in Issues.
- The free chapter still ends with `[WAITLIST_URL]` and a soft “would you pay ~$79” ask. Soft-WTP is off for this listing. Replace or remove that line before you treat the chapter as final public copy. Do not turn on a waitlist.
- No screenshots, logo, or cover image ship in the repo.
- Leave Polar out of the application code. Do not add a Polar SDK. No Lock, Audit, or implementation SKU on this product.
