import { afterEach, describe, expect, it } from "vitest";
import { getBalance } from "../src/billing/ledger";
import { handleStripeEvent } from "../src/billing/webhook";
import { checkoutEvent, tempDb } from "./helpers";

describe("out-of-order Stripe events", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      const cleanup = cleanups.pop();
      if (cleanup) await cleanup();
    }
  });

  it("ignores payment_intent.succeeded and an unpaid completion, then grants once", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);

    const paymentIntent = await handleStripeEvent(ctx.db, {
      id: "evt_pi",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_1",
          metadata: { userId: "user_1", credits: "100", packId: "pack_100" },
        },
      },
    });
    expect(paymentIntent).toMatchObject({ granted: false, reason: "ignored_event" });
    expect(await getBalance(ctx.db, "user_1")).toBe(0);

    const unpaid = await handleStripeEvent(
      ctx.db,
      checkoutEvent({
        id: "evt_unpaid",
        sessionId: "cs_delay",
        paymentStatus: "unpaid",
      }),
    );
    expect(unpaid).toMatchObject({ granted: false, reason: "unpaid" });
    expect(await getBalance(ctx.db, "user_1")).toBe(0);

    const asyncPaid = await handleStripeEvent(
      ctx.db,
      checkoutEvent({
        id: "evt_async",
        type: "checkout.session.async_payment_succeeded",
        sessionId: "cs_delay",
        paymentStatus: "paid",
        credits: 2000,
        packId: "pack_2000",
      }),
    );
    expect(asyncPaid).toMatchObject({ granted: true });
    expect(await getBalance(ctx.db, "user_1")).toBe(2000);

    const lateCompleted = await handleStripeEvent(
      ctx.db,
      checkoutEvent({
        id: "evt_completed_late",
        sessionId: "cs_delay",
        paymentStatus: "paid",
        credits: 2000,
        packId: "pack_2000",
      }),
    );
    expect(lateCompleted).toMatchObject({ granted: false, reason: "session_already_granted" });

    await handleStripeEvent(ctx.db, {
      id: "evt_pi",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_1" } },
    });
    await handleStripeEvent(
      ctx.db,
      checkoutEvent({
        id: "evt_async",
        type: "checkout.session.async_payment_succeeded",
        sessionId: "cs_delay",
        credits: 2000,
        packId: "pack_2000",
      }),
    );

    expect(await getBalance(ctx.db, "user_1")).toBe(2000);
  });

  it("does not grant a second time when the paid completion arrives before the payment intent", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);

    const completed = await handleStripeEvent(
      ctx.db,
      checkoutEvent({ id: "evt_cs", sessionId: "cs_card", credits: 100, packId: "pack_100" }),
    );
    const laterIntent = await handleStripeEvent(ctx.db, {
      id: "evt_pi_later",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_2",
          metadata: { userId: "user_1", credits: "100", packId: "pack_100" },
        },
      },
    });

    expect(completed.granted).toBe(true);
    expect(laterIntent.granted).toBe(false);
    expect(await getBalance(ctx.db, "user_1")).toBe(100);
  });
});
