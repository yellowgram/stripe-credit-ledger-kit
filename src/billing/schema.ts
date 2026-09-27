/**
 * Versioned ledger schema. `migrate` is the buyer path (`npm run db:migrate`).
 * `ensureSchema` runs the same migrations on boot.
 *
 * 001 is the 0.1.2 baseline (tables, added columns, per-user idempotency).
 * 002 adds pending clawbacks and closes NULL-key replay:
 * non-null idempotency keys, Stripe event ids, checkout sessions, grant
 * payment intents, and clawback payment intents are unique; journal rows may
 * keep those columns NULL; grant/reserve/track reject a NULL idempotency key;
 * a clawback rejects a NULL payment intent.
 *
 * BIGINT: int8 on Postgres; integer affinity on SQLite (64-bit).
 * Balances must stay inside Number.MAX_SAFE_INTEGER.
 *
 * Idempotency is (user_id, idempotency_key), not a global key. Finalize and
 * release audit rows keep idempotency_key NULL so they can share a reservation
 * key that already sits on the reserve row.
 */
import type { Db, Executor } from "./types";
import { databaseDialect, type SqlDialect } from "./db";

const BASELINE_TABLES: readonly string[] = [
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
    charge_id TEXT,
    pack_id TEXT,
    note TEXT,
    livemode INTEGER,
    created_at TEXT NOT NULL,
    seq BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS credit_ledger_user_seq
    ON credit_ledger_entries (user_id, seq)`,
  `CREATE TABLE IF NOT EXISTS stripe_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    livemode INTEGER,
    received_at TEXT NOT NULL
  )`,
];

const ADDED_COLUMNS: readonly { table: string; column: string; ddl: string }[] = [
  {
    table: "credit_balances",
    column: "paused",
    ddl: `ALTER TABLE credit_balances ADD COLUMN paused INTEGER NOT NULL DEFAULT 0`,
  },
  {
    table: "credit_ledger_entries",
    column: "payment_intent_id",
    ddl: `ALTER TABLE credit_ledger_entries ADD COLUMN payment_intent_id TEXT`,
  },
  {
    table: "credit_ledger_entries",
    column: "charge_id",
    ddl: `ALTER TABLE credit_ledger_entries ADD COLUMN charge_id TEXT`,
  },
  {
    table: "credit_ledger_entries",
    column: "livemode",
    ddl: `ALTER TABLE credit_ledger_entries ADD COLUMN livemode INTEGER`,
  },
  {
    table: "stripe_events",
    column: "livemode",
    ddl: `ALTER TABLE stripe_events ADD COLUMN livemode INTEGER`,
  },
];

type Migration = {
  version: string;
  up: (tx: Executor, dialect: SqlDialect) => Promise<void>;
};

async function columnExists(
  tx: Executor,
  dialect: SqlDialect,
  table: string,
  column: string,
): Promise<boolean> {
  if (dialect === "sqlite") {
    const rows = await tx.all<{ name: string }>(`PRAGMA table_info(${table})`);
    return rows.some((row) => row.name === column);
  }
  const row = await tx.get<{ name: string }>(
    `SELECT column_name AS name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
    [table, column],
  );
  return row !== undefined;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: "001_baseline",
    up: async (tx, dialect) => {
      for (const statement of BASELINE_TABLES) {
        await tx.run(statement);
      }
      for (const column of ADDED_COLUMNS) {
        if (await columnExists(tx, dialect, column.table, column.column)) continue;
        await tx.run(column.ddl);
      }
      await tx.run(
        `UPDATE credit_ledger_entries
         SET idempotency_key = NULL
         WHERE kind IN ('finalize', 'release')
           AND idempotency_key IS NOT NULL`,
      );
      await tx.run(`DROP INDEX IF EXISTS credit_ledger_idempotency`);
      await tx.run(`DROP INDEX IF EXISTS credit_ledger_user_idempotency`);
      await tx.run(
        `CREATE UNIQUE INDEX credit_ledger_user_idempotency
         ON credit_ledger_entries (user_id, idempotency_key)
         WHERE idempotency_key IS NOT NULL`,
      );
      await tx.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_stripe_event
         ON credit_ledger_entries (stripe_event_id)`,
      );
      await tx.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_checkout_session
         ON credit_ledger_entries (checkout_session_id)`,
      );
      await tx.run(
        `CREATE INDEX IF NOT EXISTS credit_ledger_open_holds
         ON credit_ledger_entries (created_at)
         WHERE kind = 'reserve' AND status = 'held'`,
      );
      await tx.run(
        `CREATE INDEX IF NOT EXISTS credit_ledger_payment_intent
         ON credit_ledger_entries (payment_intent_id)`,
      );
    },
  },
  {
    version: "002_pending_clawback_and_unique_keys",
    up: async (tx, dialect) => {
      await tx.run(
        `CREATE TABLE IF NOT EXISTS pending_clawbacks (
          id TEXT PRIMARY KEY,
          payment_intent_id TEXT,
          charge_id TEXT,
          checkout_session_id TEXT,
          stripe_event_id TEXT NOT NULL,
          note TEXT,
          created_at TEXT NOT NULL
        )`,
      );
      await tx.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS pending_clawback_event
         ON pending_clawbacks (stripe_event_id)`,
      );
      await tx.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS pending_clawback_pi
         ON pending_clawbacks (payment_intent_id)
         WHERE payment_intent_id IS NOT NULL`,
      );
      await tx.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS pending_clawback_charge
         ON pending_clawbacks (charge_id)
         WHERE charge_id IS NOT NULL`,
      );
      await tx.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS pending_clawback_session
         ON pending_clawbacks (checkout_session_id)
         WHERE checkout_session_id IS NOT NULL`,
      );

      // Partial unique indexes: NULL journal keys stay legal and are not a
      // replay wildcard. A second non-null key conflicts.
      await tx.run(`DROP INDEX IF EXISTS credit_ledger_stripe_event`);
      await tx.run(
        `CREATE UNIQUE INDEX credit_ledger_stripe_event
         ON credit_ledger_entries (stripe_event_id)
         WHERE stripe_event_id IS NOT NULL`,
      );
      await tx.run(`DROP INDEX IF EXISTS credit_ledger_checkout_session`);
      await tx.run(
        `CREATE UNIQUE INDEX credit_ledger_checkout_session
         ON credit_ledger_entries (checkout_session_id)
         WHERE checkout_session_id IS NOT NULL`,
      );
      await tx.run(`DROP INDEX IF EXISTS credit_ledger_user_idempotency`);
      await tx.run(
        `CREATE UNIQUE INDEX credit_ledger_user_idempotency
         ON credit_ledger_entries (user_id, idempotency_key)
         WHERE idempotency_key IS NOT NULL`,
      );
      await tx.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_grant_pi
         ON credit_ledger_entries (payment_intent_id)
         WHERE kind = 'grant' AND payment_intent_id IS NOT NULL`,
      );
      await tx.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_grant_charge
         ON credit_ledger_entries (charge_id)
         WHERE kind = 'grant' AND charge_id IS NOT NULL`,
      );
      await tx.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_clawback_pi
         ON credit_ledger_entries (payment_intent_id)
         WHERE kind = 'clawback' AND payment_intent_id IS NOT NULL`,
      );

      if (dialect === "sqlite") {
        await tx.run(`DROP TRIGGER IF EXISTS credit_ledger_kind_key_guard`);
        await tx.run(
          `CREATE TRIGGER credit_ledger_kind_key_guard
           BEFORE INSERT ON credit_ledger_entries
           FOR EACH ROW
           WHEN NEW.kind IN ('grant', 'reserve', 'track')
             AND (NEW.idempotency_key IS NULL OR length(trim(NEW.idempotency_key)) = 0)
           BEGIN
             SELECT RAISE(ABORT, 'null_idempotency_key');
           END`,
        );
        await tx.run(`DROP TRIGGER IF EXISTS credit_ledger_clawback_pi_guard`);
        await tx.run(
          `CREATE TRIGGER credit_ledger_clawback_pi_guard
           BEFORE INSERT ON credit_ledger_entries
           FOR EACH ROW
           WHEN NEW.kind = 'clawback'
             AND (NEW.payment_intent_id IS NULL OR length(trim(NEW.payment_intent_id)) = 0)
           BEGIN
             SELECT RAISE(ABORT, 'null_payment_intent');
           END`,
        );
      } else {
        await tx.run(
          `CREATE OR REPLACE FUNCTION credit_ledger_reject_null_keys() RETURNS trigger
           LANGUAGE plpgsql AS $clk$
           BEGIN
             IF NEW.kind IN ('grant', 'reserve', 'track')
                AND (NEW.idempotency_key IS NULL OR btrim(NEW.idempotency_key) = '') THEN
               RAISE EXCEPTION 'null_idempotency_key';
             END IF;
             IF NEW.kind = 'clawback'
                AND (NEW.payment_intent_id IS NULL OR btrim(NEW.payment_intent_id) = '') THEN
               RAISE EXCEPTION 'null_payment_intent';
             END IF;
             RETURN NEW;
           END;
           $clk$`,
        );
        await tx.run(`DROP TRIGGER IF EXISTS credit_ledger_kind_key_guard ON credit_ledger_entries`);
        await tx.run(
          `CREATE TRIGGER credit_ledger_kind_key_guard
           BEFORE INSERT ON credit_ledger_entries
           FOR EACH ROW EXECUTE FUNCTION credit_ledger_reject_null_keys()`,
        );
      }
    },
  },
];

/** Apply any missing migrations. Returns the versions applied on this call. */
export async function migrate(db: Db): Promise<string[]> {
  const dialect = await databaseDialect(db);
  await db.run(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`,
  );
  const rows = await db.all<{ version: string }>(`SELECT version FROM schema_migrations`);
  const applied = new Set(rows.map((row) => row.version));
  const ran: string[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    await db.transaction(async (tx) => {
      await migration.up(tx, dialect);
      await tx.run(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`, [
        migration.version,
        new Date().toISOString(),
      ]);
    });
    ran.push(migration.version);
  }
  return ran;
}

export async function appliedMigrations(db: Db): Promise<string[]> {
  const rows = await db.all<{ version: string }>(
    `SELECT version FROM schema_migrations ORDER BY version ASC`,
  );
  return rows.map((row) => row.version);
}

/** Boot path. Same migrations as `npm run db:migrate`. */
export async function ensureSchema(db: Db): Promise<void> {
  await migrate(db);
}
