# Support

## Boundary

This kit is MIT-licensed open source ([LICENSE](LICENSE)) and is no longer sold. There is no paid support, no support window, and no SLA. Best-effort GitHub Issues on `yellowgram/stripe-credit-ledger-kit`. No calls, no Slack, and no implementation pairing. Contact: hello@yellowgram.dev.

## What you must include

Use the bug template (`.github/ISSUE_TEMPLATE/bug_report.yml`). An Issue without this pack is not debuggable:

- Kit version (`package.json`) or git commit
- Node version, OS, and database engine (SQLite or Postgres)
- A failing `npm test` **test name**, or a Stripe **test-mode** event id (`evt_...`)
- Redacted env **booleans and prefixes only**

Do not paste `sk_live_`, `sk_test_` values, `whsec_` values, database URLs, or card data. Key prefix (`sk_test_` vs `sk_live_` vs unset) is enough.

If the repro pack is missing, the reply points at the template and the Issue is closed after **7 days** if it is still missing.

If a secret lands in an Issue, the Issue is closed. Rotate that secret on your Stripe account or database. Live-key debugging is out of scope.

## In scope

A failure of the documented money path, reproduced by a test name in this repo or by a test-mode Stripe event id, on the version you name.

Start with [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) and [docs/REFUND_GLOSSARY.md](docs/REFUND_GLOSSARY.md). Known limits in the [README](README.md#known-limits) are not bugs.

## Out of scope

- Hosted SaaS, a yellowgram-operated wallet, or a managed dashboard
- Autumn or Metronome feature parity (plans, entitlements, rollovers, dimensional pricing, hosted `check` / `track`)
- Implementation services (wiring reserve/finalize into your app, auth, Stripe Dashboard clicks, process supervision)
- Polar inside the application (SDK, webhooks, customer portal)
- India-local ICP customization
- Debugging production live keys

## Paste-ready reply

Use this as the close comment for out-of-scope requests.

```
Closing as out of scope for the Stripe credit ledger kit.

This project is a template: copy `src/billing` onto your Stripe account and your database. It is not a hosted wallet, not an Autumn or Metronome control plane (plans, entitlements, rollovers, dimensional pricing), not implementation services, and not Polar inside the app (no Polar SDK, webhooks, or portal). Live secret keys are not debugged here.

If you wanted a control plane, use the README section "Use Autumn or Metronome instead when…" and the free chapter. Do not file that as a bug.

In-scope bugs need the issue template: kit version or commit, Node, OS, database, a failing test name or a Stripe test-mode event id, and redacted env booleans only. No secrets. Missing repro is closed after 7 days.
```

## Also read

[START_HERE.md](START_HERE.md) · [SECURITY.md](SECURITY.md) · [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) · [docs/REFUND_GLOSSARY.md](docs/REFUND_GLOSSARY.md)
