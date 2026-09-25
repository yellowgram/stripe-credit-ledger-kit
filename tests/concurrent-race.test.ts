import { afterEach, describe, expect, it } from "vitest";
import { getBalance, grantCredits, reserve } from "../src/billing/ledger";
import path from "node:path";
import { runLastCreditRace } from "../src/demo/reset";
import { runChild, tempDb } from "./helpers";

describe("concurrent last-credit race", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      const cleanup = cleanups.pop();
      if (cleanup) await cleanup();
    }
  });

  it("lets only one of two connections take the last credits", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    await grantCredits(ctx.db, {
      userId: "user_1",
      credits: 10,
      packId: "pack_100",
      idempotencyKey: "grant_race",
    });

    const worker = path.resolve("tests/workers/reserve-once.ts");
    const [left, right] = await Promise.all([
      runChild<{ ok: boolean; error?: string; balance?: number }>(worker, {
        dbPath: ctx.file,
        userId: "user_1",
        amount: 10,
        idempotencyKey: "race_left",
      }),
      runChild<{ ok: boolean; error?: string; balance?: number }>(worker, {
        dbPath: ctx.file,
        userId: "user_1",
        amount: 10,
        idempotencyKey: "race_right",
      }),
    ]);
    expect([left, right].filter((result) => result.ok)).toHaveLength(1);
    expect([left, right].filter((result) => result.error === "insufficient_credits")).toHaveLength(1);
    expect(await getBalance(ctx.db, "user_1")).toBe(0);

    const third = await reserve(ctx.db, { userId: "user_1", amount: 1, idempotencyKey: "race_third" });
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error).toBe("insufficient_credits");
  });

  it("keeps both spends when the balance covers both", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    await grantCredits(ctx.db, {
      userId: "user_1",
      credits: 10,
      packId: "pack_100",
      idempotencyKey: "grant_both",
    });
    const worker = path.resolve("tests/workers/reserve-once.ts");
    const [left, right] = await Promise.all([
      runChild<{ ok: boolean }>(worker, {
        dbPath: ctx.file,
        userId: "user_1",
        amount: 4,
        idempotencyKey: "both_left",
      }),
      runChild<{ ok: boolean }>(worker, {
        dbPath: ctx.file,
        userId: "user_1",
        amount: 4,
        idempotencyKey: "both_right",
      }),
    ]);
    expect(left.ok && right.ok).toBe(true);
    expect(await getBalance(ctx.db, "user_1")).toBe(2);
  });

  it("runs the demo race as one success and one insufficient", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    const race = await runLastCreditRace(ctx.db, "user_1", 10);
    expect(race.successes).toBe(1);
    expect(race.balance).toBe(0);
    expect(race.results.filter((result) => result.error === "insufficient_credits")).toHaveLength(1);
  });
});
