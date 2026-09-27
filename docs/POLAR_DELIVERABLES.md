# Polar listing — Stripe credit ledger kit

Listing paste for the Polar product. Version **0.1.2** (license fence). Price **$79 once**. Auto-delivered digital good only. Polar is the storefront. It is not imported by this repository. Ledger behavior matches 0.1.0 and 0.1.1. The license change is [CHANGELOG.md](../CHANGELOG.md).

**Hold.** Do not paste this file into Polar from the license-fence pull request. Do not replace the Polar file, do not retag, and do not reseal `v0.1.0` or `v0.1.1`. Tag `v0.1.2` and its zip come after freeze, then land. Product name for the grant is **Credit Ledger** (kit title: Stripe credit ledger kit). Seller: Suthirth solutions. Contact: hello@yellowgram.dev.

---

## Product name

Credit Ledger — Stripe credit ledger kit — $79 once

## Short description

Cloneable credit ledger for indie AI SaaS. Your Stripe. Your database. A real-time hard gate before the expensive call. Owned code you copy into the app you already have.

---

## What you get

- **Billing module** (`src/billing`). Pack catalog (100 / 500 / 2,000), Stripe Checkout metadata (`userId`, `credits`, `packId`; `credits` is not the grant authority), signature-checked idempotent webhooks, and `check` / `reserve` / `finalize` / `release` / `track`. Postgres and SQLite adapters. Copy this folder into your app. From 0.1.2 the whole folder is the same license as the rest of the kit (see License below). There is no separate extract.
- **Demo shell** (`src/app`, `src/demo`). Balance page plus spend, race, and reset so you can watch the edges. Replace it. `NODE_ENV=production` forces the shell closed.
- **Tests** (`tests/`). Webhook idempotency, out-of-order events, last-credit races, provider failure after reserve, refund and dispute clawback, shell gates. `npm test` needs no Stripe network.
- **Free honesty chapter** (`docs/stripe-credit-grants-are-invoice-time.md`). When to use Stripe Credit Grants, this ledger, Metronome, or Autumn. It ships in the zip and stays public. Do not paywall it. From 0.1.2 it uses the kit license. It does not ask for a waitlist or a price.
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

Do not attach a new Polar file in the license-fence change. There is no git tag `v0.1.2` and no GitHub Release asset yet.

After freeze and land, Polar delivers one zip: the **v0.1.2** source tree from the GitHub Release asset `stripe-credit-ledger-kit-0.1.2.zip`. Until that asset exists, the sealed delivery remains tag **v0.1.1** / `stripe-credit-ledger-kit-0.1.1.zip`. Do not reseal `v0.1.0` or `v0.1.1`.

Unzip the zip named on the order (or clone that tag). You own that tree. There is no account to activate and no hosted app to log into. Start at `BUYER_START_HERE.md`.

The zip omits `node_modules`, secret env files (`.env`, `.env.local`), SQLite databases, and `.git`. It includes `.env.example`. SHA-256 of the Release asset is in the GitHub Release notes and in `docs/CHECKSUMS.md` (the packed copy of that file points at the Release notes, because the digest cannot sit inside the bytes it describes). Verify with `sha256sum`.

## Setup

Node.js 20+.

```bash
npm install && cp .env.example .env.local && npm run db:migrate && npm run dev
```

Open http://localhost:3000.

That one-liner uses the SQLite demo (`SQLITE_PATH` in `.env.example`). For anything you ship, use Postgres: `docker compose up -d`, set `DATABASE_URL`, and comment `SQLITE_PATH`. Put `sk_test_...` and the Stripe CLI `whsec_...` in `.env.local`. Set `ALLOW_DEMO_CONTROLS=true` before migrate if you want the seeded balance and the spend, race, and reset buttons. The default is `false`. The rest is in `README.md`.

## Support

GitHub Issues for **60 days** from the purchase date. Best-effort, no SLA, capped at about two hours a week. Include the failing test name or a Stripe **test-mode** event id. Do not paste live secret keys, webhook signing secrets, or customer payment details. Contact: hello@yellowgram.dev. Full text, the out-of-scope reply, and the issue template rules are in `SUPPORT.md`.

The repository is private. After purchase the maintainer sends a GitHub collaborator invite (Read) so you can open Issues. Polar messages are not the support queue. `SECURITY.md` is the private vulnerability path. Do not put zero-days in Issues.

## Refunds

The kit states no money-back window for this $79 purchase. “Refunds” in the README are Stripe `charge.refunded` on a **customer’s** credit pack (full-pack clawback inside the ledger, including the holes in `docs/REFUND_GLOSSARY.md`). That behavior does not refund the kit download.

## License

Source-available under PolyForm Noncommercial 1.0.0. Claims: source-available = true. OSI open source = false. Copyright (c) 2026 yellowgram. Seller: Suthirth solutions. Contact: hello@yellowgram.dev.

Commercial production use requires a paid Suthirth Commercial Grant for Credit Ledger (Stripe credit ledger kit): one organization, perpetual for the named tag delivered with that purchase. Current SKU: $79 once (Polar product `93a844f7-d48e-414f-ac0c-adf905ffef46`). You may not redistribute, resell, or republish the kit (or a substantial portion of it) as a competing starter, boilerplate, template, theme, or course, and you may not offer a download whose purpose is to give third parties this kit. From 0.1.2 the whole tree uses this fence, including `src/billing` and the free chapter. No warranty. You are responsible for billing correctness in production. Not affiliated with Stripe, Autumn, or Metronome. Full text: `LICENSE` and `docs/COMMERCIAL_GRANT.md`.

Tags `v0.1.0` and `v0.1.1` shipped with a narrower carve-out and are not resealed. See `docs/COMMERCIAL_GRANT.md` (prior distributions) and `CHANGELOG.md`.

---

## CoS notes (do not paste into the public listing)

- **Hold — do not edit Polar from this change.** Do not attach a new file, do not retag, and do not reseal `v0.1.0` or `v0.1.1`. The sealed `v0.1.1` asset stays `stripe-credit-ledger-kit-0.1.1.zip`, SHA-256 `a9bc28d82f673afc0eafbd1c3ad20c3047e95c7eb71ad70dd96f4b88473d41a8` (commit `c633584`). `v0.1.0` stays SHA-256 `aa558100add2a3585190656ab1eb4b217cda6fafe596eaafe0dd02f9a9a33d94`. After freeze and land, attach `stripe-credit-ledger-kit-0.1.2.zip` from tag `v0.1.2` and paste that new digest. Do not invent the 0.1.2 digest here. The repository is private, so a release asset URL is not a public download link.
- Set Polar’s refund toggle to **none**. The kit states no money-back window. A platform default that still offers a refund contradicts `docs/REFUND_GLOSSARY.md`.
- **Issues access (you execute this):** after purchase, invite the buyer’s GitHub account as a collaborator with **Read** on `yellowgram/stripe-credit-ledger-kit` (open Issues, no push). An equivalent private mirror is allowed only if you actually read those Issues. Polar direct messages are not the 60-day queue. The kit documents this path in `SUPPORT.md`; it does not send the invite.
- Enable GitHub private vulnerability reporting so `SECURITY.md`’s advisory form works. Buyers must not put zero-days in Issues.
- Soft-WTP stays off. The free chapter does not contain a waitlist URL or a “would you pay” ask. Do not add coupons, cold invoices, or a waitlist.
- No screenshots, logo, or cover image ship in the repo.
- Leave Polar out of the application code. Do not add a Polar SDK. No Lock, Audit, or implementation SKU on this product.
