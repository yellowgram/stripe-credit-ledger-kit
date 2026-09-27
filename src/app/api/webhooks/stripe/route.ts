import Stripe from "stripe";
import { LedgerError, handleStripeEvent, unresolvedChargeId, verifyStripeEvent, withPaymentIntent } from "@/billing";
import { getDb, ready } from "@/server/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret || secret.includes("replace_me")) {
    return Response.json({ error: "missing_signature" }, { status: 400 });
  }

  const rawBody = await req.text();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_signature_only");
  let event: Stripe.Event;
  try {
    event = verifyStripeEvent(stripe, rawBody, signature, secret);
  } catch (error) {
    if (error instanceof LedgerError) {
      return Response.json({ error: error.code }, { status: 400 });
    }
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  }

  let parsed = event;
  const chargeId = unresolvedChargeId(event);
  if (chargeId) {
    try {
      const charge = await stripe.charges.retrieve(chargeId);
      const paymentIntentId =
        typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null;
      if (paymentIntentId) parsed = withPaymentIntent(event, paymentIntentId) as Stripe.Event;
    } catch (error) {
      const statusCode = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : 0;
      if (statusCode !== 404) {
        console.error(error);
        return Response.json({ error: "charge_lookup_failed" }, { status: 500 });
      }
    }
  }

  try {
    await ready();
    const result = await handleStripeEvent(getDb(), parsed);
    return Response.json({ received: true, ...result });
  } catch (error) {
    // livemode_mismatch is permanent for this key. 400 so Stripe stops.
    // Other processing failures stay 500 so Stripe retries.
    if (error instanceof LedgerError && error.code === "livemode_mismatch") {
      return Response.json({ error: error.code }, { status: 400 });
    }
    console.error(error);
    const code = error instanceof LedgerError ? error.code : "internal_error";
    return Response.json({ error: code }, { status: 500 });
  }
}
