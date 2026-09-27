import { randomUUID } from "node:crypto";
import { LedgerError } from "../billing/errors";
import { getBalance, grantCredits, listHeldReservations, release, track, unpauseUser } from "../billing/ledger";
import type { Db } from "../billing/types";
import { runDemoGeneration, type DemoCallResult } from "./llm";

/** Demo-only. Releases holds, then moves the spendable balance to `target`. */
export async function resetDemoUser(db: Db, userId: string, target = 100): Promise<{ balance: number }> {
  if (!Number.isSafeInteger(target) || target < 0) {
    throw new LedgerError("invalid_target");
  }
  await unpauseUser(db, userId);
  const held = await listHeldReservations(db, userId);
  for (const reservation of held) {
    await release(db, userId, reservation.idempotencyKey);
  }
  const balance = await getBalance(db, userId);
  if (balance === target) return { balance };
  const stamp = randomUUID();
  if (balance < target) {
    await grantCredits(db, {
      userId,
      credits: target - balance,
      packId: "demo_reset",
      idempotencyKey: `demo_reset:${userId}:${stamp}`,
      note: "Demo reset",
    });
  } else {
    const spent = await track(db, {
      userId,
      amount: balance - target,
      idempotencyKey: `demo_reset:${userId}:${stamp}`,
      note: "Demo reset",
    });
    if (!spent.ok) throw new LedgerError("demo_reset_failed");
  }
  return { balance: await getBalance(db, userId) };
}

/**
 * Puts the balance exactly at `amount`, then fires two spends of that amount.
 * One must succeed and one must come back insufficient. The winner is finalized.
 */
export async function runLastCreditRace(
  db: Db,
  userId: string,
  amount: number,
): Promise<{ amount: number; balance: number; successes: number; results: [DemoCallResult, DemoCallResult] }> {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new LedgerError("amount_must_be_positive_integer");
  }
  await resetDemoUser(db, userId, amount);
  const results = (await Promise.all([
    runDemoGeneration(db, { userId, credits: amount, fail: false }),
    runDemoGeneration(db, { userId, credits: amount, fail: false }),
  ])) as [DemoCallResult, DemoCallResult];
  const successes = results.filter((result) => result.ok).length;
  return {
    amount,
    balance: await getBalance(db, userId),
    successes,
    results,
  };
}
