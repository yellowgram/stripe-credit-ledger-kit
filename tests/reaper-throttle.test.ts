import { afterEach, describe, expect, it, vi } from "vitest";
import { getBalance, grantCredits, OPPORTUNISTIC_REAP_INTERVAL_MS, reserve } from "../src/billing/ledger";
import { tempDb } from "./helpers";

describe("opportunistic reap in reserve()", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CREDIT_HOLD_TTL_SECONDS;
  });

  it("reaps at most once per interval, so reserve does not scan holds on every call", async () => {
    process.env.CREDIT_HOLD_TTL_SECONDS = "1";
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2030-01-01T00:00:00.000Z");
    vi.setSystemTime(start);
    const ctx = await tempDb();
    try {
      await grantCredits(ctx.db, { userId: "u1", credits: 10, packId: "pack_100", idempotencyKey: "g1" });
      expect((await reserve(ctx.db, { userId: "u1", amount: 10, idempotencyKey: "h1" })).ok).toBe(true);

      // The hold is past its TTL, but reserve() reaped less than the interval ago.
      vi.setSystemTime(new Date(start.getTime() + 5_000));
      expect(await reserve(ctx.db, { userId: "u1", amount: 1, idempotencyKey: "h2" })).toMatchObject({ ok: false });
      expect(await getBalance(ctx.db, "u1")).toBe(0);

      // After the interval, the next reserve() reaps first and the credits are back.
      vi.setSystemTime(new Date(start.getTime() + OPPORTUNISTIC_REAP_INTERVAL_MS + 1_000));
      expect((await reserve(ctx.db, { userId: "u1", amount: 1, idempotencyKey: "h3" })).ok).toBe(true);
      expect(await getBalance(ctx.db, "u1")).toBe(9);
    } finally {
      await ctx.cleanup();
    }
  });
});
