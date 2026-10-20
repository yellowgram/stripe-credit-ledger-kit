import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, isPostgresUrl } from "../src/billing/db";
import { balanceBreakdown, finalize, getBalance, grantCredits, reapExpiredHolds, release, reserve } from "../src/billing/ledger";
import { ensureSchema } from "../src/billing/schema";
import type { Db, TxExecutor } from "../src/billing/types";
import { applyOrphanedClawbacks, handleStripeEvent } from "../src/billing/webhook";
import { checkoutEvent } from "./helpers";

const databaseUrl = process.env.DATABASE_URL;
const suite = isPostgresUrl(databaseUrl) ? describe : describe.skip;

/** A Db whose transactions pause once, right after the first statement matching `pauseOn` returns. */
function pausingDb(db: Db, pauseOn: RegExp) {
  let paused!: () => void;
  const reached = new Promise<void>((r) => (paused = r));
  let resume!: () => void;
  const released = new Promise<void>((r) => (resume = r));
  let done = false;
  const gate = async (sql: string) => {
    if (!done && pauseOn.test(sql)) {
      done = true;
      paused();
      await released;
    }
  };
  const wrapped: Db = {
    ...db,
    transaction: (fn) =>
      db.transaction(async (tx) => {
        const w: TxExecutor = {
          lockKeys: tx.lockKeys.bind(tx),
          run: tx.run.bind(tx),
          get: async (sql, p) => {
            const row = await tx.get(sql, p);
            await gate(sql);
            return row as never;
          },
          all: async (sql, p) => {
            const rows = await tx.all(sql, p);
            await gate(sql);
            return rows as never;
          },
        };
        return fn(w);
      }),
  };
  return { db: wrapped, reached, resume };
}

const settledWithin = (p: Promise<unknown>, ms: number) =>
  Promise.race([p.then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), ms))]);

suite("postgres grant vs refund race (CL-1)", () => {
  let db: Db;
  const deadlocks: unknown[] = [];

  beforeAll(async () => {
    db = createPostgresDb(databaseUrl as string, { onDeadlockRetry: (e) => deadlocks.push(e) });
    await ensureSchema(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("a refund arriving while the grant transaction is open waits for it, then claws back", async () => {
    const user = `race_${randomUUID()}`;
    const session = `cs_${randomUUID()}`;
    const pi = `pi_${session}`;
    // Pause the grant right after it looked for pending clawbacks (and found none).
    const g = pausingDb(db, /FROM pending_clawbacks/);
    const grantP = handleStripeEvent(g.db, checkoutEvent({ id: `evt_g_${session}`, sessionId: session, userId: user }));
    await g.reached;
    const refundP = handleStripeEvent(db, {
      id: `evt_r_${session}`,
      type: "charge.refunded",
      livemode: false,
      data: { object: { id: `ch_${session}`, object: "charge", payment_intent: pi } },
    });
    // Without the per-payment lock the refund finishes here as pending_clawback and is lost.
    expect(await settledWithin(refundP, 400)).toBe(false);
    g.resume();
    await grantP;
    const refund = await refundP;
    expect(refund.reason).toBe("clawed_back");
    expect(await getBalance(db, user)).toBe(0);
    const pending = await db.all(`SELECT id FROM pending_clawbacks WHERE payment_intent_id = ?`, [pi]);
    expect(pending).toHaveLength(0);
  });

  it("a grant arriving while the refund transaction is open waits for it, then consumes the pending clawback", async () => {
    const user = `race_${randomUUID()}`;
    const session = `cs_${randomUUID()}`;
    const pi = `pi_${session}`;
    // Pause the refund right after it looked for the grant (and found none).
    const r = pausingDb(db, /kind = 'grant'/);
    const refundP = handleStripeEvent(r.db, {
      id: `evt_r_${session}`,
      type: "charge.refunded",
      livemode: false,
      data: { object: { id: `ch_${session}`, object: "charge", payment_intent: pi } },
    });
    await r.reached;
    const grantP = handleStripeEvent(db, checkoutEvent({ id: `evt_g_${session}`, sessionId: session, userId: user }));
    expect(await settledWithin(grantP, 400)).toBe(false);
    r.resume();
    await refundP;
    await grantP;
    expect(await getBalance(db, user)).toBe(0);
    const pending = await db.all(`SELECT id FROM pending_clawbacks WHERE payment_intent_id = ?`, [pi]);
    expect(pending).toHaveLength(0);
  });

  it("holds:reap applies a pending clawback whose grant already exists (backstop)", async () => {
    const user = `orphan_${randomUUID()}`;
    const pi = `pi_${randomUUID()}`;
    await grantCredits(db, { userId: user, credits: 100, packId: "pack_100", idempotencyKey: `g_${pi}`, paymentIntentId: pi });
    // A row left behind by an older version (or a grant written outside the webhook path).
    await db.run(
      `INSERT INTO pending_clawbacks (id, payment_intent_id, charge_id, checkout_session_id, stripe_event_id, note, created_at)
       VALUES (?, ?, NULL, NULL, ?, 'refund', ?)`,
      [randomUUID(), pi, `evt_orphan_${pi}`, new Date().toISOString()],
    );
    expect(await getBalance(db, user)).toBe(100);
    const first = await applyOrphanedClawbacks(db);
    expect(first.applied).toBeGreaterThanOrEqual(1);
    expect(await getBalance(db, user)).toBe(0);
    expect(await db.all(`SELECT id FROM pending_clawbacks WHERE payment_intent_id = ?`, [pi])).toHaveLength(0);
    const b = await balanceBreakdown(db, user);
    expect(b.balance).toBe(b.expected);
  });

  it("refunds and disputes (with duplicates) racing reserve/finalize/release/reaper keep the invariants", async () => {
    const errors: string[] = [];
    for (let round = 0; round < 8; round++) {
      const user = `rf_${randomUUID()}`;
      const sessions = Array.from({ length: 4 }, () => `cs_${randomUUID()}`);
      for (const s of sessions) await handleStripeEvent(db, checkoutEvent({ id: `evt_${s}`, sessionId: s, userId: user }));
      const ops: Promise<unknown>[] = [];
      const fail = (e: { code?: string; message?: string }) => errors.push(String(e?.code ?? e?.message));
      for (let i = 0; i < 40; i++) ops.push(reserve(db, { userId: user, amount: 7, idempotencyKey: `r${i}` }).catch(fail));
      for (let i = 0; i < 40; i++) ops.push((i % 2 ? finalize(db, user, `r${i}`) : release(db, user, `r${i}`)).catch(fail));
      for (const s of sessions.slice(0, 2)) {
        for (const id of [`evt_r_${s}`, `evt_r_${s}`, `evt_d_${s}`]) {
          ops.push(
            handleStripeEvent(db, {
              id,
              type: id.includes("_d_") ? "charge.dispute.created" : "charge.refunded",
              livemode: false,
              data: { object: { id: `ch_${s}`, object: "charge", payment_intent: `pi_${s}` } },
            }).catch(fail),
          );
        }
      }
      for (let i = 0; i < 4; i++) ops.push(reapExpiredHolds(db, { ttlSeconds: 0 }).catch(fail));
      await Promise.all(ops);
      const b = await balanceBreakdown(db, user);
      expect(b.balance).toBeGreaterThanOrEqual(0);
      expect(b.balance).toBe(b.expected);
      const claws = await db.all(`SELECT id FROM credit_ledger_entries WHERE user_id = ? AND kind = 'clawback'`, [user]);
      expect(claws).toHaveLength(2);
    }
    expect(errors).toEqual([]);
    expect(deadlocks).toHaveLength(0);
  }, 120_000);
});
