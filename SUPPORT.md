# Support

## Boundary

GitHub Issues on the private repository `yellowgram/stripe-credit-ledger-kit` for **60 days** from the purchase date. Best-effort, no SLA, capped at about two hours a week. No calls, no Slack, and no implementation pairing. Contact: hello@yellowgram.dev.

The public license is PolyForm Noncommercial 1.0.0 in [LICENSE](LICENSE) (source-available; OSI open source = false). Commercial production use is the Suthirth Commercial Grant in [docs/COMMERCIAL_GRANT.md](docs/COMMERCIAL_GRANT.md), sold by Suthirth solutions. This queue does not renegotiate either document. Copyright holder: yellowgram.

Outside 60 days, the Issue will be closed. There is no perpetual update entitlement with the $79 once zip. Behavior you are on is the tree you bought ([CHANGELOG.md](CHANGELOG.md)). Soft-WTP stays off.

## Issues access (not Polar messages)

The repository is private. Polar chat is not the support queue.

**Expected path:** after purchase, the maintainer invites the GitHub account you name as a **collaborator with Read** on `yellowgram/stripe-credit-ledger-kit`. Read can open Issues. It cannot push. An equivalent handoff (a private mirror whose Issues the maintainer actually reads) counts only if it is that same 60-day queue.

The maintainer sends the invite. This kit does not send it. Until the invite exists, there is still no Polar-DM support desk.

## What you must include

Use the bug template (`.github/ISSUE_TEMPLATE/bug_report.yml`). An Issue without this pack is not debuggable:

- Kit semver, git tag, or zip checksum (see [docs/CHECKSUMS.md](docs/CHECKSUMS.md))
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
- Lock, Audit, or any other SKU that is not this download
- Soft-WTP, waitlist, or outreach programs
- Implementation services (wiring reserve/finalize into your app, auth, Stripe Dashboard clicks, process supervision)
- Polar inside the application (SDK, webhooks, customer portal)
- India-local ICP customization
- Debugging production live keys
- Purchase money-back (see [docs/REFUND_GLOSSARY.md](docs/REFUND_GLOSSARY.md))

## Paste-ready reply

Use this as the close comment. Do not improvise a different policy.

```
Closing as out of scope for the $79 Stripe credit ledger kit.

This product is the download: copy `src/billing` onto your Stripe account and your database. It is not a hosted wallet, not an Autumn or Metronome control plane (plans, entitlements, rollovers, dimensional pricing), not Lock or Audit, not a Soft-WTP or waitlist program, not implementation services, and not Polar inside the app (no Polar SDK, webhooks, or portal). India-local ICP customization is not part of this SKU. Live secret keys are not debugged here.

If you wanted a control plane, use the README section "Use Autumn or Metronome instead when…" and the free chapter. Do not file that as a bug.

The kit purchase has no money-back window (docs/REFUND_GLOSSARY.md). A customer `charge.refunded` / dispute full-pack clawback is a different word. LICENSE and the Suthirth Commercial Grant are not renegotiated here. Soft-WTP stays off.

In-scope bugs need the issue template: kit version or checksum, Node, OS, database, a failing test name or a Stripe test-mode event id, and redacted env booleans only. No secrets. Missing repro is closed after 7 days.
```

## Also read

[BUYER_START_HERE.md](BUYER_START_HERE.md) · [SECURITY.md](SECURITY.md) · [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) · [docs/REFUND_GLOSSARY.md](docs/REFUND_GLOSSARY.md) · [docs/POLAR_DELIVERABLES.md](docs/POLAR_DELIVERABLES.md)
