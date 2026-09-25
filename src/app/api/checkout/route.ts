import Stripe from "stripe";
import { LedgerError, createCreditPackCheckout } from "@/billing";
import { errorResponse, readJson } from "@/server/http";
import { appOrigin, demoUserId, ready } from "@/server/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    await ready();
    const body = await readJson(req);
    const packId = body.packId;
    if (typeof packId !== "string" || packId.trim() === "") {
      throw new LedgerError("unknown_pack");
    }
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret || secret.includes("replace_me")) {
      throw new LedgerError("missing_stripe_secret_key");
    }
    const origin = appOrigin();
    const stripe = new Stripe(secret);
    const session = await createCreditPackCheckout(stripe, {
      packId,
      userId: demoUserId(),
      successUrl: `${origin}/?checkout=success`,
      cancelUrl: `${origin}/?checkout=cancel`,
    });
    if (!session.url) {
      return Response.json({ error: "checkout_missing_url", id: session.id }, { status: 502 });
    }
    return Response.json({ id: session.id, url: session.url });
  } catch (error) {
    return errorResponse(error);
  }
}
