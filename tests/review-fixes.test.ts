import { afterEach, describe, expect, it } from "vitest";
import {
  balanceBreakdown,
  finalize,
  getAccount,
  getBalance,
  grantCredits,
  listEntries,
  reapExpiredHolds,
  release,
  reserve,
  track,
} from "../src/billing/ledger";
import { expectedLivemode, handleStripeEvent } from "../src/billing/webhook";
import { checkoutEvent, tempDb } from "./helpers";

const testEnv = { STRIPE_SECRET_KEY: "sk_test_review" };

describe("accepted review fixes", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      const cleanup = cleanups.pop();
      if (cleanup) await cleanup();
    }
  });

  async function funded(userId = "user_1", credits = 100) {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    await grantCredits(ctx.db, {
      userId,
      credits,
      packId: "pack_100",
      idempotencyKey: `grant_${userId}`,
    });
    return ctx;
  }

  it("replays a held reserve and fails closed after release or finalize", async () => {
    const ctx = await funded();
    const first = await reserve(ctx.db, { userId: "user_1", amount: 10, idempotencyKey: "hold_me" });
    expect(first).toMatchObject({ ok: true, replay: false, status: "held", balance: 90 });

    const replay = await reserve(ctx.db, { userId: "user_1", amount: 10, idempotencyKey: "hold_me" });
    expect(replay).toMatchObject({ ok: true, replay: true, status: "held", balance: 90 });

    const mismatch = await reserve(ctx.db, { userId: "user_1", amount: 11, idempotencyKey: "hold_me" });
    expect(mismatch).toMatchObject({ ok: false, error: "idempotency_amount_mismatch", balance: 90 });

    await release(ctx.db, "user_1", "hold_me");
    expect(await getBalance(ctx.db, "user_1")).toBe(100);
    const afterRelease = await reserve(ctx.db, { userId: "user_1", amount: 10, idempotencyKey: "hold_me" });
    expect(afterRelease).toMatchObject({ ok: false, error: "already_released", balance: 100 });

    const spent = await reserve(ctx.db, { userId: "user_1", amount: 25, idempotencyKey: "spend_me" });
    expect(spent.ok).toBe(true);
    await finalize(ctx.db, "user_1", "spend_me");
    const afterFinalize = await reserve(ctx.db, { userId: "user_1", amount: 25, idempotencyKey: "spend_me" });
    expect(afterFinalize).toMatchObject({ ok: false, error: "already_finalized", balance: 75 });
  });

  it("scopes the same idempotency key to each user", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    for (const userId of ["user_a", "user_b"]) {
      await grantCredits(ctx.db, {
        userId,
        credits: 40,
        packId: "pack_100",
        idempotencyKey: `grant_${userId}`,
      });
    }
    const left = await reserve(ctx.db, { userId: "user_a", amount: 15, idempotencyKey: "shared" });
    const right = await reserve(ctx.db, { userId: "user_b", amount: 15, idempotencyKey: "shared" });
    expect(left.ok && right.ok).toBe(true);
    expect(await getBalance(ctx.db, "user_a")).toBe(25);
    expect(await getBalance(ctx.db, "user_b")).toBe(25);
  });

  it("returns held credits after the TTL and refuses to replay the expired key", async () => {
    const ctx = await funded("user_1", 50);
    const held = await reserve(ctx.db, { userId: "user_1", amount: 20, idempotencyKey: "stale" });
    expect(held.ok).toBe(true);
    expect(await getBalance(ctx.db, "user_1")).toBe(30);

    const fresh = await reapExpiredHolds(ctx.db);
    expect(fresh.expired).toBe(0);
    expect(await getBalance(ctx.db, "user_1")).toBe(30);

    const reaped = await reapExpiredHolds(ctx.db, {
      now: new Date(Date.now() + 60_000),
      ttlSeconds: 1,
    });
    expect(reaped.expired).toBe(1);
    expect(await getBalance(ctx.db, "user_1")).toBe(50);
    const kinds = (await listEntries(ctx.db, "user_1", 20)).map((entry) => entry.kind);
    expect(kinds).toContain("expire");

    const again = await reapExpiredHolds(ctx.db, {
      now: new Date(Date.now() + 60_000),
      ttlSeconds: 1,
    });
    expect(again.expired).toBe(0);

    const replay = await reserve(ctx.db, { userId: "user_1", amount: 20, idempotencyKey: "stale" });
    expect(replay).toMatchObject({ ok: false, error: "hold_expired", balance: 50 });
    expect(await finalize(ctx.db, "user_1", "stale")).toMatchObject({ ok: false, error: "hold_expired" });
  });

  it("claws back a full unused grant on charge.refunded without pausing", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    const granted = await handleStripeEvent(
      ctx.db,
      checkoutEvent({ id: "evt_grant_refund", sessionId: "cs_refund", packId: "pack_100" }),
      testEnv,
    );
    expect(granted.granted).toBe(true);
    const refund = await handleStripeEvent(
      ctx.db,
      {
        id: "evt_refund",
        type: "charge.refunded",
        livemode: false,
        data: { object: { id: "ch_refund", payment_intent: "pi_cs_refund" } },
      },
      testEnv,
    );
    expect(refund).toMatchObject({ reason: "clawed_back", clawedBack: 100, shortfall: 0, paused: false });
    expect(await getBalance(ctx.db, "user_1")).toBe(0);
    expect((await getAccount(ctx.db, "user_1")).paused).toBe(false);

    const second = await handleStripeEvent(
      ctx.db,
      {
        id: "evt_refund_again",
        type: "charge.refunded",
        livemode: false,
        data: { object: { id: "ch_refund", payment_intent: "pi_cs_refund" } },
      },
      testEnv,
    );
    expect(second).toMatchObject({ reason: "already_clawed_back" });
    expect(await getBalance(ctx.db, "user_1")).toBe(0);
  });

  it("pauses and journals a shortfall when a dispute follows a partial spend", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    await handleStripeEvent(
      ctx.db,
      checkoutEvent({ id: "evt_grant_dispute", sessionId: "cs_dispute", packId: "pack_100" }),
      testEnv,
    );
    const spent = await track(ctx.db, { userId: "user_1", amount: 40, idempotencyKey: "spent_some" });
    expect(spent).toMatchObject({ ok: true, balance: 60 });

    const dispute = await handleStripeEvent(
      ctx.db,
      {
        id: "evt_dispute",
        type: "charge.dispute.created",
        livemode: false,
        data: { object: { id: "dp_1", payment_intent: "pi_cs_dispute" } },
      },
      testEnv,
    );
    expect(dispute).toMatchObject({ reason: "clawed_back", clawedBack: 60, shortfall: 40, paused: true });
    expect(await getBalance(ctx.db, "user_1")).toBe(0);
    const kinds = (await listEntries(ctx.db, "user_1", 20)).map((entry) => entry.kind);
    expect(kinds).toContain("shortfall");

    const blocked = await reserve(ctx.db, { userId: "user_1", amount: 1, idempotencyKey: "while_paused" });
    expect(blocked).toMatchObject({ ok: false, error: "account_paused" });

    await grantCredits(ctx.db, {
      userId: "user_1",
      credits: 10,
      packId: "pack_100",
      idempotencyKey: "grant_after_pause",
    });
    expect(await getAccount(ctx.db, "user_1")).toEqual({ balance: 10, paused: false });
  });

  it("does not burn the event id when the refund arrives before the grant", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    await expect(
      handleStripeEvent(
        ctx.db,
        {
          id: "evt_early_refund",
          type: "charge.refunded",
          livemode: false,
          data: { object: { payment_intent: "pi_not_yet" } },
        },
        testEnv,
      ),
    ).rejects.toThrow(/grant_not_found/);
    const count = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM stripe_events`);
    expect(Number(count?.n)).toBe(0);
  });

  it("rejects a livemode mismatch before inserting the event", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    expect(expectedLivemode({ STRIPE_SECRET_KEY: "sk_test_x" })).toBe(false);
    expect(expectedLivemode({ STRIPE_SECRET_KEY: "sk_live_x" })).toBe(true);
    expect(expectedLivemode({ STRIPE_SECRET_KEY: "sk_live_x", STRIPE_EXPECT_LIVEMODE: "false" })).toBe(false);

    await expect(
      handleStripeEvent(
        ctx.db,
        checkoutEvent({ id: "evt_live", sessionId: "cs_live", livemode: true }),
        { STRIPE_SECRET_KEY: "sk_test_x" },
      ),
    ).rejects.toThrow(/livemode_mismatch/);
    expect(await getBalance(ctx.db, "user_1")).toBe(0);
    const count = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM stripe_events`);
    expect(Number(count?.n)).toBe(0);

    const granted = await handleStripeEvent(
      ctx.db,
      checkoutEvent({ id: "evt_testmode", sessionId: "cs_testmode", livemode: false }),
      { STRIPE_SECRET_KEY: "sk_test_x" },
    );
    expect(granted.granted).toBe(true);
    const stored = await ctx.db.get<{ livemode: number }>(
      `SELECT livemode FROM stripe_events WHERE id = ?`,
      ["evt_testmode"],
    );
    expect(Number(stored?.livemode)).toBe(0);
    const grant = (await listEntries(ctx.db, "user_1", 5)).find((entry) => entry.kind === "grant");
    expect(grant?.livemode).toBe(false);
  });

  it("rejects a currency that does not match the pack and rolls back", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    await expect(
      handleStripeEvent(
        ctx.db,
        checkoutEvent({ id: "evt_eur", sessionId: "cs_eur", currency: "eur" }),
        testEnv,
      ),
    ).rejects.toThrow(/currency_mismatch/);
    const count = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM stripe_events`);
    expect(Number(count?.n)).toBe(0);
  });

  it("keeps balance equal to grants minus finalized spends, held reserves, and clawbacks", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    await handleStripeEvent(
      ctx.db,
      checkoutEvent({ id: "evt_inv", sessionId: "cs_inv", packId: "pack_100" }),
      testEnv,
    );
    await reserve(ctx.db, { userId: "user_1", amount: 30, idempotencyKey: "still_held" });
    await reserve(ctx.db, { userId: "user_1", amount: 20, idempotencyKey: "will_finalize" });
    await finalize(ctx.db, "user_1", "will_finalize");
    await track(ctx.db, { userId: "user_1", amount: 10, idempotencyKey: "tracked" });
    await reserve(ctx.db, { userId: "user_1", amount: 5, idempotencyKey: "will_release" });
    await release(ctx.db, "user_1", "will_release");

    const before = await balanceBreakdown(ctx.db, "user_1");
    expect(before.grants).toBe(100);
    expect(before.finalizedSpends).toBe(30);
    expect(before.heldReserves).toBe(30);
    expect(before.clawbacks).toBe(0);
    expect(before.expected).toBe(40);
    expect(before.balance).toBe(before.expected);

    await handleStripeEvent(
      ctx.db,
      {
        id: "evt_inv_refund",
        type: "charge.refunded",
        livemode: false,
        data: { object: { payment_intent: "pi_cs_inv" } },
      },
      testEnv,
    );
    const after = await balanceBreakdown(ctx.db, "user_1");
    expect(after.clawbacks).toBe(40);
    expect(after.expected).toBe(0);
    expect(after.balance).toBe(after.expected);
  });
});
