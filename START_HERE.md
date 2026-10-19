# Start here

MIT licensed ([LICENSE](LICENSE)). Copyright (c) 2026 yellowgram. Use this repository as a GitHub template or clone it. Security reports: [SECURITY.md](SECURITY.md). Polar is not in the app.

Releases before 0.3.0 (tags `v0.1.0`, `v0.1.1`, `v0.1.2`, `v0.2.0` and their GitHub Release zips) were published under the previous license; 0.3.0 and later are MIT. Old zip digests: [docs/CHECKSUMS.md](docs/CHECKSUMS.md).

## Not multi-tenant auth

`x-ledger-secret` / `LEDGER_API_SECRET` is not customer auth. It only opens demo checkout, check, and track, and those routes still bill `DEMO_USER_ID` (default `demo_user`). Every caller shares one balance. A `userId` in the JSON body is ignored. Leave `LEDGER_API_SECRET` unset.

## Clone to a green test

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

[Known limits](README.md#known-limits): a refund before its grant is applied when the grant arrives; a partial refund claws the whole pack; a won dispute does not return credits.

## Graduation — you own the process

Copy `src/billing` into your app. `userId` comes from your session. Do not ship `src/app`, `DEMO_USER_ID`, a body `userId`, or `x-ledger-secret` as the product. Reserve → work → finalize or release on every paid path in **your** app. The demo buttons are not that integration.

Production babysitting is yours, not a hosted loop:

- Run `npm run holds:reap` (default 60s loop, or cron `npm run holds:reap -- --once`). Production must run that process. You own it. The demo server reaps once on the first database request, and `reserve` reaps before each reservation. Neither is the production reaper. Default TTL is 900s. One pass expires at most 200 holds. A crash after `reserve`, with nothing calling the reaper, leaves credits `held`. See [troubleshooting](docs/TROUBLESHOOTING.md).
- A clawback pauses the user only when the balance cannot cover the pack after open holds are released (`shortfall` is journaled only in that case). Releasing a hold does not pause by itself when the balance covers the pack. A new grant does not unpause. Call `unpauseUser` from your admin path. Demo reset is not that path.

## Support

[SUPPORT.md](SUPPORT.md): best-effort GitHub Issues, **no SLA**. Repro required. No live secrets. Vulnerability reports go to [SECURITY.md](SECURITY.md), not Issues.

[Troubleshooting](docs/TROUBLESHOOTING.md) · [Refund glossary](docs/REFUND_GLOSSARY.md) (customer `charge.refunded` is a full-pack clawback) · [Changelog](CHANGELOG.md) · [License](LICENSE)
