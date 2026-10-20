import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, isPostgresUrl } from "../src/billing/db";
import { finalize, getBalance, grantCredits, reapExpiredHolds, release, reserve } from "../src/billing/ledger";
import { ensureSchema } from "../src/billing/schema";
import type { Db } from "../src/billing/types";

const databaseUrl = process.env.DATABASE_URL;
const suite = isPostgresUrl(databaseUrl) ? describe : describe.skip;

suite("postgres lock order", () => {
  let db: Db;

  beforeAll(async () => {
    db = createPostgresDb(databaseUrl as string);
    await ensureSchema(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("finalize and release racing six reapers never deadlock and settle each hold once", async () => {
    // The adapter retries a deadlock victim once, which would hide a lock-order bug.
    // Count the retries on a dedicated handle: any deadlock at all fails the test.
    const deadlocks: unknown[] = [];
    const outer = db;
    db = createPostgresDb(databaseUrl as string, { onDeadlockRetry: (e) => deadlocks.push(e) });
    try {
    const errors: string[] = [];
    for (let round = 0; round < 25; round++) {
      const users = Array.from({ length: 40 }, () => `dl_${randomUUID()}`);
      for (const u of users) {
        await grantCredits(db, { userId: u, credits: 10, packId: "pack_100", idempotencyKey: `g_${u}` });
        expect((await reserve(db, { userId: u, amount: 5, idempotencyKey: `r_${u}` })).ok).toBe(true);
      }
      // Age only these holds, so the reapers leave other suites' fresh holds alone.
      const aged = new Date(Date.now() - 2 * 3600_000).toISOString();
      for (const u of users) {
        await db.run(`UPDATE credit_ledger_entries SET created_at = ? WHERE user_id = ? AND kind = 'reserve'`, [aged, u]);
      }
      const ops: Promise<unknown>[] = [];
      users
        .slice()
        .reverse()
        .forEach((u, i) => {
          const settle = i % 4 === 3 ? release(db, u, `r_${u}`) : finalize(db, u, `r_${u}`);
          ops.push(settle.catch((e) => errors.push(String(e?.code ?? e?.message))));
        });
      for (let i = 0; i < 6; i++) {
        ops.push(reapExpiredHolds(db, { ttlSeconds: 3600 }).catch((e) => errors.push(String(e?.code ?? e?.message))));
      }
      await Promise.all(ops);
      for (const u of users) {
        const rows = await db.all<{ kind: string; status: string }>(
          `SELECT kind, status FROM credit_ledger_entries WHERE user_id = ? AND kind IN ('reserve', 'expire')`,
          [u],
        );
        const hold = rows.find((r) => r.kind === "reserve");
        const expires = rows.filter((r) => r.kind === "expire").length;
        expect(["finalized", "released", "expired"]).toContain(hold?.status);
        expect(expires).toBe(hold?.status === "expired" ? 1 : 0);
        const balance = await getBalance(db, u);
        expect(balance).toBe(hold?.status === "finalized" ? 5 : 10);
      }
    }
    expect(errors).toEqual([]);
    expect(deadlocks).toHaveLength(0);
    } finally {
      await db.close();
      db = outer;
    }
  }, 120_000);

  it("retries a transaction once when Postgres picks it as the deadlock victim", async () => {
    const a = `dlx_${randomUUID()}`;
    const b = `dlx_${randomUUID()}`;
    for (const u of [a, b]) await grantCredits(db, { userId: u, credits: 1, packId: "pack_100", idempotencyKey: `g_${u}` });
    let attempts = 0;
    let bothLocked: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      let n = 0;
      bothLocked = () => {
        n += 1;
        if (n === 2) resolve();
      };
    });
    const touch = (first: string, second: string, count: boolean) =>
      db.transaction(async (tx) => {
        if (count) attempts += 1;
        await tx.run(`UPDATE credit_balances SET updated_at = updated_at WHERE user_id = ?`, [first]);
        if (attempts <= 1 || !count) {
          bothLocked();
          await barrier;
        }
        await tx.run(`UPDATE credit_balances SET updated_at = updated_at WHERE user_id = ?`, [second]);
        return "ok";
      });
    // Opposite lock order across two users: Postgres aborts one side with 40P01.
    const results = await Promise.allSettled([touch(a, b, true), touch(b, a, false)]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(attempts).toBeLessThanOrEqual(2);
  }, 30_000);
});
