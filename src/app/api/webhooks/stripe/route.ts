import Stripe from "stripe";
import { LedgerError, handleStripeEvent, verifyStripeEvent } from "@/billing";
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
  let event: Stripe.Event;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_signature_only");
    event = verifyStripeEvent(stripe, rawBody, signature, secret);
  } catch (error) {
    if (error instanceof LedgerError) {
      return Response.json({ error: error.code }, { status: 400 });
    }
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    await ready();
    const result = await handleStripeEvent(getDb(), event);
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
