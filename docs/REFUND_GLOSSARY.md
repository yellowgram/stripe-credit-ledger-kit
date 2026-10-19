# Refund glossary

How customer refunds and disputes on your Stripe account hit the ledger.

## Customer charge (your Stripe account)

`charge.refunded` and `charge.dispute.created` on **your** Stripe account claw back the **full pack** granted for that payment intent. Not a prorated cent.

In that same database transaction the kit releases that user's open holds, then debits the spendable balance. One `clawback` row is written per payment intent. A later reaper pass cannot put those released credits back.

The user is paused only when spendable cannot cover the full pack after open holds are released. Releasing a hold does not pause by itself when the balance covers the pack. A `shortfall` row (`kind = shortfall`, delta 0) is journaled only when credits are actually missing. `reserve` and `track` then return `account_paused`.

A new grant does **not** clear the pause. You call `unpauseUser` from your admin path. Demo reset is not that path.

## Known holes

These are the shipped rules. They are not open bugs.

| Situation | What the kit does |
|---|---|
| Refund or dispute for a payment intent that has no grant yet | HTTP 200, event stored, `pending_clawback`. Stripe stops. The matching grant applies that clawback in the same transaction. |
| Partial refund | Full-pack clawback. Proration is not implemented. |
| `charge.dispute.closed` (you won) | Stored as `ignored_event`. Credits are not returned. There is no dispute state machine. |
| Second refund or dispute for the same payment intent | `already_clawed_back`. No second debit. |
| Checkout event with no `userId` or `packId` | Stored, `invalid_metadata`, HTTP 200, no grant. |

Spendable balance after a clawback still follows the [balance invariant](../README.md#balance-invariant): grants minus finalized spends minus held reserves minus clawbacks.

