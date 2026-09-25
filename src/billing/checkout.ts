import type Stripe from "stripe";
import { LedgerError } from "./errors";
import { creditPackMetadata, getPack } from "./packs";

/**
 * One-time Stripe Checkout Session for a catalog pack.
 * metadata (and the PaymentIntent copy) always carries userId, credits, packId.
 * client_reference_id repeats userId for the Dashboard.
 */
export async function createCreditPackCheckout(
  stripe: Stripe,
  input: {
    packId: string;
    userId: string;
    successUrl: string;
    cancelUrl: string;
  },
): Promise<{ id: string; url: string | null }> {
  if (typeof input.userId !== "string" || input.userId.trim() === "") {
    throw new LedgerError("invalid_user_id");
  }
  const pack = getPack(input.packId);
  if (!pack) throw new LedgerError("unknown_pack");
  const metadata = creditPackMetadata(input.userId, pack);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: input.userId,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata,
    payment_intent_data: { metadata },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: pack.currency,
          unit_amount: pack.amountCents,
          product_data: {
            name: `${pack.name} — ${pack.credits} credits`,
            description: "Prepaid credits. Granted after Stripe confirms payment.",
          },
        },
      },
    ],
  });

  return { id: session.id, url: session.url };
}
