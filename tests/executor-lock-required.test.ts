import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresDb, isPostgresUrl } from "../src/billing/db";
import { getBalance, grantCredits } from "../src/billing/ledger";
import { ensureSchema } from "../src/billing/schema";
import type { Db, Executor } from "../src/billing/types";
import { applyOrphanedClawbacks, handleStripeEvent } from "../src/billing/webhook";
import { checkoutEvent, tempDb } from "./helpers";

// CL-8 (LaunchGate re-review): the per-payment lock used to be optional, so a hand-written
// Executor without lockKeys (LaunchGate's probe-race.test.ts wrapper) silently lost a refund
// that raced its grant on Postgres. The lock is now required: such an executor is refused.

/** LaunchGate's wrapper shape: forwards get/run/all only, drops lockKeys. */
function withoutLockKeys(db: Db): Db {
  return {
    ...db,
    transaction: (fn) =>
      db.transaction(async (tx) => {
        const w: Executor = { get: tx.get.bind(tx), run: tx.run.bind(tx), all: tx.all.bind(tx) };
        return fn(w as never);
      }),
  };
}

async function refusesWithoutLock(db: Db) {
  const user = `nolock_${randomUUID()}`;
  const session = `cs_${randomUUID()}`;
  const pi = `pi_${session}`;
  const bare = withoutLockKeys(db);
  await expect(handleStripeEvent(bare, checkoutEvent({ id: `evt_g_${session}`, sessionId: session, userId: user }))).rejects.toThrow(
    "executor_missing_lockKeys",
  );
  await expect(
    handleStripeEvent(bare, {
      id: `evt_r_${session}`, type: "charge.refunded", livemode: false,
      data: { object: { id: `ch_${session}`, object: "charge", payment_intent: pi } },
    } as never),
  ).rejects.toThrow("executor_missing_lockKeys");
  // The holds:reap backstop refuses it too, once there is a pending clawback it can apply
  // (it only picks rows with a matching grant, CL-9).
  const pi2 = `pi_bs_${randomUUID()}`;
  await grantCredits(db, { userId: `${user}_bs`, credits: 10, packId: "pack_10", idempotencyKey: `g_${pi2}`, paymentIntentId: pi2 });
  await db.run(
    `INSERT INTO pending_clawbacks (id, payment_intent_id, charge_id, checkout_session_id, stripe_event_id, note, created_at) VALUES (?, ?, NULL, NULL, ?, 'refund', ?)`,
    [randomUUID(), pi2, `evt_bs_${pi2}`, new Date().toISOString()],
  );
  await expect(applyOrphanedClawbacks(bare)).rejects.toThrow("executor_missing_lockKeys");
  expect(await getBalance(db, `${user}_bs`)).toBe(10); // rolled back: nothing applied without the lock
  await applyOrphanedClawbacks(db); // the shipped adapter applies it
  expect(await getBalance(db, `${user}_bs`)).toBe(0);
  // Nothing was granted (the transaction rolled back), so nothing refunded can stay spendable.
  expect(await getBalance(db, user)).toBe(0);
  const grants = await db.all(`SELECT id FROM credit_ledger_entries WHERE kind = 'grant' AND user_id = ?`, [user]);
  expect(grants).toHaveLength(0);
  // The shipped adapter still works.
  const ok = await handleStripeEvent(db, checkoutEvent({ id: `evt_ok_${session}`, sessionId: `${session}_ok`, userId: user }));
  expect(ok.granted).toBe(true);
}

describe("an Executor without lockKeys is refused (CL-8)", () => {
  it("SQLite: webhook handlers refuse a transaction executor without lockKeys", async () => {
    const { db, cleanup } = await tempDb();
    try {
      await refusesWithoutLock(db);
    } finally {
      await cleanup();
    }
  });

  const pg = isPostgresUrl(process.env.DATABASE_URL) ? it : it.skip;
  pg("Postgres: LaunchGate's probe-race wrapper is refused instead of losing the refund", async () => {
    const db = createPostgresDb(process.env.DATABASE_URL as string);
    try {
      await ensureSchema(db);
      await refusesWithoutLock(db);
    } finally {
      await db.close();
    }
  });
});
