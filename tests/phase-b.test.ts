import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteDb } from "../src/billing/db";
import { LedgerError } from "../src/billing/errors";
import {
  applyClawback,
  getAccount,
  getBalance,
  grantCredits,
  reserve,
  track,
} from "../src/billing/ledger";
import { appliedMigrations, migrate } from "../src/billing/schema";
import { handleStripeEvent } from "../src/billing/webhook";
import { checkoutEvent, runChild, tempDb } from "./helpers";

const testEnv = { STRIPE_SECRET_KEY: "sk_test_phase_b" };

describe("phase B", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      const cleanup = cleanups.pop();
      if (cleanup) await cleanup();
    }
  });

  it("persists a pending clawback, returns 200, and applies it when the grant arrives", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "credit-ledger-http-b-"));
    const sqliteFile = path.join(dir, "ledger.sqlite");
    const saved = {
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      DATABASE_URL: process.env.DATABASE_URL,
      SQLITE_PATH: process.env.SQLITE_PATH,
      ALLOW_DEMO_CONTROLS: process.env.ALLOW_DEMO_CONTROLS,
    };
    const secret = `whsec_${Buffer.from("credit-ledger-phase-b").toString("base64")}`;
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    process.env.STRIPE_SECRET_KEY = "sk_test_phase_b";
    delete process.env.DATABASE_URL;
    delete process.env.ALLOW_DEMO_CONTROLS;
    process.env.SQLITE_PATH = sqliteFile;
    const globals = globalThis as {
      __creditLedgerDb?: { close(): Promise<void> };
      __creditLedgerReady?: Promise<void>;
    };
    if (globals.__creditLedgerDb) await globals.__creditLedgerDb.close();
    globals.__creditLedgerDb = undefined;
    globals.__creditLedgerReady = undefined;

    cleanups.push(async () => {
      if (globals.__creditLedgerDb) await globals.__creditLedgerDb.close();
      globals.__creditLedgerDb = undefined;
      globals.__creditLedgerReady = undefined;
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const { POST } = await import("../src/app/api/webhooks/stripe/route");
    const { getDb } = await import("../src/server/ledger");
    const stripe = new Stripe("sk_test_phase_b");

    function signed(event: unknown): Request {
      const payload = JSON.stringify(event);
      const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
      return new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "content-type": "application/json", "stripe-signature": header },
        body: payload,
      });
    }

    const early = await POST(
      signed({
        id: "evt_http_early",
        object: "event",
        type: "charge.refunded",
        livemode: false,
        data: { object: { id: "ch_http_early", object: "charge", payment_intent: "pi_http_early" } },
      }),
    );
    expect(early.status).toBe(200);
    expect(await early.json()).toMatchObject({ received: true, reason: "pending_clawback", granted: false });
    const pending = await getDb().get<{ n: number }>(`SELECT COUNT(*) AS n FROM pending_clawbacks`);
    expect(Number(pending?.n)).toBe(1);

    const grant = await POST(
      signed({
        id: "evt_http_grant",
        object: "event",
        type: "checkout.session.completed",
        livemode: false,
        data: {
          object: {
            id: "cs_http_early",
            object: "checkout.session",
            payment_status: "paid",
            amount_total: 500,
            currency: "usd",
            payment_intent: "pi_http_early",
            metadata: { userId: "user_1", credits: "999", packId: "pack_100" },
          },
        },
      }),
    );
    expect(grant.status).toBe(200);
    expect(await grant.json()).toMatchObject({
      received: true,
      granted: true,
      reason: "clawed_back",
      clawedBack: 100,
      shortfall: 0,
      paused: false,
    });
    expect(await getBalance(getDb(), "user_1")).toBe(0);
    const left = await getDb().get<{ n: number }>(`SELECT COUNT(*) AS n FROM pending_clawbacks`);
    expect(Number(left?.n)).toBe(0);
    const clawbacks = await getDb().get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM credit_ledger_entries WHERE kind = 'clawback'`,
    );
    expect(Number(clawbacks?.n)).toBe(1);

    const won = await POST(
      signed({
        id: "evt_http_won",
        object: "event",
        type: "charge.dispute.closed",
        livemode: false,
        data: { object: { id: "dp_http_won", object: "dispute", payment_intent: "pi_http_early" } },
      }),
    );
    expect(won.status).toBe(200);
    expect(await won.json()).toMatchObject({ reason: "ignored_event", granted: false });
    expect(await getBalance(getDb(), "user_1")).toBe(0);
  });

  it("applies one clawback when the refund beats the grant, and does not restore a won dispute", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    const dispute = await handleStripeEvent(
      ctx.db,
      {
        id: "evt_before_grant",
        type: "charge.dispute.created",
        livemode: false,
        data: { object: { id: "dp_before", object: "dispute", charge: "ch_before" } },
      },
      testEnv,
    );
    expect(dispute).toMatchObject({ reason: "pending_clawback" });

    const refund = await handleStripeEvent(
      ctx.db,
      {
        id: "evt_before_refund",
        type: "charge.refunded",
        livemode: false,
        data: { object: { id: "ch_before", object: "charge", payment_intent: "pi_before" } },
      },
      testEnv,
    );
    expect(refund).toMatchObject({ reason: "pending_clawback" });
    const rows = await ctx.db.get<{ n: number; payment_intent_id: string }>(
      `SELECT COUNT(*) AS n, MAX(payment_intent_id) AS payment_intent_id FROM pending_clawbacks`,
    );
    expect(Number(rows?.n)).toBe(1);
    expect(rows?.payment_intent_id).toBe("pi_before");

    const granted = await handleStripeEvent(
      ctx.db,
      checkoutEvent({
        id: "evt_grant_after",
        sessionId: "cs_before",
        packId: "pack_100",
        paymentIntentId: "pi_before",
        chargeId: "ch_before",
      }),
      testEnv,
    );
    expect(granted).toMatchObject({ granted: true, reason: "clawed_back", clawedBack: 100, paused: false });
    expect(await getBalance(ctx.db, "user_1")).toBe(0);
    const pendingLeft = await ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM pending_clawbacks`);
    expect(Number(pendingLeft?.n)).toBe(0);

    const again = await handleStripeEvent(
      ctx.db,
      {
        id: "evt_after_grant_refund",
        type: "charge.refunded",
        livemode: false,
        data: { object: { id: "ch_before", object: "charge", payment_intent: "pi_before" } },
      },
      testEnv,
    );
    expect(again).toMatchObject({ reason: "already_clawed_back" });

    const won = await handleStripeEvent(
      ctx.db,
      {
        id: "evt_won",
        type: "charge.dispute.closed",
        livemode: false,
        data: { object: { id: "dp_before", object: "dispute", payment_intent: "pi_before" } },
      },
      testEnv,
    );
    expect(won).toMatchObject({ reason: "ignored_event", granted: false });
    expect(await getBalance(ctx.db, "user_1")).toBe(0);
    expect((await getAccount(ctx.db, "user_1")).paused).toBe(false);
  });

  it("pauses only when the pack is short after hold release", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    await handleStripeEvent(
      ctx.db,
      checkoutEvent({ id: "evt_cover", sessionId: "cs_cover", packId: "pack_100" }),
      testEnv,
    );
    const held = await reserve(ctx.db, { userId: "user_1", amount: 40, idempotencyKey: "cover_hold" });
    expect(held.ok).toBe(true);
    const covered = await handleStripeEvent(
      ctx.db,
      {
        id: "evt_cover_refund",
        type: "charge.refunded",
        livemode: false,
        data: { object: { payment_intent: "pi_cs_cover" } },
      },
      testEnv,
    );
    expect(covered).toMatchObject({ reason: "clawed_back", clawedBack: 100, shortfall: 0, paused: false });
    expect((await getAccount(ctx.db, "user_1")).paused).toBe(false);
    expect(await getBalance(ctx.db, "user_1")).toBe(0);

    await handleStripeEvent(
      ctx.db,
      checkoutEvent({
        id: "evt_short",
        sessionId: "cs_short",
        userId: "user_2",
        packId: "pack_100",
      }),
      testEnv,
    );
    const spent = await track(ctx.db, { userId: "user_2", amount: 30, idempotencyKey: "spent_30" });
    expect(spent.ok).toBe(true);
    const open = await reserve(ctx.db, { userId: "user_2", amount: 20, idempotencyKey: "short_hold" });
    expect(open.ok).toBe(true);
    const short = await handleStripeEvent(
      ctx.db,
      {
        id: "evt_short_refund",
        type: "charge.refunded",
        livemode: false,
        data: { object: { payment_intent: "pi_cs_short" } },
      },
      testEnv,
    );
    expect(short).toMatchObject({ reason: "clawed_back", clawedBack: 70, shortfall: 30, paused: true });
    expect((await getAccount(ctx.db, "user_2")).paused).toBe(true);
    expect(await getBalance(ctx.db, "user_2")).toBe(0);
  });

  it("rejects NULL and duplicate keys that would replay a grant, reserve, or clawback", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    await grantCredits(ctx.db, {
      userId: "user_1",
      credits: 40,
      packId: "pack_100",
      idempotencyKey: "grant_key",
      stripeEventId: "evt_grant_key",
      paymentIntentId: "pi_grant_key",
    });
    const replay = await grantCredits(ctx.db, {
      userId: "user_1",
      credits: 40,
      packId: "pack_100",
      idempotencyKey: "other_key",
      stripeEventId: "evt_grant_key",
      paymentIntentId: "pi_other",
    });
    expect(replay.replay).toBe(true);
    expect(await getBalance(ctx.db, "user_1")).toBe(40);

    await expect(
      grantCredits(ctx.db, {
        userId: "user_1",
        credits: 5,
        packId: "pack_100",
        idempotencyKey: "",
      }),
    ).rejects.toBeInstanceOf(LedgerError);

    const reserved = await reserve(ctx.db, { userId: "user_1", amount: 5, idempotencyKey: "shared_key" });
    expect(reserved.ok).toBe(true);
    await expect(
      grantCredits(ctx.db, {
        userId: "user_1",
        credits: 5,
        packId: "pack_100",
        idempotencyKey: "shared_key",
      }),
    ).rejects.toThrow(/idempotency_key_reused/);

    await expect(
      ctx.db.transaction((tx) =>
        applyClawback(tx, {
          userId: "user_1",
          credits: 40,
          paymentIntentId: "   ",
          stripeEventId: "evt_blank_pi",
          note: "charge.refunded",
        }),
      ),
    ).rejects.toThrow(/invalid_payment_intent/);

    await expect(
      ctx.db.run(
        `INSERT INTO credit_ledger_entries
          (id, user_id, delta, kind, idempotency_key, created_at, seq)
         VALUES ('null_key_grant', 'user_1', 1, 'grant', NULL, '2020-01-01T00:00:00.000Z', 1)`,
      ),
    ).rejects.toThrow(/null_idempotency_key/);

    await expect(
      ctx.db.run(
        `INSERT INTO credit_ledger_entries
          (id, user_id, delta, kind, idempotency_key, stripe_event_id, created_at, seq)
         VALUES ('dup_event', 'user_1', 1, 'grant', 'dup_event_key', 'evt_grant_key', '2020-01-01T00:00:00.000Z', 2)`,
      ),
    ).rejects.toThrow(/unique/i);

    await expect(
      ctx.db.run(
        `INSERT INTO credit_ledger_entries
          (id, user_id, delta, kind, idempotency_key, payment_intent_id, created_at, seq)
         VALUES ('dup_pi', 'user_2', 1, 'grant', 'dup_pi_key', 'pi_grant_key', '2020-01-01T00:00:00.000Z', 3)`,
      ),
    ).rejects.toThrow(/unique/i);

    await ctx.db.transaction((tx) =>
      applyClawback(tx, {
        userId: "user_1",
        credits: 40,
        paymentIntentId: "pi_grant_key",
        stripeEventId: "evt_claw_once",
        note: "charge.refunded",
      }),
    );
    await expect(
      ctx.db.run(
        `INSERT INTO credit_ledger_entries
          (id, user_id, delta, kind, payment_intent_id, stripe_event_id, created_at, seq)
         VALUES ('dup_claw', 'user_1', 0, 'clawback', 'pi_grant_key', 'evt_claw_twice', '2020-01-01T00:00:00.000Z', 4)`,
      ),
    ).rejects.toThrow(/unique/i);

    await ctx.db.run(
      `INSERT INTO credit_ledger_entries
        (id, user_id, delta, kind, idempotency_key, stripe_event_id, created_at, seq)
       VALUES ('journal_a', 'user_1', 0, 'finalize', NULL, NULL, '2020-01-01T00:00:00.000Z', 5)`,
    );
    await ctx.db.run(
      `INSERT INTO credit_ledger_entries
        (id, user_id, delta, kind, idempotency_key, stripe_event_id, created_at, seq)
       VALUES ('journal_b', 'user_1', 0, 'release', NULL, NULL, '2020-01-01T00:00:00.000Z', 6)`,
    );
    const journals = await ctx.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM credit_ledger_entries WHERE id IN ('journal_a', 'journal_b')`,
    );
    expect(Number(journals?.n)).toBe(2);
  });

  it("migrates a fresh database and an existing 0.1.2 database", async () => {
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), "credit-ledger-fresh-"));
    const freshFile = path.join(freshDir, "ledger.sqlite");
    const fresh = createSqliteDb(freshFile);
    cleanups.push(async () => {
      await fresh.close();
      fs.rmSync(freshDir, { recursive: true, force: true });
    });
    expect(await migrate(fresh)).toEqual(["001_baseline", "002_pending_clawback_and_unique_keys"]);
    expect(await migrate(fresh)).toEqual([]);
    expect(await appliedMigrations(fresh)).toEqual([
      "001_baseline",
      "002_pending_clawback_and_unique_keys",
    ]);
    await grantCredits(fresh, {
      userId: "user_1",
      credits: 3,
      packId: "pack_100",
      idempotencyKey: "fresh_grant",
    });
    expect(await getBalance(fresh, "user_1")).toBe(3);

    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), "credit-ledger-legacy-"));
    const legacyFile = path.join(legacyDir, "ledger.sqlite");
    const legacy = createSqliteDb(legacyFile);
    cleanups.push(async () => {
      await legacy.close();
      fs.rmSync(legacyDir, { recursive: true, force: true });
    });
    await legacy.run(
      `CREATE TABLE credit_balances (
        user_id TEXT PRIMARY KEY,
        balance BIGINT NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`,
    );
    await legacy.run(
      `INSERT INTO credit_balances (user_id, balance, updated_at) VALUES ('user_1', 7, '2020-01-01T00:00:00.000Z')`,
    );
    await legacy.run(
      `CREATE TABLE credit_ledger_entries (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        delta BIGINT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT,
        idempotency_key TEXT,
        stripe_event_id TEXT,
        checkout_session_id TEXT,
        payment_intent_id TEXT,
        pack_id TEXT,
        note TEXT,
        created_at TEXT NOT NULL,
        seq BIGINT NOT NULL
      )`,
    );
    await legacy.run(
      `INSERT INTO credit_ledger_entries
        (id, user_id, delta, kind, idempotency_key, created_at, seq)
       VALUES ('legacy_grant', 'user_1', 7, 'grant', 'legacy_key', '2020-01-01T00:00:00.000Z', 1)`,
    );
    await legacy.run(
      `CREATE TABLE stripe_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        received_at TEXT NOT NULL
      )`,
    );
    expect(await migrate(legacy)).toEqual(["001_baseline", "002_pending_clawback_and_unique_keys"]);
    const account = await legacy.get<{ balance: number; paused: number }>(
      `SELECT balance, paused FROM credit_balances WHERE user_id = 'user_1'`,
    );
    expect(Number(account?.balance)).toBe(7);
    expect(Number(account?.paused)).toBe(0);
    const pending = await legacy.get<{ n: number }>(`SELECT COUNT(*) AS n FROM pending_clawbacks`);
    expect(Number(pending?.n)).toBe(0);
    await expect(
      legacy.run(
        `INSERT INTO credit_ledger_entries
          (id, user_id, delta, kind, idempotency_key, created_at, seq)
         VALUES ('legacy_dup', 'user_1', 1, 'grant', 'legacy_key', '2020-01-01T00:00:00.000Z', 2)`,
      ),
    ).rejects.toThrow(/unique/i);

    const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "credit-ledger-script-"));
    const scriptFile = path.join(scriptDir, "ledger.sqlite");
    cleanups.push(async () => {
      fs.rmSync(scriptDir, { recursive: true, force: true });
    });
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", path.resolve("scripts/migrate.ts")], {
        env: {
          ...process.env,
          DATABASE_URL: "",
          SQLITE_PATH: scriptFile,
          ALLOW_DEMO_CONTROLS: "false",
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) reject(new Error(stderr || stdout || `migrate exited ${code}`));
        else resolve(stdout);
      });
    });
    expect(output).toContain("Applied 001_baseline, 002_pending_clawback_and_unique_keys.");
    expect(output).toContain("Schema ready.");
    const scriptDb = createSqliteDb(scriptFile);
    cleanups.push(() => scriptDb.close());
    expect(await migrate(scriptDb)).toEqual([]);
  });

  it("does not double-expire one hold when two reapers run together", async () => {
    const ctx = await tempDb();
    cleanups.push(ctx.cleanup);
    await grantCredits(ctx.db, {
      userId: "user_1",
      credits: 100,
      packId: "pack_100",
      idempotencyKey: "grant_reap",
    });
    const left = await reserve(ctx.db, { userId: "user_1", amount: 10, idempotencyKey: "reap_left" });
    const right = await reserve(ctx.db, { userId: "user_1", amount: 15, idempotencyKey: "reap_right" });
    expect(left.ok && right.ok).toBe(true);
    expect(await getBalance(ctx.db, "user_1")).toBe(75);

    const worker = path.resolve("tests/workers/reap-once.ts");
    const now = new Date(Date.now() + 60_000).toISOString();
    const [first, second] = await Promise.all([
      runChild<{ expired: number }>(worker, { dbPath: ctx.file, now, ttlSeconds: 1 }),
      runChild<{ expired: number }>(worker, { dbPath: ctx.file, now, ttlSeconds: 1 }),
    ]);
    expect(first.expired + second.expired).toBe(2);
    expect(await getBalance(ctx.db, "user_1")).toBe(100);
    const expires = await ctx.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM credit_ledger_entries WHERE kind = 'expire'`,
    );
    expect(Number(expires?.n)).toBe(2);
  });
});
