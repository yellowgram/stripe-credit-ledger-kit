# Security

## Private vulnerability reports

Do not open a GitHub Issue with a proof of concept, exploit steps, or a zero-day. Do not paste live Stripe keys, webhook signing secrets, database URLs, or customer payment details into Issues, pull requests, or Polar messages.

Report privately on this repository:

https://github.com/yellowgram/stripe-credit-ledger-kit/security/advisories/new

The maintainer enables GitHub private vulnerability reporting so that form accepts submissions. If the page says reporting is turned off, open an Issue whose **entire** body is:

```
Please enable private security advisories.
```

No stack trace, payload, event dump, or secret in that Issue.

## Support is a different path

[SUPPORT.md](SUPPORT.md) is the 60-day best-effort queue for kit bugs that already have a repro pack. That window is not a penetration-test retainer and not permission to post exploit details in Issues while a private report is pending.

Billing correctness in your production is yours. The public [license](LICENSE) is PolyForm Noncommercial 1.0.0 (source-available; OSI open source = false) and has no warranty. Commercial production use is the Suthirth Commercial Grant in [docs/COMMERCIAL_GRANT.md](docs/COMMERCIAL_GRANT.md). Seller: Suthirth solutions. Contact: hello@yellowgram.dev. This policy does not add auth, Lock, Audit, or a hosted wallet.
