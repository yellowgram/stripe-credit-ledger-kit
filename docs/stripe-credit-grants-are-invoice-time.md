# Stripe Credit Grants Are Invoice-Time — When to Use Grants, a DIY Ledger, Metronome, or Autumn

**Audience:** Indie AI founders wiring prepaid credits on Stripe
**Status:** Public draft (marketing lead magnet for a DIY ledger kit)
**Last updated:** 2026-09-25
**Not affiliated with** Stripe, Autumn, or Metronome.
**License:** This file only is MIT, Copyright (c) 2026 yellowgram. The kit is not MIT. See the repository `LICENSE`.

If you are reading this inside the credit-ledger kit, the manual is the [README](../README.md). This chapter is the map, not the setup guide.

---

You are about to ship “credits” for your AI wrapper. Chat messages. Image gens. Agent steps. Token burn.

Someone on Discord said: *just use Stripe Credit Grants*. Someone else said Autumn. Cursor scaffolded half a webhook handler and called it done.

This chapter is the map before you pick a road. No product pitch in the middle. Soft ask at the end only.

---

## 1. The trap in one paragraph

**Basic Stripe Billing Credits (Credit Grants) apply when an invoice finalizes.** They are not a real-time wallet your app can ask “can this user spend 12 credits *right now*?” before an LLM call. Stripe’s own compare table says credit-based pricing on basic usage-based billing is **invoice-time**; prepaid drawdown that reduces a balance **in real time** is on Metronome. Footnote from Stripe: *Credits are only reconciled at invoice time. Customers can exceed their balance during the cycle.*

Primary sources:

