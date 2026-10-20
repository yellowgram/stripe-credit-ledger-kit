import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresDb, isPostgresUrl } from "../src/billing/db";
import { getBalance } from "../src/billing/ledger";
import { ensureSchema } from "../src/billing/schema";
import type { Db } from "../src/billing/types";
import { handleStripeEvent } from "../src/billing/webhook";
import { checkoutEvent, tempDb } from "./helpers";

// CL-R1 (round 3): a custom Postgres adapter whose lockKeys is a type-correct no-op (copied from
// the SQLite adapter) let a refund race its grant and sit parked until the next holds:reap. The
// handlers now check pg_locks after lockKeys and refuse the event (lock_not_held), so the
// transaction rolls back and Stripe retries it.

function withLock(db: Db, lockKeys: (q: (sql: string, params: unknown[]) => Promise<unknown>, keys: readonly string[]) => Promise<void>): Db {
  return {
    ...db,
    transaction: (fn) => db.transaction(async (tx) => fn({ ...tx, lockKeys: (keys) => lockKeys((s, p) => tx.run(s, p as never), keys) })),
  };
}
const noop = withLockFactory(async () => {});
function withLockFactory(f: (q: (sql: string, params: unknown[]) => Promise<unknown>, keys: readonly string[]) => Promise<void>) { return (db: Db) => withLock(db, f); }
// A correct hand-written lock, deliberately not the shipped code: one key at a time, unsorted.
const ownAdvisory = withLockFactory(async (q, keys) => { for (const k of keys) if (k) await q(`SELECT pg_advisory_xact_lock(hashtext(?))`, [k]); });
const refund = (session: string) => ({
  id: `evt_r_${session}`, type: "charge.refunded", livemode: false,
  data: { object: { id: `ch_${session}`, object: "charge", payment_intent: `pi_${session}` } },
}) as never;

async function grantThenRefund(db: Db, wrapped: Db) {
  const user = `lk_${randomUUID()}`;
  const session = `cs_${randomUUID()}`;
  return { user, grant: () => handleStripeEvent(wrapped, checkoutEvent({ id: `evt_g_${session}`, sessionId: session, userId: user })), refund: () => handleStripeEvent(wrapped, refund(session)), session, db };
}

describe("lockKeys is verified on Postgres (CL-R1)", () => {
  const url = process.env.DATABASE_URL;
  it.skipIf(!url || !isPostgresUrl(url))("a no-op lockKeys is refused (lock_not_held) and nothing changes; the shipped adapter then applies it", async () => {
    const db = createPostgresDb(url!);
    try {
      await ensureSchema(db);
      const t = await grantThenRefund(db, noop(db));
      await expect(t.grant()).rejects.toThrow("lock_not_held");
      expect(await getBalance(db, t.user)).toBe(0);
      await handleStripeEvent(db, checkoutEvent({ id: `evt_g_${t.session}`, sessionId: t.session, userId: t.user }));
      const granted = await getBalance(db, t.user);
      expect(granted).toBeGreaterThan(0);
      await expect(t.refund()).rejects.toThrow("lock_not_held");
      expect(await getBalance(db, t.user)).toBe(granted);
      expect(await db.all(`SELECT id FROM pending_clawbacks WHERE payment_intent_id = ?`, [`pi_${t.session}`])).toHaveLength(0);
      await handleStripeEvent(db, refund(t.session)); // Stripe's retry, through a correct adapter
      expect(await getBalance(db, t.user)).toBe(0);
    } finally { await db.close(); }
  });
  it.skipIf(!url || !isPostgresUrl(url))("a hand-written lock that takes pg_advisory_xact_lock(hashtext(key)) is accepted", async () => {
    const db = createPostgresDb(url!);
    try {
      await ensureSchema(db);
      const t = await grantThenRefund(db, ownAdvisory(db));
      expect((await t.grant()).granted).toBe(true);
      await t.refund();
      expect(await getBalance(db, t.user)).toBe(0);
    } finally { await db.close(); }
  });
  it("SQLite: the shipped adapter and a custom no-op adapter still work (BEGIN IMMEDIATE serializes)", async () => {
    const { db, cleanup } = await tempDb();
    try {
      for (const d of [db, noop(db)]) {
        const t = await grantThenRefund(db, d);
        expect((await t.grant()).granted).toBe(true);
        await t.refund();
        expect(await getBalance(db, t.user)).toBe(0);
      }
    } finally { await cleanup(); }
  });
});
