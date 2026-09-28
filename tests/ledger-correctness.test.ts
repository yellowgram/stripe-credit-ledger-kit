import { afterEach, describe, expect, it } from "vitest";
import { LedgerError } from "../src/billing/errors";
import {
  applyClawback,
  balanceBreakdown,
  getBalance,
  grantCredits,
  reapExpiredHolds,
  reserve,
} from "../src/billing/ledger";
import { tempDb } from "./helpers";

describe("ledger correctness pass", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      const cleanup = cleanups.pop();
      if (cleanup) await cleanup();
    }
  });

  it("claws back even when the customer already used the refund event id as a key", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    await grantCredits(ctx.db, {
      userId: "user_1",
      credits: 100,
      packId: "pack_100",
      idempotencyKey: "grant_1",
      paymentIntentId: "pi_collide",
    });
    const reserved = await reserve(ctx.db, { userId: "user_1", amount: 30, idempotencyKey: "evt_refund" });
    expect(reserved.ok).toBe(true);

    const result = await ctx.db.transaction((tx) =>
      applyClawback(tx, {
        userId: "user_1",
        credits: 100,
        paymentIntentId: "pi_collide",
        stripeEventId: "evt_refund",
        note: "charge.refunded",
      }),
    );
    expect(result).toMatchObject({ clawedBack: 100, shortfall: 0, paused: false, replay: false });
    expect(await getBalance(ctx.db, "user_1")).toBe(0);
    const breakdown = await balanceBreakdown(ctx.db, "user_1");
    expect(breakdown.balance).toBe(breakdown.expected);
    expect(breakdown.heldReserves).toBe(0);
  });

  it("refuses a grant that would exceed the safe integer range and leaves the balance", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    const almost = Number.MAX_SAFE_INTEGER - 5;
    await grantCredits(ctx.db, {
      userId: "user_1",
      credits: almost,
      packId: "pack_100",
      idempotencyKey: "grant_big",
    });
    await expect(
      grantCredits(ctx.db, {
        userId: "user_1",
        credits: 10,
        packId: "pack_100",
        idempotencyKey: "grant_overflow",
      }),
    ).rejects.toBeInstanceOf(LedgerError);
    expect(await getBalance(ctx.db, "user_1")).toBe(almost);
  });

  it("expires a hold whose id was already used inside an idempotency key", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    await grantCredits(ctx.db, {
      userId: "user_1",
      credits: 40,
      packId: "pack_100",
      idempotencyKey: "grant_expire",
    });
    const reserved = await reserve(ctx.db, { userId: "user_1", amount: 15, idempotencyKey: "hold_expire" });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    await reserve(ctx.db, {
      userId: "user_1",
      amount: 5,
      idempotencyKey: `expire:${reserved.reservationId}`,
    });
    const reaped = await reapExpiredHolds(ctx.db, { now: new Date(Date.now() + 60_000), ttlSeconds: 1 });
    expect(reaped.expired).toBe(2);
    expect(await getBalance(ctx.db, "user_1")).toBe(40);
    const breakdown = await balanceBreakdown(ctx.db, "user_1");
    expect(breakdown.balance).toBe(breakdown.expected);
    expect(breakdown.heldReserves).toBe(0);
  });
});
