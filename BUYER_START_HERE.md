# Buyer start here

You have version **0.1.0** of the Stripe credit ledger kit. Unzip the download or clone the `v0.1.0` tag. Polar delivered the file. Polar is not part of this app.

1. Follow [README.md](README.md). Setup is `npm install`, copy `.env.example` to `.env.local`, `npm run db:migrate`, then `npm run dev`.
2. Purchase terms for the Polar listing (what is included, what is not, delivery, support, license) are in [docs/POLAR_DELIVERABLES.md](docs/POLAR_DELIVERABLES.md).
3. License: one organization, no resale of the kit. See [LICENSE](LICENSE). The ledger extract in `src/billing/ledger.ts`, `types.ts`, and `errors.ts` is also MIT.

Copy `src/billing` into your app. The demo shell under `src/app` is there to watch the edges, then replace.
