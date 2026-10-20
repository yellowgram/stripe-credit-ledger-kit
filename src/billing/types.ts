/**
 * You can implement `Db` on Postgres, SQLite, or anything that can run the
 * statements in ledger.ts inside a transaction. The kit ships two adapters in
 * src/billing/db.ts.
 */

export type LedgerKind =
  | "grant"
  | "reserve"
  | "finalize"
  | "release"
  | "track"
  | "expire"
  | "clawback"
  | "shortfall";

export type ReservationStatus = "held" | "finalized" | "released" | "expired";

export interface Executor {
  get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  /** Rows affected, when the driver reports them. */
  run(sql: string, params?: readonly unknown[]): Promise<number>;
}

/**
 * The executor a transaction hands to its callback. `lockKeys` is required: the
 * webhook handlers lock each payment's ids before reading the grant, so a grant and
 * a refund for one payment can't interleave and lose the refund. Postgres implements
 * it with transaction-scoped advisory locks (see db.ts); SQLite transactions are
 * already serialized (BEGIN IMMEDIATE), so its lockKeys does nothing. A custom
 * adapter without it fails to typecheck, and the handlers refuse it at run time.
 */
export interface TxExecutor extends Executor {
  lockKeys(keys: readonly string[]): Promise<void>;
}

/**
 * Set on a `lockKeys` that intentionally does nothing because the transaction is already
 * serialized (the built-in SQLite adapter: BEGIN IMMEDIATE). On any other executor the webhook
 * handlers check after `lockKeys` that Postgres holds `pg_advisory_xact_lock(hashtext(key))` for
 * every key, and refuse the event (`lock_not_held`) if not.
 */
export const SERIALIZED_LOCK: unique symbol = Symbol.for("stripe-credit-ledger-kit.serializedLock");
export interface SerializedLock {
  [SERIALIZED_LOCK]?: true;
}

export interface Db extends Executor {
  /**
   * Run `fn` inside a single transaction. Commit on success, roll back on throw.
   * Implementations must not interleave other writers on the same connection.
   * Nested transactions are not supported. The Postgres adapter retries `fn` once
   * on a fresh transaction if Postgres reports a deadlock (40P01), so `fn` should
   * only touch the database.
   */
  transaction<T>(fn: (tx: TxExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type LedgerEntry = {
  id: string;
  userId: string;
  delta: number;
  kind: LedgerKind;
  status: ReservationStatus | null;
  idempotencyKey: string | null;
  stripeEventId: string | null;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
  packId: string | null;
  note: string | null;
  livemode: boolean | null;
  createdAt: string;
  seq: number;
};

export type GrantInput = {
  userId: string;
  credits: number;
  packId: string;
  /** Stable key for this grant. Webhook path uses the Stripe event id. */
  idempotencyKey: string;
  stripeEventId?: string | null;
  checkoutSessionId?: string | null;
  paymentIntentId?: string | null;
  chargeId?: string | null;
  livemode?: boolean | null;
  note?: string | null;
};

export type Insufficient = {
  ok: false;
  error: "insufficient_credits";
  balance: number;
};

export type ReserveSuccess = {
  ok: true;
  replay: boolean;
  reservationId: string;
  /** Only an open hold. A finished reservation is never ok. */
  status: "held";
  balance: number;
};

export type ReserveFailure = {
  ok: false;
  error:
    | "insufficient_credits"
    | "already_released"
    | "already_finalized"
    | "hold_expired"
    | "idempotency_amount_mismatch"
    | "idempotency_key_reused"
    | "account_paused";
  balance: number;
};

export type MutationFailure = {
  ok: false;
  error: "reservation_not_found" | "already_released" | "already_finalized" | "hold_expired";
  balance: number;
};

export type MutationSuccess = {
  ok: true;
  replay: boolean;
  balance: number;
  reservationId: string;
};
