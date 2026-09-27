import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import pg from "pg";
import type { Db, Executor } from "./types";

const { Pool, types } = pg;

// int8 / BIGINT. Credit balances are safe integers; refuse anything wider.
types.setTypeParser(20, (value) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`bigint_out_of_safe_range:${value}`);
  }
  return parsed;
});

/** Replace `?` placeholders with `$1`, `$2`, … for node-postgres. */
export function toPostgresParams(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

class Mutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

type SqliteExecutor = Executor;

function bind(params: readonly unknown[] | undefined): unknown[] {
  return params ? Array.from(params) : [];
}

export function createSqliteDb(filename: string): Db {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }
  const sqlite = new Database(filename);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  if (filename !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }

  const mutex = new Mutex();
  let inTransaction = false;

  const executor: SqliteExecutor = {
    async get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined> {
      const row = sqlite.prepare(sql).get(...bind(params)) as T | undefined;
      return row;
    },
    async all<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
      return sqlite.prepare(sql).all(...bind(params)) as T[];
    },
    async run(sql: string, params?: readonly unknown[]): Promise<number> {
      const info = sqlite.prepare(sql).run(...bind(params));
      return info.changes;
    },
  };

  return {
    get: (sql, params) => mutex.run(() => executor.get(sql, params)),
    all: (sql, params) => mutex.run(() => executor.all(sql, params)),
    run: (sql, params) => mutex.run(() => executor.run(sql, params)),
    async transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
      return mutex.run(async () => {
        if (inTransaction) {
          throw new Error("nested_transaction");
        }
        inTransaction = true;
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          const result = await fn(executor);
          sqlite.exec("COMMIT");
          return result;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        } finally {
          inTransaction = false;
        }
      });
    },
    async close() {
      sqlite.close();
    },
  };
}

function postgresExecutor(queryable: {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}): Executor {
  return {
    async get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined> {
      const result = await queryable.query(toPostgresParams(sql), bind(params));
      return result.rows[0] as T | undefined;
    },
    async all<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
      const result = await queryable.query(toPostgresParams(sql), bind(params));
      return result.rows as T[];
    },
    async run(sql: string, params?: readonly unknown[]): Promise<number> {
      const result = await queryable.query(toPostgresParams(sql), bind(params));
      return result.rowCount ?? 0;
    },
  };
}

export function createPostgresDb(connectionString: string): Db {
  const pool = new Pool({ connectionString, max: 10 });
  const autocommit = postgresExecutor(pool);

  return {
    get: autocommit.get,
    all: autocommit.all,
    run: autocommit.run,
    async transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(postgresExecutor(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The original error is the one the caller needs.
        }
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

export function isPostgresUrl(value: string | undefined): value is string {
  return Boolean(value && /^postgres(ql)?:\/\//i.test(value));
}

/** Postgres when DATABASE_URL is a postgres URL; otherwise SQLite. */
export function createDbFromEnv(env: NodeJS.ProcessEnv = process.env): Db {
  if (isPostgresUrl(env.DATABASE_URL)) {
    return createPostgresDb(env.DATABASE_URL);
  }
  return createSqliteDb(env.SQLITE_PATH || "./data/ledger.sqlite");
}
