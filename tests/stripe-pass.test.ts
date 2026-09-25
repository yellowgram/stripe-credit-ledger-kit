import { afterEach, describe, expect, it } from "vitest";
import { getBalance } from "../src/billing/ledger";
import { handleStripeEvent, unresolvedChargeId, withPaymentIntent } from "../src/billing/webhook";
import { checkoutEvent, tempDb } from "./helpers";

const testEnv = { STRIPE_SECRET_KEY: "sk_test_stripe_pass" };

describe("stripe adversarial pass", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      const cleanup = cleanups.pop();
      if (cleanup) await cleanup();
    }
  });

  it("stores a paid session with no user and does not grant", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    const event = checkoutEvent({ id: "evt_nometa", sessionId: "cs_nometa" });
    event.data.object!.metadata = { packId: "pack_100" };
    const result = await handleStripeEvent(ctx.db, event, testEnv);
    expect(result).toMatchObject({ granted: false, reason: "invalid_metadata" });
    expect(await getBalance(ctx.db, "user_1")).toBe(0);
    const count = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM stripe_events`);
    expect(Number(count?.n)).toBe(1);
  });

  it("does not grant a paid session that has no payment intent", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    await expect(
      handleStripeEvent(
        ctx.db,
        checkoutEvent({ id: "evt_nopi", sessionId: "cs_nopi", paymentIntentId: null }),
        testEnv,
      ),
    ).rejects.toThrow(/missing_payment_intent/);
    const count = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM stripe_events`);
    expect(Number(count?.n)).toBe(0);
    expect(await getBalance(ctx.db, "user_1")).toBe(0);
  });

  it("claws back a dispute after the charge id is resolved to a payment intent", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    await handleStripeEvent(
      ctx.db,
      checkoutEvent({ id: "evt_grant_pi", sessionId: "cs_pi", packId: "pack_100" }),
      testEnv,
    );
    const dispute = {
      id: "evt_dispute_charge",
      type: "charge.dispute.created",
      livemode: false,
      data: { object: { id: "dp_1", object: "dispute", charge: "ch_only" } },
    };
    expect(unresolvedChargeId(dispute)).toBe("ch_only");
    const enriched = withPaymentIntent(dispute, "pi_cs_pi");
    expect(unresolvedChargeId(enriched)).toBeNull();
    const result = await handleStripeEvent(ctx.db, enriched, testEnv);
    expect(result).toMatchObject({ reason: "clawed_back", clawedBack: 100 });
    expect(await getBalance(ctx.db, "user_1")).toBe(0);
  });
});
