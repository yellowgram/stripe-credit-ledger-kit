# Buyer start here

Kit **0.1.1**. Polar delivered this zip. Polar is not in the app. Verify the file with [docs/CHECKSUMS.md](docs/CHECKSUMS.md).

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

Optional UI: `npm run dev`, then http://localhost:3000. The first migrate with the flag on, or the first request that opens the database with the flag on, grants 100 credits once (`seed:<DEMO_USER_ID>`). Later requests do not refill; the reset control does. Try spend, fail→release, last-credit race, and reset. Turn the flag off when you are done looking. Stripe CLI and `npm run demo:webhook` are in the [README](README.md). `npm test` does not need migrate.

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

[SUPPORT.md](SUPPORT.md): GitHub Issues for **60 days** from purchase, best-effort, **no SLA**, about two hours a week. Repro required. No live secrets. This repo is private. The support path is a **post-purchase collaborator invite** (Read, so you can open Issues). Polar messages are not the queue. Vulnerability reports go to [SECURITY.md](SECURITY.md), not Issues.

[Troubleshooting](docs/TROUBLESHOOTING.md) · [Refund glossary](docs/REFUND_GLOSSARY.md) (no money-back on the zip; customer `charge.refunded` is a full-pack clawback) · [Listing](docs/POLAR_DELIVERABLES.md) · [Changelog](CHANGELOG.md) · [License](LICENSE)
