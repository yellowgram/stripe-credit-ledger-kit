/**
 * Ledger tables. Statements run on both Postgres and SQLite.
 *
 * BIGINT: int8 on Postgres; integer affinity on SQLite (64-bit).
 * Balances must stay inside Number.MAX_SAFE_INTEGER. The Postgres adapter
 * parses int8 as a JS number and throws if a value is outside that range.
 *
 * Reservations are ledger rows (kind = 'reserve'), not a fourth table.
 * status on that row moves held → finalized | released.
 */
export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS credit_balances (
    user_id TEXT PRIMARY KEY,
    balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
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
    pack_id TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    seq BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS credit_ledger_user_seq
    ON credit_ledger_entries (user_id, seq)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_idempotency
    ON credit_ledger_entries (idempotency_key, kind)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_stripe_event
    ON credit_ledger_entries (stripe_event_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_checkout_session
    ON credit_ledger_entries (checkout_session_id)`,
  `CREATE TABLE IF NOT EXISTS stripe_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    received_at TEXT NOT NULL
  )`,
];

export async function ensureSchema(db: { run(sql: string, params?: readonly unknown[]): Promise<number> }): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await db.run(statement);
  }
}
