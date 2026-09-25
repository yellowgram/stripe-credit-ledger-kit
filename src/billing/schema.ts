/**
 * Ledger tables. Statements run on both Postgres and SQLite.
 *
 * BIGINT: int8 on Postgres; integer affinity on SQLite (64-bit).
 * Balances must stay inside Number.MAX_SAFE_INTEGER.
 *
 * Idempotency is (user_id, idempotency_key), not a global key. Finalize and
 * release audit rows keep idempotency_key NULL so they can share a reservation
 * key that already sits on the reserve row. ensureSchema nulls those keys on
 * databases created by the first draft, then replaces the old global index.
 *
 * Reservations are ledger rows (kind = 'reserve').
 * status moves held → finalized | released | expired.
 */
import type { Db } from "./types";

const CREATE_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS credit_balances (
    user_id TEXT PRIMARY KEY,
    balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
    paused INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS credit_ledger_entries (
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
    livemode INTEGER,
    created_at TEXT NOT NULL,
    seq BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS credit_ledger_user_seq
    ON credit_ledger_entries (user_id, seq)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_stripe_event
    ON credit_ledger_entries (stripe_event_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_checkout_session
    ON credit_ledger_entries (checkout_session_id)`,
  `CREATE TABLE IF NOT EXISTS stripe_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    livemode INTEGER,
    received_at TEXT NOT NULL
  )`,
];

const ADD_COLUMNS: readonly string[] = [
  `ALTER TABLE credit_balances ADD COLUMN paused INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE credit_ledger_entries ADD COLUMN payment_intent_id TEXT`,
  `ALTER TABLE credit_ledger_entries ADD COLUMN livemode INTEGER`,
  `ALTER TABLE stripe_events ADD COLUMN livemode INTEGER`,
];

function isDuplicateColumn(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate column|already exists/i.test(message);
}

export async function ensureSchema(db: Db): Promise<void> {
  for (const statement of CREATE_STATEMENTS) {
    await db.run(statement);
  }
  for (const statement of ADD_COLUMNS) {
    try {
      await db.run(statement);
    } catch (error) {
      if (!isDuplicateColumn(error)) throw error;
    }
  }
  await db.run(
    `UPDATE credit_ledger_entries
     SET idempotency_key = NULL
     WHERE kind IN ('finalize', 'release')
       AND idempotency_key IS NOT NULL`,
  );
  await db.run(`DROP INDEX IF EXISTS credit_ledger_idempotency`);
  await db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_user_idempotency
     ON credit_ledger_entries (user_id, idempotency_key)`,
  );
  await db.run(
    `CREATE INDEX IF NOT EXISTS credit_ledger_open_holds
     ON credit_ledger_entries (created_at)
     WHERE kind = 'reserve' AND status = 'held'`,
  );
  await db.run(
    `CREATE INDEX IF NOT EXISTS credit_ledger_payment_intent
     ON credit_ledger_entries (payment_intent_id)`,
  );
}
