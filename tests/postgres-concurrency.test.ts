import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, isPostgresUrl } from "../src/billing/db";
import { getBalance, grantCredits } from "../src/billing/ledger";
import { ensureSchema } from "../src/billing/schema";
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
});
