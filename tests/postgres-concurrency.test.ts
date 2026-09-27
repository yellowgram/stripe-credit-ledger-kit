import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, isPostgresUrl } from "../src/billing/db";
import { getBalance, grantCredits, reserve } from "../src/billing/ledger";
import { ensureSchema, migrate } from "../src/billing/schema";
import type { Db } from "../src/billing/types";
import { handleStripeEvent } from "../src/billing/webhook";
import { checkoutEvent, runChild } from "./helpers";

const databaseUrl = process.env.DATABASE_URL;
const suite = isPostgresUrl(databaseUrl) ? describe : describe.skip;

suite("postgres concurrency", () => {
  let db: Db;

  beforeAll(async () => {
    db = createPostgresDb(databaseUrl as string);
    await ensureSchema(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("lets one of two processes take the last credits", async () => {
    const userId = `pg_${randomUUID()}`;
    await grantCredits(db, {
      userId,
      credits: 10,
      packId: "pack_100",
      idempotencyKey: `grant_${userId}`,
    });
    const worker = path.resolve("tests/workers/reserve-once.ts");
    const [left, right] = await Promise.all([
      runChild<{ ok: boolean; error?: string }>(worker, {
        databaseUrl,
        userId,
        amount: 10,
        idempotencyKey: `${userId}_left`,
      }),
      runChild<{ ok: boolean; error?: string }>(worker, {
        databaseUrl,
        userId,
        amount: 10,
        idempotencyKey: `${userId}_right`,
      }),
    ]);
    expect([left, right].filter((result) => result.ok)).toHaveLength(1);
    expect([left, right].filter((result) => result.error === "insufficient_credits")).toHaveLength(1);
    expect(await getBalance(db, userId)).toBe(0);
    await db.run(`DELETE FROM credit_ledger_entries WHERE user_id = ?`, [userId]);
    await db.run(`DELETE FROM credit_balances WHERE user_id = ?`, [userId]);
  });

  it("grants a webhook once across two processes and ignores the replay", async () => {
    const userId = `pg_${randomUUID()}`;
    const eventId = `evt_${userId}`;
    const sessionId = `cs_${userId}`;
    const event = checkoutEvent({
      id: eventId,
      sessionId,
      userId,
      packId: "pack_100",
      credits: 100,
    });
    const worker = path.resolve("tests/workers/webhook-once.ts");
    const [left, right] = await Promise.all([
      runChild<{ granted: boolean; duplicate: boolean }>(worker, { databaseUrl, event }),
      runChild<{ granted: boolean; duplicate: boolean }>(worker, { databaseUrl, event }),
    ]);
    expect([left, right].filter((result) => result.granted)).toHaveLength(1);
    expect([left, right].filter((result) => result.duplicate)).toHaveLength(1);
    expect(await getBalance(db, userId)).toBe(100);

    const replay = await handleStripeEvent(db, event, { STRIPE_SECRET_KEY: "sk_test_ci" });
    expect(replay).toMatchObject({ duplicate: true, granted: false, reason: "duplicate_event" });
    expect(await getBalance(db, userId)).toBe(100);

    await db.run(`DELETE FROM credit_ledger_entries WHERE user_id = ?`, [userId]);
    await db.run(`DELETE FROM credit_balances WHERE user_id = ?`, [userId]);
    await db.run(`DELETE FROM stripe_events WHERE id = ?`, [eventId]);
  });

  it("rejects a NULL idempotency key and does not double-expire a hold", async () => {
    expect(await migrate(db)).toEqual([]);
    const userId = `pg_${randomUUID()}`;
    await expect(
      db.run(
        `INSERT INTO credit_ledger_entries
          (id, user_id, delta, kind, idempotency_key, created_at, seq)
         VALUES (?, ?, 1, 'grant', NULL, '2020-01-01T00:00:00.000Z', 1)`,
        [`null_${userId}`, userId],
      ),
    ).rejects.toThrow(/null_idempotency_key/);

    await grantCredits(db, {
      userId,
      credits: 30,
      packId: "pack_100",
      idempotencyKey: `grant_${userId}`,
    });
    const held = await reserve(db, { userId, amount: 10, idempotencyKey: `${userId}_hold` });
    expect(held.ok).toBe(true);
    const worker = path.resolve("tests/workers/reap-once.ts");
    const now = new Date(Date.now() + 60_000).toISOString();
    const [left, right] = await Promise.all([
      runChild<{ expired: number }>(worker, { databaseUrl, now, ttlSeconds: 1 }),
      runChild<{ expired: number }>(worker, { databaseUrl, now, ttlSeconds: 1 }),
    ]);
    expect(left.expired + right.expired).toBe(1);
    expect(await getBalance(db, userId)).toBe(30);
    await db.run(`DELETE FROM credit_ledger_entries WHERE user_id = ?`, [userId]);
    await db.run(`DELETE FROM credit_balances WHERE user_id = ?`, [userId]);
  });
});
