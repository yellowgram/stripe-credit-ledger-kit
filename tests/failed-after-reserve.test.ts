import { afterEach, describe, expect, it } from "vitest";
import { check, finalize, getBalance, grantCredits, listEntries, release, reserve, track } from "../src/billing/ledger";
import { runDemoGeneration } from "../src/demo/llm";
import { tempDb } from "./helpers";

describe("failed call after reserve", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      const cleanup = cleanups.pop();
      if (cleanup) await cleanup();
    }
  });

  it("releases the reservation when the provider fails and does not refund twice", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    await grantCredits(ctx.db, {
      userId: "user_1",
      credits: 100,
      packId: "pack_100",
      idempotencyKey: "grant_start",
    });

    const failed = await runDemoGeneration(ctx.db, {
      userId: "user_1",
      credits: 40,
      fail: true,
      idempotencyKey: "call_fail",
    });
    expect(failed.ok).toBe(false);
    expect(failed.error).toBe("llm_failed_credits_released");
    expect(failed.detail).toBe("provider_500");
    expect(await getBalance(ctx.db, "user_1")).toBe(100);

    const entries = await listEntries(ctx.db, "user_1", 20);
    expect(entries.map((entry) => entry.kind).sort()).toEqual(["grant", "release", "reserve"]);
    expect(entries.find((entry) => entry.kind === "reserve")?.status).toBe("released");
    expect(entries.reduce((sum, entry) => sum + entry.delta, 0)).toBe(100);

    const secondRelease = await release(ctx.db, "call_fail");
    expect(secondRelease.ok).toBe(true);
    if (secondRelease.ok) expect(secondRelease.replay).toBe(true);
    expect(await getBalance(ctx.db, "user_1")).toBe(100);

    const succeeded = await runDemoGeneration(ctx.db, {
      userId: "user_1",
      credits: 40,
      fail: false,
      idempotencyKey: "call_ok",
    });
    expect(succeeded.ok).toBe(true);
    expect(succeeded.output).toContain("No model was called");
    expect(await getBalance(ctx.db, "user_1")).toBe(60);

    const finalizeReplay = await finalize(ctx.db, "call_ok");
    expect(finalizeReplay.ok).toBe(true);
    if (finalizeReplay.ok) expect(finalizeReplay.replay).toBe(true);
    expect(await getBalance(ctx.db, "user_1")).toBe(60);

    const blockedRelease = await release(ctx.db, "call_ok");
    expect(blockedRelease.ok).toBe(false);
    if (!blockedRelease.ok) expect(blockedRelease.error).toBe("already_finalized");
    expect(await getBalance(ctx.db, "user_1")).toBe(60);

    expect(await check(ctx.db, "user_1", 60)).toEqual({ ok: true, balance: 60 });
    expect(await check(ctx.db, "user_1", 61)).toEqual({ ok: false, balance: 60 });
  });

  it("does not burn an idempotency key that failed for insufficient credits", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    await grantCredits(ctx.db, {
      userId: "user_1",
      credits: 15,
      packId: "pack_100",
      idempotencyKey: "grant_small",
    });

    const denied = await reserve(ctx.db, { userId: "user_1", amount: 40, idempotencyKey: "retry_me" });
    expect(denied.ok).toBe(false);
    expect(await getBalance(ctx.db, "user_1")).toBe(15);

    const later = await reserve(ctx.db, { userId: "user_1", amount: 10, idempotencyKey: "retry_me" });
    expect(later.ok).toBe(true);
    if (later.ok) expect(later.replay).toBe(false);
    expect(await getBalance(ctx.db, "user_1")).toBe(5);
    await release(ctx.db, "retry_me");
    expect(await getBalance(ctx.db, "user_1")).toBe(15);
  });

  it("tracks the same key at most once", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    await grantCredits(ctx.db, {
      userId: "user_1",
      credits: 30,
      packId: "pack_100",
      idempotencyKey: "grant_track",
    });
    const first = await track(ctx.db, { userId: "user_1", amount: 10, idempotencyKey: "track_1" });
    const second = await track(ctx.db, { userId: "user_1", amount: 10, idempotencyKey: "track_1" });
    expect(first).toMatchObject({ ok: true, replay: false, balance: 20 });
    expect(second).toMatchObject({ ok: true, replay: true, balance: 20 });
    expect(await getBalance(ctx.db, "user_1")).toBe(20);
  });
});
