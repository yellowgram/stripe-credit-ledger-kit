import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresDb, isPostgresUrl } from "../src/billing/db";
import { balanceBreakdown, grantCredits, reserve } from "../src/billing/ledger";
import { ensureSchema } from "../src/billing/schema";
import type { Db } from "../src/billing/types";
import { tempDb } from "./helpers";

// balanceBreakdown is the invariant check (balance === expected). It used to read the entry sums
// and the balance in two statements, so a commit between them (a reaper expiring a hold) made a
// consistent ledger look broken. It now reads both in one statement: one snapshot.
function counting(db: Db): { db: Db; reads: () => number } {
  let n = 0;
  const wrapped: Db = {
    ...db,
    get: (sql: string, params?: unknown[]) => { n += 1; return db.get(sql, params as never); },
    all: (sql: string, params?: unknown[]) => { n += 1; return db.all(sql, params as never); },
    run: (sql: string, params?: unknown[]) => db.run(sql, params as never),
    transaction: (fn) => db.transaction(fn),
    close: () => db.close(),
  } as Db;
  return { db: wrapped, reads: () => n };
}

describe("balanceBreakdown reads one snapshot", () => {
  it("SQLite: one statement, correct values, and 0 for an unknown user", async () => {
    const { db, cleanup } = await tempDb();
    try {
      await grantCredits(db, { userId: "user_1", credits: 100, packId: "pack_100", idempotencyKey: "g1", paymentIntentId: "pi_1" });
      const held = await reserve(db, { userId: "user_1", amount: 7, idempotencyKey: "r1" });
      expect(held.ok).toBe(true);
      const c = counting(db);
      const b = await balanceBreakdown(c.db, "user_1");
      expect(c.reads()).toBe(1);
      expect(b).toMatchObject({ balance: 93, expected: 93, grants: 100, heldReserves: 7 });
      expect(await balanceBreakdown(db, "nobody")).toMatchObject({ balance: 0, expected: 0 });
    } finally { await cleanup(); }
  });
  const url = process.env.DATABASE_URL;
  it.skipIf(!url || !isPostgresUrl(url))("Postgres: one statement, correct values", async () => {
    const db = createPostgresDb(url!);
    try {
      await ensureSchema(db);
      const user = `bd_${randomUUID()}`;
      await grantCredits(db, { userId: user, credits: 100, packId: "pack_100", idempotencyKey: `g_${user}`, paymentIntentId: `pi_${user}` });
      await reserve(db, { userId: user, amount: 7, idempotencyKey: "r1" });
      const c = counting(db);
      const b = await balanceBreakdown(c.db, user);
      expect(c.reads()).toBe(1);
      expect(b).toMatchObject({ balance: 93, expected: 93 });
    } finally { await db.close(); }
  });
});
