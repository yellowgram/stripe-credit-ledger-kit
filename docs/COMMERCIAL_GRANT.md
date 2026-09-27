# Suthirth Commercial Grant

**Product:** Credit Ledger  
**Seller:** Suthirth solutions  
**Contact:** hello@yellowgram.dev · https://www.yellowgram.dev  
**Public license:** PolyForm Noncommercial 1.0.0 (`LICENSE`) — source-available; not OSI open source  
**Soft-WTP:** off (no coupons, no cold invoices)

## What you buy

A paid Polar purchase of the **Credit Ledger** self-host kit (this repository’s title is Stripe credit ledger kit) grants **one organization** a **Suthirth Commercial Grant** for that kit.

| Term | Grant |
| --- | --- |
| Scope | **One organization** (the buyer named on the Polar order) |
| Version | The **named git tag** delivered with that purchase (and its sealed zip SHA) |
| Duration | **Perpetual** for that named tag |
| Rights | Use and modify the kit for that organization’s own commercial production purposes for the product’s intended function |
| Delivery | Kit zip + checksums as listed on Polar for that tag (and GitHub access when the listing includes it) |
| Support | GitHub Issues for 60 days from purchase date; best-effort, no SLA, capped at about two hours a week — no SLA unless a separate written agreement says otherwise |
| Refund | **None** for the current $79 kit SKU. No money-back window. A customer `charge.refunded` on the buyer’s Stripe account is a ledger clawback, not a refund of this purchase (`docs/REFUND_GLOSSARY.md`) |

Price for the current kit SKU is **$79 once** (Polar product `93a844f7-d48e-414f-ac0c-adf905ffef46`). The current named tag is `v0.1.2`. Do **not** put Polar checkout URLs in the README or inside the zip.

## What this grant does **not** include

- Rights for a **second organization** (each org needs its own purchase)
- Rights to **other tags** or future major lines unless separately purchased or explicitly upgraded in writing
- Permission to **resell, sublicense, republish, or redistribute** the kit (or a substantial portion) as a competing starter, boilerplate, template, course, or hosted service
- **Self-host production rights** bundled into any **hosted** SKU (hosted is separate; it does not sell the self-host grant)
- Permission to run a **competing hosted** offering of Credit Ledger
- Any OSI “open source” grant; payment does not convert the public PolyForm Noncommercial terms into MIT/Apache/BSD

## Relationship to `LICENSE`

Without this grant, only PolyForm Noncommercial 1.0.0 applies.  
With this grant, the named organization may use the named tag commercially as above. The public PolyForm text in `LICENSE` stays the public fence for everyone else.

## Prior distributions

Tags and zips already shipped under an older license (for example MIT, or a prior custom commercial license) are **not rewritten**. Rights already granted for those sealed artifacts are not clawed back. New purchases and new tags use this grant + PolyForm Noncommercial fence.

Grandfathered for Credit Ledger (Stripe credit ledger kit). These tags and zips stay sealed. They are not retagged, not repacked, and not given a new digest:

| Tag | What shipped | Release zip SHA-256 |
| --- | --- | --- |
| `v0.1.0` | First Polar-ready cut. MIT carve-out on `src/billing/ledger.ts`, `types.ts`, `errors.ts`, and on `docs/stripe-credit-grants-are-invoice-time.md` for that file alone. Asset `stripe-credit-ledger-kit-0.1.0.zip`. | `aa558100add2a3585190656ab1eb4b217cda6fafe596eaafe0dd02f9a9a33d94` |
| `v0.1.1` | Hygiene cut. Same MIT carve-out as `v0.1.0`. Asset `stripe-credit-ledger-kit-0.1.1.zip` (commit `c633584`). | `a9bc28d82f673afc0eafbd1c3ad20c3047e95c7eb71ad70dd96f4b88473d41a8` |

**0.1.2** is the current sold tag. Polar delivers `stripe-credit-ledger-kit-0.1.2.zip` (tag `v0.1.2`, commit `593a2d1`, SHA-256 `b63b1c834646030c0e201db9a0b2240cb1b8ac547fb1fb610794431491955832`). That zip is this grant plus PolyForm Noncommercial 1.0.0 for the whole kit, including the former extract and the free chapter. The public license is not MIT. That zip is inside this fence. Price is $79 once. No money-back window. Soft-WTP stays off. `v0.1.0` and `v0.1.1` above are grandfathered history. They are not the file Polar sells now.

## Operator responsibility

Credit Ledger is provided **as is**. You remain responsible for production correctness, compliance, and decisions made from its outputs. This is not legal, tax, or accounting advice.
