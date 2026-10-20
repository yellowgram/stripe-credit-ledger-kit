import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresDb, isPostgresUrl } from "../src/billing/db";
import { getBalance, grantCredits } from "../src/billing/ledger";
import { ensureSchema } from "../src/billing/schema";
import type { Db } from "../src/billing/types";
import { applyOrphanedClawbacks } from "../src/billing/webhook";
import { tempDb } from "./helpers";

// CL-9 (LaunchGate re-review, probe R3): the holds:reap backstop read the 200 oldest pending
// clawbacks whether or not a grant existed, so 200+ rows that can never match (refunds for things
// this ledger never sold) starved every newer, matchable row. CL-10: the committed backstop test
// failed on any database with that backlog. CL-11: a row consumed between read and lock counted
// as applied.

const insertPending = (db: Db, ids: { pi?: string; charge?: string; session?: string }, createdAt: string) =>
  db.run(
    `INSERT INTO pending_clawbacks (id, payment_intent_id, charge_id, checkout_session_id, stripe_event_id, note, created_at) VALUES (?, ?, ?, ?, ?, 'refund', ?)`,
    [randomUUID(), ids.pi ?? null, ids.charge ?? null, ids.session ?? null, `evt_${randomUUID()}`, createdAt],
  );

async function starvation(db: Db) {
  const old = new Date(Date.now() - 86_400_000).toISOString();
  for (let i = 0; i < 205; i++) await insertPending(db, { pi: `pi_never_${randomUUID()}` }, old);
  const user = `st_${randomUUID()}`;
  const pi = `pi_${randomUUID()}`;
  await grantCredits(db, { userId: user, credits: 100, packId: "pack_100", idempotencyKey: `g_${pi}`, paymentIntentId: pi });
  await insertPending(db, { pi }, new Date().toISOString());
  // The effect is asserted, not this call's count: another backstop run sharing the database may apply the row first.
  await applyOrphanedClawbacks(db);
  expect(await getBalance(db, user)).toBe(0);
  expect(await db.all(`SELECT id FROM pending_clawbacks WHERE payment_intent_id = ?`, [pi])).toHaveLength(0);
  // The unmatched rows are kept (their grant may still arrive), not dropped.
  const left = await db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM pending_clawbacks WHERE payment_intent_id LIKE 'pi_never_%'`);
  expect(Number(left[0]!.n)).toBeGreaterThanOrEqual(205);
}

async function matchesByChargeAndSession(db: Db) {
  const old = new Date(Date.now() - 86_400_000).toISOString();
  for (let i = 0; i < 205; i++) await insertPending(db, { charge: `ch_never_${randomUUID()}` }, old);
  const u1 = `stc_${randomUUID()}`; const ch = `ch_${randomUUID()}`;
  const u2 = `sts_${randomUUID()}`; const cs = `cs_${randomUUID()}`;
  await grantCredits(db, { userId: u1, credits: 50, packId: "pack_50", idempotencyKey: `g_${ch}`, paymentIntentId: `pi_${ch}`, chargeId: ch });
  await grantCredits(db, { userId: u2, credits: 70, packId: "pack_70", idempotencyKey: `g_${cs}`, paymentIntentId: `pi_${cs}`, checkoutSessionId: cs });
  await insertPending(db, { charge: ch }, new Date().toISOString());
  await insertPending(db, { session: cs }, new Date().toISOString());
  await applyOrphanedClawbacks(db);
  expect(await getBalance(db, u1)).toBe(0);
  expect(await getBalance(db, u2)).toBe(0);
}

async function consumedRowIsNotCounted(db: Db) {
  // Wrap the db so the pending row disappears right after the reaper's first read and before it
  // takes the lock, as if a racing grant had consumed it. The delete goes through the same
  // transaction (SQLite has one writer), which is what the re-check under the lock then reads.
  const user = `cl11_${randomUUID()}`; const pi = `pi_${randomUUID()}`;
  await grantCredits(db, { userId: user, credits: 30, packId: "pack_30", idempotencyKey: `g_${pi}`, paymentIntentId: pi });
  await insertPending(db, { pi }, new Date(0).toISOString());
  const racing: Db = {
    ...db,
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          ...tx,
          lockKeys: async (keys) => {
            await tx.run(`DELETE FROM pending_clawbacks WHERE payment_intent_id = ?`, [pi]);
            return tx.lockKeys(keys);
          },
        }),
      ),
  };
  const res = await applyOrphanedClawbacks(racing, 1);
  expect(res.applied).toBe(0);
  expect(await getBalance(db, user)).toBe(30);
}

describe("holds:reap backstop (CL-9, CL-10, CL-11)", () => {
  it("SQLite: 205 unmatchable rows ahead do not starve a matchable one", async () => {
    const { db, cleanup } = await tempDb();
    try { await starvation(db); } finally { await cleanup(); }
  });
  it("SQLite: rows that match by charge id or checkout session are found too", async () => {
    const { db, cleanup } = await tempDb();
    try { await matchesByChargeAndSession(db); } finally { await cleanup(); }
  });
  it("SQLite: a row consumed between read and lock is not counted as applied", async () => {
    const { db, cleanup } = await tempDb();
    try { await consumedRowIsNotCounted(db); } finally { await cleanup(); }
  });
  const url = process.env.DATABASE_URL;
  it.skipIf(!url || !isPostgresUrl(url))("Postgres: no starvation, all three ids match, consumed row not counted", async () => {
    const db = createPostgresDb(url!);
    try {
      await ensureSchema(db);
      await starvation(db);
      await matchesByChargeAndSession(db);
      await consumedRowIsNotCounted(db);
    } finally {
      // A shared database keeps no backlog from this test (an older backstop would starve on it).
      await db.run(`DELETE FROM pending_clawbacks WHERE payment_intent_id LIKE 'pi_never_%' OR charge_id LIKE 'ch_never_%' OR checkout_session_id LIKE 'cs_never_%'`, []);
      await db.close();
    }
  }, 60_000);
});