- [Compare basic usage-based billing and Metronome](https://docs.stripe.com/billing/subscriptions/usage-based/compare-metronome) — invoice-time vs real-time; prepaid drawdown column; Connect / Checkout compatibility
- [Billing Credits / Credit Grants](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits) — grants apply at invoice finalization
- [Credit Grant API](https://docs.stripe.com/api/billing/credit-grant/create) — grants target metered prices / billable items

If your product needs a **hard gate** mid-cycle (deny the request when balance is empty), Credit Grants alone will not do that job. Users can overspend until the invoice lands. That is by design, not a bug in your webhook.

---

## 2. What you actually need

Separate two jobs people mash into the word “credits”:

| Job | Meaning | Typical tool |
|---|---|---|
| **Soft quota / invoice adjustment** | Usage accrues; credits reduce what they owe when you bill | Stripe Meters + Credit Grants |
| **Hard real-time gate** | Before (or around) the expensive call: check balance → allow or 402 → decrement safely | App ledger, Metronome prepaid, or a control plane (`check` / `track`) |

Ask one question before you write code:

> **If the user’s balance hits zero at 2:17pm on a Tuesday, must the next LLM request fail immediately?**

- **No** — invoice-time credits or end-of-period overage billing can be fine.
- **Yes** — you need a real-time path. Do not stop at Credit Grants.

Also decide ownership:

- **Money source of truth:** almost always Stripe (Checkout, PaymentIntent, Invoice).
- **Balance that gates usage:** Stripe Grants (invoice-time), Metronome (real-time prepaid), Autumn (hosted balances), or **your** Postgres/SQLite ledger.

Mixing those up is how you ship a “credits” feature that only looks correct in the Dashboard.

---

## 3. Path A — Stripe Meters + Credit Grants

**What it is:** Record usage with Billing Meters. Allocate prepaid or promotional value with Credit Grants. At invoice finalization, eligible metered charges get reduced by grant balance (after discounts, before tax — see Stripe’s credits docs).

**Good when:**

- You bill usage on a cycle (pay-as-you-go / overage).
- “They spent more than prepaid” is an invoice problem, not an API 402.
- You need **Stripe Connect** on the basic path (supported on basic usage-based billing; see compare table).
- You want to stay inside Stripe Billing without a second metering vendor.

**Bad when:**

- You need Autumn-style `check` before every generation.
- You sell credit packs and expect the pack to **hard-stop** usage the second it empties.
- You tell users “you have 47 credits left” and that number is supposed to be authoritative mid-cycle from Grants alone — it isn’t a live entitlement API for your LLM route.

**Verdict:** Keep Path A for invoice-time economics. Do not market it as real-time prepaid. Stripe is explicit.

Docs:

- [Billing Credits](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits)
- [Compare with Metronome](https://docs.stripe.com/billing/subscriptions/usage-based/compare-metronome)

---

## 4. Path B — DIY app ledger + Checkout credit packs

**What it is:** User buys a pack via **Stripe Checkout** (one-time). Your webhook credits a row in **your** database. Before use, `check(balance)`. Around the LLM call, `track` / decrement — preferably **reserve → work → finalize | release** so a provider 500 doesn’t eat credits. Idempotent webhook handling (`stripe_events` unique on `event.id`). Race-safe decrement (`UPDATE … WHERE balance >= n` or equivalent lock).

**Good when:**

- You need a **hard real-time gate**.
- You want **owned code** on your Stripe account — not another hosted control plane.
- Scope is prepaid packs + balance UI, not a full plan/entitlement catalog.
- You are willing to own: duplicate webhooks, out-of-order events, concurrent last-credit races, partial stream failures.

**Bad when:**

- You do not want to maintain a ledger.
- You need plans, entitlements, rollovers, multi-feature credit systems, org billing — that’s control-plane territory.
- You hoped “Stripe native” meant zero app tables. Real-time hard gate still lives in your app (or Metronome / Autumn).

**This is the lane of a thin DIY kit** (Checkout → grant balance → check/track → balance UI). It is not Metronome. It is not Autumn. It is boring SQL + correct edge cases.

Money still settles on Stripe. Your ledger is the **usage gate**, not a second bank.

---

## 5. Path C — Metronome

**What it is:** Stripe’s recommended platform for new advanced usage-based / prepaid real-time work. Metronome meters, rates, and manages prepaid drawdown; Stripe collects payment, tax, revenue recognition. Prepaid balances burn down in real time; you cut access when balance hits zero (webhooks / alerts). Payment-gated purchases: credits release after payment succeeds.

Primary sources:

- [Compare basic vs Metronome](https://docs.stripe.com/billing/subscriptions/usage-based/compare-metronome) — prepaid real-time; **Connect: not supported** on Metronome column; Checkout limited / custom
- [How Metronome works with Stripe](https://docs.stripe.com/billing/how-metronome-works-with-stripe)
- [Launch a prepaid credits model](https://docs.metronome.com/guides/pricing-packaging/billing-model-guides/prepaid-credits)
- [Metronome pricing](https://metronome.com/pricing) — Startup publicly lists **0.8% of billing volume** + **$0.04 / 1k ingest events** (verify live page; allotments change)

**Good when:**

- You need real-time prepaid + serious usage rating without building a ledger.
- Stripe points you here for prepaid / burndown / commits / dimensional pricing.
- Volume and contract complexity justify a metering platform.

**Bad when:**

- You need **Stripe Connect** (unsupported with Metronome per Stripe’s compare table).
- You are a solo indie who only needs Checkout packs + a hard gate — Metronome may be heavier than the problem.
- Budget: Startup % + event fees start from usage (confirm current pricing; do not assume a free allotment).

**Verdict:** Correct Stripe-aligned answer for real-time prepaid *platform*. Wrong default for “I just need to sell 500 credits and block at zero” if you refuse another vendor and Connect matters.

---

## 6. Path D — Autumn (or similar control plane)

**What it is:** Hosted billing/entitlement layer on Stripe. You model features/plans; call **`check`** to gate and **`track`** to record usage. Balances update in real time from Autumn’s perspective. Free tier exists for early volume; paid tier when you scale.

Primary sources:

- [Autumn](https://useautumn.com)
- [Pricing](https://useautumn.com/pricing) — Free includes published caps (e.g. **8K monthly billing volume**, API request limits — confirm live page)
- [Concepts overview](https://docs.useautumn.com/documentation/concepts/overview) — features → plans → balances; `check` / `track`
- [Check API](https://docs.useautumn.com/api-reference/core/check)
- [Credit systems](https://docs.useautumn.com/documentation/modelling-pricing/credit-systems)

**Good when:**

- You want `check` / `track` **without** maintaining a ledger.
- You need plans, included usage, credit systems across features, portal-ish flows — not only one-shot packs.
- Free tier covers you while finding PMF (still pay Stripe fees).

**Bad when:**

- You refuse any hosted control plane (compliance, “own every row,” or personal preference).
- You only need a prepaid pack module and already have app + DB — paying with complexity/vendor for a thin problem.
- You expected “free forever at scale” — Free has volume caps; Pro is a real monthly bill ([pricing](https://useautumn.com/pricing)).

**Similar products / kits exist** (full AI SaaS starters with credits baked in, Firebase-ledger kits, MCP-focused billing kits). Same decision: **hosted control plane vs owned module**. Pick on maintenance appetite, not Twitter aesthetics.

---

## 7. Decision tree

Start at the top. Stop at the first box that fits.

```
Need a HARD gate before/around each expensive call?
│
├─ NO → Path A: Stripe Meters + Credit Grants (invoice-time)
│         Soft quota / invoice adjustment is enough.
│
└─ YES
   │
   Need Stripe Connect for this billing path?
   │
   ├─ YES → Prefer Path B (DIY ledger) or Path D (Autumn-class).
   │         Metronome: Connect not supported (Stripe compare docs).
   │         Basic Grants still invoice-time — Grants ≠ hard gate.
   │
   └─ NO / Connect irrelevant
      │
      Want ZERO ledger ops (no balance tables to maintain)?
      │
      ├─ YES
      │   │
      │   Volume / contract complexity + OK with Metronome fees?
      │   ├─ YES → Path C: Metronome (Stripe’s real-time prepaid path)
      │   └─ NO / want check-track DX + Free tier → Path D: Autumn
      │
      └─ NO — you’ll own SQL
         │
         Only need Checkout packs + check/track + balance UI?
         ├─ YES → Path B: DIY app ledger (this kit’s lane)
         └─ NO — plans, entitlements, multi-feature credits, org billing…
                  → Path D (or Metronome if you’re already in that world)
```

**Budget cheat-sheet (order-of-magnitude, verify live pages):**

| Path | You pay mainly | Indie fit |
|---|---|---|
| A Grants | Stripe Billing / processing | High if invoice-time OK |
| B DIY | Stripe + your time/DB | High if you want owned hard gate |
| C Metronome | Stripe + Metronome % / events | Medium–low until volume justifies |
| D Autumn | Stripe + $0 Free then Pro | High until Free caps; then decide |

---

## 8. Honesty footer

If Path A fits, use Stripe’s docs and stop.
If Path C fits, talk to Metronome / follow Stripe’s Metronome guides.
If Path D fits, start on Autumn Free and ship product.

**If Path B fits** — hard real-time gate, owned ledger, Checkout packs, no desire to run a control plane — a tested DIY kit can save you from rediscovering webhook idempotency, race-safe decrements, and failed-LLM release semantics.

Would you pay **~$79** for a cloneable DIY ledger kit (Next.js + Postgres/SQLite + Stripe Checkout, tests for the edge cases above), **or** are you already on Autumn / a full AI boilerplate (e.g. ShipAI-class) and don’t need it?

Soft ask — reply, email, or waitlist: **[WAITLIST_URL]**

If the answer is “I’d just ask Cursor” and you never hit the race/idempotency bugs, don’t buy a kit. If the answer is “I want owned code and a proven checklist,” that’s the only honest reason to pay.

No fake case studies here. No “join 10,000 founders.” Decide on the tree, not the CTA.

---

### Primary links (bookmark these)

| Topic | URL |
|---|---|
| Invoice-time vs real-time (Stripe) | https://docs.stripe.com/billing/subscriptions/usage-based/compare-metronome |
| Credit Grants behavior | https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits |
| Credit Grant API | https://docs.stripe.com/api/billing/credit-grant/create |
| Metronome ↔ Stripe | https://docs.stripe.com/billing/how-metronome-works-with-stripe |
| Metronome prepaid guide | https://docs.metronome.com/guides/pricing-packaging/billing-model-guides/prepaid-credits |
| Metronome pricing | https://metronome.com/pricing |
| Autumn | https://useautumn.com |
| Autumn pricing | https://useautumn.com/pricing |
| Autumn `check` | https://docs.useautumn.com/api-reference/core/check |
| Autumn credit systems | https://docs.useautumn.com/documentation/modelling-pricing/credit-systems |

*Draft for founder voice edit. Do not paste live API keys. Not legal or billing advice — read the linked primary docs before you ship.*
