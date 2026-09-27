# Buyer start here

Kit **0.1.2**. Polar delivers `stripe-credit-ledger-kit-0.1.2.zip` (tag `v0.1.2`, commit `593a2d1`, SHA-256 `b63b1c834646030c0e201db9a0b2240cb1b8ac547fb1fb610794431491955832`). Same ledger behavior as 0.1.0 and 0.1.1. Polar is not in the app. Verify that zip in [docs/CHECKSUMS.md](docs/CHECKSUMS.md). `v0.1.0` and `v0.1.1` are grandfathered history. They are not the file Polar sells now.

License: source-available under PolyForm Noncommercial 1.0.0. OSI open source = false. The public license is not MIT. Commercial production use needs a **Suthirth Commercial Grant** from Suthirth solutions for **Credit Ledger** (Stripe credit ledger kit): one organization, perpetual for the named tag you purchased. Current SKU: **$79 once**. No money-back window. Soft-WTP stays off. No resale. Copyright (c) 2026 yellowgram. [LICENSE](LICENSE) · [docs/COMMERCIAL_GRANT.md](docs/COMMERCIAL_GRANT.md). Contact: hello@yellowgram.dev.

The zip you bought, **0.1.2**, uses the license above for the whole kit, including `src/billing` and the free chapter. There is no MIT extract. `v0.1.0` and `v0.1.1` stay as shipped (grandfathered; not resealed).

## Not multi-tenant auth

`x-ledger-secret` / `LEDGER_API_SECRET` is not customer auth. It only opens demo checkout, check, and track, and those routes still bill `DEMO_USER_ID` (default `demo_user`). Every caller shares one balance. A `userId` in the JSON body is ignored. Leave `LEDGER_API_SECRET` unset.

## Unzip to a green test

Node.js 20+.

```bash
npm install
cp .env.example .env.local
```

Local demo only: set `ALLOW_DEMO_CONTROLS=true` in `.env.local`. The default is `false`. `NODE_ENV=production` forces the shell closed even if the flag is true. Then:

```bash
npm run db:migrate
npm test
```

`npm test` is offline SQLite. It does not call Stripe and does not need the demo flag. CI runs the same suite on Node 20 and 22, SQLite and Postgres.

After migrate, `npm run demo` is the sealed fixture smoke: a signed `pack_100` grant, then a replay of that same event. No Stripe network and no card charge. Each run is a new event id.

Optional UI: `npm run dev`, then http://localhost:3000. The first migrate with the flag on, or the first request that opens the database with the flag on, grants 100 credits once (`seed:<DEMO_USER_ID>`). Later requests do not refill; the reset control does. Try spend, fail→release, last-credit race, and reset. Turn the flag off when you are done looking. Stripe CLI Checkout (optional real test payment) and `npm run demo:webhook` are in the [README](README.md). `npm test` does not need migrate.

Ship on Postgres, not a shared SQLite file: `docker compose up -d`, set `DATABASE_URL`, comment `SQLITE_PATH`.

## Walk away, or read the limits

Hard gate not required, or you want hosted `check` / `track`, plans, entitlements, rollovers, or Connect: [Use Autumn or Metronome instead](README.md#use-autumn-or-metronome-instead-when) and the [free chapter](docs/stripe-credit-grants-are-invoice-time.md). Do not open an Issue to turn this kit into that product.

[Known limits](README.md#known-limits): refund-before-grant is not applied later; a partial refund claws the whole pack; a won dispute does not return credits.

## Graduation — you own the process

Copy `src/billing` into your app. `userId` comes from your session. Do not ship `src/app`, `DEMO_USER_ID`, a body `userId`, or `x-ledger-secret` as the product. Reserve → work → finalize or release on every paid path in **your** app. The demo buttons are not that integration.

Production babysitting is yours, not a hosted loop:

- Run `npm run holds:reap` (default 60s loop, or cron `npm run holds:reap -- --once`). You own that process. The demo server reaps once on the first database request, and `reserve` reaps before each reservation. Neither is the loop. Default TTL is 900s. One pass expires at most 200 holds. A crash after `reserve`, with nothing calling the reaper, leaves credits `held`. See [troubleshooting](docs/TROUBLESHOOTING.md).
- A clawback pauses the user if it released an open hold, or if the balance could not cover the pack (`shortfall` is journaled only in that second case). A new grant does not unpause. Call `unpauseUser` from your admin path. Demo reset is not that path.

## Support boundary

[SUPPORT.md](SUPPORT.md): GitHub Issues on the public repository `yellowgram/stripe-credit-ledger-kit` for **60 days** from purchase, best-effort, **no SLA**, about two hours a week. Repro required. No live secrets. No collaborator invite. Polar messages are not the queue. Vulnerability reports go to [SECURITY.md](SECURITY.md), not Issues.

[Troubleshooting](docs/TROUBLESHOOTING.md) · [Refund glossary](docs/REFUND_GLOSSARY.md) (no money-back on the zip; customer `charge.refunded` is a full-pack clawback) · [Listing](docs/POLAR_DELIVERABLES.md) · [Changelog](CHANGELOG.md) · [License](LICENSE) · [Commercial grant](docs/COMMERCIAL_GRANT.md)
