import Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { getBalance } from "../src/billing/ledger";
import { PACKS } from "../src/billing/packs";
import { toPostgresParams } from "../src/billing/db";
import { handleStripeEvent, verifyStripeEvent } from "../src/billing/webhook";
import path from "node:path";
import { checkoutEvent, runChild, tempDb } from "./helpers";

const secret = `whsec_${Buffer.from("credit-ledger-test-secret").toString("base64")}`;
const stripe = new Stripe("sk_test_signature_only");

describe("webhook idempotency", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      const cleanup = cleanups.pop();
      if (cleanup) await cleanup();
    }
  });

  it("ships three credit packs", () => {
    expect(PACKS.map((pack) => pack.id)).toEqual(["pack_100", "pack_500", "pack_2000"]);
    expect(new Set(PACKS.map((pack) => pack.credits)).size).toBe(3);
  });

  it("converts placeholders for Postgres", () => {
    expect(toPostgresParams("select ? where ?")).toBe("select $1 where $2");
  });

  it("rejects a bad signature and accepts a good one", () => {
    const payload = JSON.stringify({
      id: "evt_sig",
      object: "event",
      type: "checkout.session.completed",
      data: { object: { id: "cs_sig" } },
    });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(verifyStripeEvent(stripe, payload, header, secret).id).toBe("evt_sig");
    expect(() => verifyStripeEvent(stripe, payload, "t=1,v1=deadbeef", secret)).toThrow();
    expect(() => verifyStripeEvent(stripe, payload, null, secret)).toThrow(/missing_signature/);
  });

  it("grants once when the same event is delivered twice", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    const event = checkoutEvent({ id: "evt_1", sessionId: "cs_1", credits: 100, packId: "pack_100" });

    const first = await handleStripeEvent(ctx.db, event);
    const second = await handleStripeEvent(ctx.db, event);

    expect(first).toMatchObject({ duplicate: false, granted: true });
    expect(second).toMatchObject({ duplicate: true, granted: false, reason: "duplicate_event" });
    expect(await getBalance(ctx.db, "user_1")).toBe(100);

    const count = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM stripe_events`);
    expect(Number(count?.n)).toBe(1);
    const grants = await ctx.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM credit_ledger_entries WHERE kind = 'grant'`,
    );
    expect(Number(grants?.n)).toBe(1);
  });

  it("does not grant when two connections deliver the same event together", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    const event = checkoutEvent({ id: "evt_race", sessionId: "cs_race", credits: 500, packId: "pack_500" });
    const worker = path.resolve("tests/workers/webhook-once.ts");

    const [left, right] = await Promise.all([
      runChild<{ granted: boolean; duplicate: boolean; reason?: string }>(worker, {
        dbPath: ctx.file,
        event,
      }),
      runChild<{ granted: boolean; duplicate: boolean; reason?: string }>(worker, {
        dbPath: ctx.file,
        event,
      }),
    ]);
    const granted = [left, right].filter((result) => result.granted);
    const duplicates = [left, right].filter((result) => result.duplicate);
    expect(granted).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
    expect(await getBalance(ctx.db, "user_1")).toBe(500);
  });

  it("rolls back the event row when the paid amount does not match the pack", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    const event = checkoutEvent({
      id: "evt_bad",
      sessionId: "cs_bad",
      credits: 99999,
      packId: "pack_100",
      amountTotal: 1,
    });

    await expect(handleStripeEvent(ctx.db, event)).rejects.toThrow(/amount_mismatch/);
    expect(await getBalance(ctx.db, "user_1")).toBe(0);
    const count = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM stripe_events`);
    expect(Number(count?.n)).toBe(0);
  });

  it("grants catalog credits when metadata.credits disagrees with the pack", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    const event = checkoutEvent({
      id: "evt_meta",
      sessionId: "cs_meta",
      credits: 99999,
      packId: "pack_100",
    });
    const result = await handleStripeEvent(ctx.db, event);
    expect(result.granted).toBe(true);
    expect(await getBalance(ctx.db, "user_1")).toBe(100);
  });
});
