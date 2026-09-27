# Refund glossary

Two different words. Mixing them up makes a ledger clawback look like a broken download, or a download policy look like a customer credit rule.

## Kit purchase (this zip)

The $79 kit has **no money-back window**. Polar delivered a file. That sale is not reversed because a demo failed, because a limit in this glossary surprised you, or because the product is the wrong fit (see the Autumn / Metronome walk-away in the [README](../README.md)).

The listing text is [POLAR_DELIVERABLES.md](POLAR_DELIVERABLES.md). The written policy for the $79 kit is **none**. The sold listing has no money-back window. This file is that policy.

## Customer charge (your Stripe account)

`charge.refunded` and `charge.dispute.created` on **your** Stripe account claw back the **full pack** granted for that payment intent. Not a prorated cent. Not a refund of the kit.

In that same database transaction the kit releases that user's open holds, then debits the spendable balance. One `clawback` row is written per payment intent. A later reaper pass cannot put those released credits back.

The user is paused if that clawback released any open hold, or if the spendable balance could not cover the full pack. A `shortfall` row (`kind = shortfall`, delta 0) is journaled only when credits are actually missing. `reserve` and `track` then return `account_paused`.

A new grant does **not** clear the pause. You call `unpauseUser` from your admin path. Demo reset is not that path.

## Known holes

These are the shipped rules. They are not open bugs.

| Situation | What the kit does |
|---|---|
| Refund or dispute for a payment intent that has no grant yet | HTTP 200, event stored, `ignored_unknown_payment_intent`. Stripe stops. A grant that arrives later is **not** clawed back by this event. |
| Partial refund | Full-pack clawback. Proration is not implemented. |
| `charge.dispute.closed` (you won) | Stored as `ignored_event`. Credits are not returned. There is no dispute state machine. |
| Second refund or dispute for the same payment intent | `already_clawed_back`. No second debit. |
| Checkout event with no `userId` or `packId` | Stored, `invalid_metadata`, HTTP 200, no grant. |

Spendable balance after a clawback still follows the [balance invariant](../README.md#balance-invariant): grants minus finalized spends minus held reserves minus clawbacks.

Clawback of a customer pack does not refund the kit. The kit's no-money-back policy does not change how your customers' refunds hit the ledger.
