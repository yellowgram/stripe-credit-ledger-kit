/**
 * MIT extract — see src/billing/LICENSE.MIT. The rest of the repo is not MIT.
 *
 * A buyer can implement `Db` on Postgres, SQLite, or anything that can run the
 * statements in ledger.ts inside a transaction. The kit ships two adapters in
 * src/billing/db.ts (not part of the MIT extract).
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

export interface Db extends Executor {
  /**
   * Run `fn` inside a single transaction. Commit on success, roll back on throw.
   * Implementations must not interleave other writers on the same connection.
   * Nested transactions are not supported.
   */
  transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T>;
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
