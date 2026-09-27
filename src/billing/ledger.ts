/**
 * Policy (bill the reservation):
 * - check is advisory. It does not lock. A paused user is not ok.
 * - reserve and track are the hard gate. Both run
 *   UPDATE credit_balances SET balance = balance - ? WHERE user_id = ? AND balance >= ?
 *   inside a transaction that first locks the user's balance row.
 * - Credits leave the spendable balance when reserve succeeds.
 * - finalize confirms the hold and does not change the balance.
 * - release returns the full reserved amount. Call it when the provider fails.
 * - reserve() replays ok only when that user's key is still held for the same amount.
 *   Released, finalized, and expired holds return an error (they are not a free retry).
 * - Idempotency is (user_id, idempotency_key).
 * - Held rows older than the TTL are expired: status expired, an expire journal
 *   row, and the credits returned. Production must run `npm run holds:reap`.
 *   reserve() also calls reapExpiredHolds opportunistically. That call is not
 *   the production reaper. track() does not reap.
 * - This file does not bill partial token usage. finalize is an audit row.
 * - Clawback pauses only when spendable cannot cover the pack after open holds
 *   are released. Releasing a hold does not pause by itself.
 * - A clawback that arrives before its grant is a pending_clawbacks row, applied
 *   in the grant transaction. A won dispute does not restore credits.
 */
import { randomUUID } from "node:crypto";
import { databaseDialect } from "./db";
import { LedgerError } from "./errors";
import type {
  Db,
  Executor,
  GrantInput,
  LedgerEntry,
  LedgerKind,
  MutationFailure,
  MutationSuccess,
  ReservationStatus,
  ReserveFailure,
  ReserveSuccess,
} from "./types";

/** 15 minutes. Override with CREDIT_HOLD_TTL_SECONDS. */
export const DEFAULT_HOLD_TTL_SECONDS = 900;

const REAPER_BATCH = 200;

const ENTRY_COLUMNS = `id, user_id, delta, kind, status, idempotency_key, stripe_event_id, checkout_session_id, payment_intent_id, pack_id, note, livemode, created_at, seq`;

type EntryRow = {
  id: string;
  user_id: string;
  delta: unknown;
  kind: string;
  status: string | null;
  idempotency_key: string | null;
  stripe_event_id: string | null;
  checkout_session_id: string | null;
  payment_intent_id: string | null;
  pack_id: string | null;
  note: string | null;
  livemode: unknown;
  created_at: string;
  seq: unknown;
};

let tick = 0;

function isoNow(): string {
  return new Date().toISOString();
}

function nextSeq(): number {
  tick = (tick + 1) % 1000;
  return Date.now() * 1000 + tick;
}

function asInt(value: unknown): number {
  if (typeof value === "bigint") {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new LedgerError("unsafe_integer");
    return parsed;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new LedgerError("unsafe_integer");
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new LedgerError("unsafe_integer");
    return parsed;
  }
  throw new LedgerError("expected_integer");
}

function asBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  throw new LedgerError("expected_boolean");
}

function assertUserId(userId: string): void {
  if (typeof userId !== "string" || userId.trim() === "" || userId.length > 200) {
    throw new LedgerError("invalid_user_id");
  }
}

function assertIdempotencyKey(key: string): void {
  if (typeof key !== "string" || key.trim() === "" || key.length > 200) {
    throw new LedgerError("invalid_idempotency_key");
  }
}

function assertPaymentIntentId(paymentIntentId: string): void {
  if (typeof paymentIntentId !== "string" || paymentIntentId.trim() === "" || paymentIntentId.length > 200) {
    throw new LedgerError("invalid_payment_intent");
  }
}

/** Empty strings must not occupy a unique index while NULL rows stay unlimited. */
function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : value;
}

function assertPositiveInt(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new LedgerError("amount_must_be_positive_integer");
  }
}

function assertNonNegativeInt(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new LedgerError("amount_must_be_non_negative_integer");
  }
}

export function holdTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CREDIT_HOLD_TTL_SECONDS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_HOLD_TTL_SECONDS;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new LedgerError("invalid_hold_ttl");
  return parsed;
}

function mapEntry(row: EntryRow): LedgerEntry {
  return {
    id: row.id,
    userId: row.user_id,
    delta: asInt(row.delta),
    kind: row.kind as LedgerKind,
    status: (row.status ?? null) as ReservationStatus | null,
    idempotencyKey: row.idempotency_key,
    stripeEventId: row.stripe_event_id,
    checkoutSessionId: row.checkout_session_id,
    paymentIntentId: row.payment_intent_id,
    packId: row.pack_id,
    note: row.note,
    livemode: asBool(row.livemode),
    createdAt: row.created_at,
    seq: asInt(row.seq),
  };
}

async function balanceOf(tx: Executor, userId: string): Promise<number> {
  const row = await tx.get<{ balance: unknown }>(
    `SELECT balance FROM credit_balances WHERE user_id = ?`,
    [userId],
  );
  if (!row) return 0;
  return asInt(row.balance);
}

/** Credit the spendable balance. Refuses a sum that cannot round-trip through JS. */
async function creditBalance(tx: Executor, userId: string, amount: number): Promise<void> {
  assertPositiveInt(amount);
  const current = await balanceOf(tx, userId);
  if (amount > Number.MAX_SAFE_INTEGER - current) throw new LedgerError("unsafe_integer");
  await tx.run(`UPDATE credit_balances SET balance = balance + ?, updated_at = ? WHERE user_id = ?`, [
    amount,
    isoNow(),
    userId,
  ]);
}

async function lockBalanceRow(tx: Executor, userId: string): Promise<{ balance: number; paused: boolean }> {
  await tx.run(
    `INSERT INTO credit_balances (user_id, balance, updated_at)
     VALUES (?, 0, ?)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, isoNow()],
  );
  const row = await tx.get<{ balance: unknown; paused: unknown }>(
    `UPDATE credit_balances SET updated_at = ? WHERE user_id = ? RETURNING balance, paused`,
    [isoNow(), userId],
  );
  if (!row) throw new LedgerError("balance_row_missing");
  return {
    balance: asInt(row.balance),
    paused: asBool(row.paused) === true,
  };
}

async function insertEntry(
  tx: Executor,
  entry: {
    id?: string;
    userId: string;
    delta: number;
    kind: LedgerKind;
    status: ReservationStatus | null;
    idempotencyKey: string | null;
    stripeEventId: string | null;
    checkoutSessionId: string | null;
    paymentIntentId: string | null;
    chargeId?: string | null;
    packId: string | null;
    note: string | null;
    livemode: boolean | null;
  },
): Promise<string> {
  const id = entry.id ?? randomUUID();
  const idempotencyKey = blankToNull(entry.idempotencyKey);
  const stripeEventId = blankToNull(entry.stripeEventId);
  const checkoutSessionId = blankToNull(entry.checkoutSessionId);
  const paymentIntentId = blankToNull(entry.paymentIntentId);
  const chargeId = blankToNull(entry.chargeId);
  if (
    (entry.kind === "grant" || entry.kind === "reserve" || entry.kind === "track") &&
    idempotencyKey === null
  ) {
    throw new LedgerError("invalid_idempotency_key");
  }
  if (entry.kind === "clawback" && paymentIntentId === null) {
    throw new LedgerError("invalid_payment_intent");
  }
  await tx.run(
    `INSERT INTO credit_ledger_entries
      (id, user_id, delta, kind, status, idempotency_key, stripe_event_id, checkout_session_id, payment_intent_id, charge_id, pack_id, note, livemode, created_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      entry.userId,
      entry.delta,
      entry.kind,
      entry.status,
      idempotencyKey,
      stripeEventId,
      checkoutSessionId,
      paymentIntentId,
      chargeId,
      entry.packId,
      entry.note,
      entry.livemode === null ? null : entry.livemode ? 1 : 0,
      isoNow(),
      nextSeq(),
    ],
  );
  return id;
}

async function loadByKey(tx: Executor, userId: string, idempotencyKey: string): Promise<EntryRow | undefined> {
  return tx.get<EntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM credit_ledger_entries WHERE user_id = ? AND idempotency_key = ?`,
    [userId, idempotencyKey],
  );
}

async function loadReserve(tx: Executor, userId: string, idempotencyKey: string): Promise<EntryRow | undefined> {
  return tx.get<EntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM credit_ledger_entries
     WHERE user_id = ? AND idempotency_key = ? AND kind = 'reserve'`,
    [userId, idempotencyKey],
  );
}

function finishedReserveError(status: string): ReserveFailure["error"] {
  if (status === "finalized") return "already_finalized";
  if (status === "released") return "already_released";
  if (status === "expired") return "hold_expired";
  return "idempotency_key_reused";
}

async function grantReplay(tx: Executor, input: GrantInput): Promise<"replay" | "key_reused" | null> {
  const byKey = await tx.get<{ id: string; kind: string }>(
    `SELECT id, kind FROM credit_ledger_entries
     WHERE user_id = ? AND idempotency_key = ?`,
    [input.userId, input.idempotencyKey],
  );
  if (byKey) return byKey.kind === "grant" ? "replay" : "key_reused";
  const stripeEventId = blankToNull(input.stripeEventId);
  if (stripeEventId) {
    const byEvent = await tx.get<{ id: string }>(
      `SELECT id FROM credit_ledger_entries WHERE stripe_event_id = ?`,
      [stripeEventId],
    );
    if (byEvent) return "replay";
  }
  const checkoutSessionId = blankToNull(input.checkoutSessionId);
  if (checkoutSessionId) {
    const bySession = await tx.get<{ id: string }>(
      `SELECT id FROM credit_ledger_entries WHERE checkout_session_id = ?`,
      [checkoutSessionId],
    );
    if (bySession) return "replay";
  }
  const paymentIntentId = blankToNull(input.paymentIntentId);
  if (paymentIntentId) {
    const byPayment = await tx.get<{ id: string }>(
      `SELECT id FROM credit_ledger_entries WHERE kind = 'grant' AND payment_intent_id = ?`,
      [paymentIntentId],
    );
    if (byPayment) return "replay";
  }
  const chargeId = blankToNull(input.chargeId);
  if (chargeId) {
    const byCharge = await tx.get<{ id: string }>(
      `SELECT id FROM credit_ledger_entries WHERE kind = 'grant' AND charge_id = ?`,
      [chargeId],
    );
    if (byCharge) return "replay";
  }
  return null;
}

export type GrantResult = {
  balance: number;
  replay: boolean;
  /** Set when a pending clawback matched this grant and was applied in this transaction. */
  clawedBack?: number;
  shortfall?: number;
  paused?: boolean;
};

/** Grant inside an existing transaction (webhook path). Does not clear pause. */
export async function applyGrant(tx: Executor, input: GrantInput): Promise<GrantResult> {
  assertUserId(input.userId);
  assertPositiveInt(input.credits);
  assertIdempotencyKey(input.idempotencyKey);
  if (typeof input.packId !== "string" || input.packId.trim() === "" || input.packId.length > 200) {
    throw new LedgerError("invalid_pack");
  }
  await lockBalanceRow(tx, input.userId);
  const replay = await grantReplay(tx, input);
  if (replay === "key_reused") throw new LedgerError("idempotency_key_reused");
  if (replay === "replay") {
    return { balance: await balanceOf(tx, input.userId), replay: true };
  }
  await creditBalance(tx, input.userId, input.credits);
  await insertEntry(tx, {
    userId: input.userId,
    delta: input.credits,
    kind: "grant",
    status: null,
    idempotencyKey: input.idempotencyKey,
    stripeEventId: input.stripeEventId ?? null,
    checkoutSessionId: input.checkoutSessionId ?? null,
    paymentIntentId: input.paymentIntentId ?? null,
    chargeId: input.chargeId ?? null,
    packId: input.packId,
    note: input.note ?? null,
    livemode: input.livemode ?? null,
  });
  const claw = await consumePendingClawback(tx, {
    userId: input.userId,
    credits: input.credits,
    paymentIntentId: input.paymentIntentId ?? null,
    chargeId: input.chargeId ?? null,
    checkoutSessionId: input.checkoutSessionId ?? null,
  });
  const balance = await balanceOf(tx, input.userId);
  if (!claw) return { balance, replay: false };
  return {
    balance,
    replay: false,
    clawedBack: claw.clawedBack,
    shortfall: claw.shortfall,
    paused: claw.paused,
  };
}

export async function grantCredits(db: Db, input: GrantInput): Promise<GrantResult> {
  return db.transaction((tx) => applyGrant(tx, input));
}

/** Demo or admin only. Grants do not call this. */
export async function unpauseUser(db: Db, userId: string): Promise<void> {
  assertUserId(userId);
  await db.transaction(async (tx) => {
    await lockBalanceRow(tx, userId);
    await tx.run(`UPDATE credit_balances SET paused = 0, updated_at = ? WHERE user_id = ?`, [isoNow(), userId]);
  });
}

/** Return every open hold before a clawback debit. Same transaction as the debit. */
async function releaseHeldForClawback(tx: Executor, userId: string): Promise<number> {
  const holds = await tx.all<EntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM credit_ledger_entries
     WHERE user_id = ? AND kind = 'reserve' AND status = 'held'
     ORDER BY seq ASC`,
    [userId],
  );
  let released = 0;
  for (const hold of holds) {
    const claimed = await tx.get<{ id: string }>(
      `UPDATE credit_ledger_entries
       SET status = 'released'
       WHERE id = ? AND user_id = ? AND status = 'held'
       RETURNING id`,
      [hold.id, userId],
    );
    if (!claimed) continue;
    const amount = -asInt(hold.delta);
    if (amount <= 0) throw new LedgerError("invalid_reservation_delta");
    await creditBalance(tx, userId, amount);
    await insertEntry(tx, {
      userId,
      delta: amount,
      kind: "release",
      status: "released",
      idempotencyKey: null,
      stripeEventId: null,
      checkoutSessionId: null,
      paymentIntentId: null,
      packId: null,
      note: "Released for refund or dispute",
      livemode: null,
    });
    released += 1;
  }
  return released;
}

export type ClawbackInput = {
  userId: string;
  /** Full grant, in credits. Not the refund's cent amount. */
  credits: number;
  paymentIntentId: string;
  stripeEventId: string;
  note: string;
};

export type ClawbackResult = {
  balance: number;
  clawedBack: number;
  shortfall: number;
  paused: boolean;
  replay: boolean;
};

/**
 * Close every open hold for the user, then remove up to `credits` from the
 * spendable balance. Holds are released in this transaction so a later reaper
 * pass cannot put refunded credits back. If the user already finalized or
 * tracked part of the grant, take what is left and journal the shortfall.
 * Pause only when that shortfall is greater than zero. Releasing a hold does
 * not pause when the balance still covers the pack. A later grant does not
 * clear an existing pause. Call unpauseUser from a demo or admin path.
 * One clawback row per payment intent. A blank payment intent is rejected.
 */
export async function applyClawback(tx: Executor, input: ClawbackInput): Promise<ClawbackResult> {
  assertUserId(input.userId);
  assertPositiveInt(input.credits);
  assertIdempotencyKey(input.stripeEventId);
  assertPaymentIntentId(input.paymentIntentId);
  await lockBalanceRow(tx, input.userId);
  const existing = await tx.get<{ id: string }>(
    `SELECT id FROM credit_ledger_entries
     WHERE payment_intent_id = ? AND kind = 'clawback'`,
    [input.paymentIntentId],
  );
  if (existing) {
    const paused = await tx.get<{ paused: unknown }>(
      `SELECT paused FROM credit_balances WHERE user_id = ?`,
      [input.userId],
    );
    return {
      balance: await balanceOf(tx, input.userId),
      clawedBack: 0,
      shortfall: 0,
      paused: asBool(paused?.paused) === true,
      replay: true,
    };
  }

  await releaseHeldForClawback(tx, input.userId);
  const balance = await balanceOf(tx, input.userId);
  const clawedBack = Math.min(balance, input.credits);
  const shortfall = input.credits - clawedBack;
  if (clawedBack > 0) {
    const updated = await tx.get<{ balance: unknown }>(
      `UPDATE credit_balances
       SET balance = balance - ?, updated_at = ?
       WHERE user_id = ? AND balance >= ?
       RETURNING balance`,
      [clawedBack, isoNow(), input.userId, clawedBack],
    );
    if (!updated) throw new LedgerError("clawback_race");
  }
  // idempotency_key stays NULL. The payment intent is the clawback identity.
  // A customer key equal to the Stripe event id must not roll the refund back.
  await insertEntry(tx, {
    userId: input.userId,
    delta: -clawedBack,
    kind: "clawback",
    status: null,
    idempotencyKey: null,
    stripeEventId: input.stripeEventId,
    checkoutSessionId: null,
    paymentIntentId: input.paymentIntentId,
    packId: null,
    note: input.note,
    livemode: null,
  });
  if (shortfall > 0) {
    await insertEntry(tx, {
      userId: input.userId,
      delta: 0,
      kind: "shortfall",
      status: null,
      idempotencyKey: null,
      stripeEventId: null,
      checkoutSessionId: null,
      paymentIntentId: null,
      packId: null,
      note: `shortfall ${shortfall} credits`,
      livemode: null,
    });
  }
  const shouldPause = shortfall > 0;
  if (shouldPause) {
    await tx.run(`UPDATE credit_balances SET paused = 1, updated_at = ? WHERE user_id = ?`, [
      isoNow(),
      input.userId,
    ]);
  }
  const pausedRow = await tx.get<{ paused: unknown }>(
    `SELECT paused FROM credit_balances WHERE user_id = ?`,
    [input.userId],
  );
  const paused = shouldPause || asBool(pausedRow?.paused) === true;
  return {
    balance: await balanceOf(tx, input.userId),
    clawedBack,
    shortfall,
    paused,
    replay: false,
  };
}

type PendingRow = {
  id: string;
  payment_intent_id: string | null;
  charge_id: string | null;
  checkout_session_id: string | null;
  stripe_event_id: string;
  note: string | null;
};

const PENDING_MATCH_SQL = `SELECT id, payment_intent_id, charge_id, checkout_session_id, stripe_event_id, note
  FROM pending_clawbacks
  WHERE (? IS NOT NULL AND payment_intent_id = ?)
     OR (? IS NOT NULL AND charge_id = ?)
     OR (? IS NOT NULL AND checkout_session_id = ?)`;

function pendingIdentity(ids: {
  paymentIntentId: string | null;
  chargeId: string | null;
  checkoutSessionId: string | null;
}): {
  paymentIntentId: string | null;
  chargeId: string | null;
  checkoutSessionId: string | null;
  params: readonly [string | null, string | null, string | null, string | null, string | null, string | null];
} {
  const paymentIntentId = blankToNull(ids.paymentIntentId);
  const chargeId = blankToNull(ids.chargeId);
  const checkoutSessionId = blankToNull(ids.checkoutSessionId);
  return {
    paymentIntentId,
    chargeId,
    checkoutSessionId,
    params: [paymentIntentId, paymentIntentId, chargeId, chargeId, checkoutSessionId, checkoutSessionId],
  };
}

async function backfillPending(
  tx: Executor,
  id: string,
  ids: { paymentIntentId: string | null; chargeId: string | null; checkoutSessionId: string | null },
): Promise<void> {
  const sets: Array<[string, string]> = [
    ["payment_intent_id", ids.paymentIntentId ?? ""],
    ["charge_id", ids.chargeId ?? ""],
    ["checkout_session_id", ids.checkoutSessionId ?? ""],
  ];
  for (const [column, value] of sets) {
    if (!value) continue;
    await tx.run(
      `UPDATE pending_clawbacks
       SET ${column} = ?
       WHERE id = ? AND ${column} IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM pending_clawbacks AS other
           WHERE other.${column} = ? AND other.id <> ?
         )`,
      [value, id, value, id],
    );
  }
}

export type PendingClawbackWrite = "inserted" | "exists" | "unkeyed";

/** Store a clawback that beat its grant. HTTP 200. The grant transaction applies it. */
export async function recordPendingClawback(
  tx: Executor,
  input: {
    paymentIntentId: string | null;
    chargeId: string | null;
    checkoutSessionId: string | null;
    stripeEventId: string;
    note: string;
  },
): Promise<PendingClawbackWrite> {
  assertIdempotencyKey(input.stripeEventId);
  const ids = pendingIdentity(input);
  if (!ids.paymentIntentId && !ids.chargeId && !ids.checkoutSessionId) return "unkeyed";
  const existing = await tx.get<PendingRow>(`${PENDING_MATCH_SQL} LIMIT 1`, ids.params);
  if (existing) {
    await backfillPending(tx, existing.id, ids);
    return "exists";
  }
  const inserted = await tx.get<{ id: string }>(
    `INSERT INTO pending_clawbacks
       (id, payment_intent_id, charge_id, checkout_session_id, stripe_event_id, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      randomUUID(),
      ids.paymentIntentId,
      ids.chargeId,
      ids.checkoutSessionId,
      input.stripeEventId.trim(),
      input.note,
      isoNow(),
    ],
  );
  return inserted ? "inserted" : "exists";
}

function chargeIdentity(chargeId: string | null | undefined): string | null {
  const charge = blankToNull(chargeId);
  return charge ? `charge:${charge}` : null;
}

/** Apply and delete pending clawbacks that match this grant. Same transaction as the grant. */
async function consumePendingClawback(
  tx: Executor,
  input: {
    userId: string;
    credits: number;
    paymentIntentId: string | null;
    chargeId: string | null;
    checkoutSessionId: string | null;
  },
): Promise<ClawbackResult | null> {
  const ids = pendingIdentity(input);
  if (!ids.paymentIntentId && !ids.chargeId && !ids.checkoutSessionId) return null;
  const rows = await tx.all<PendingRow>(PENDING_MATCH_SQL, ids.params);
  if (rows.length === 0) return null;
  const storedPayment = rows
    .map((row) => blankToNull(row.payment_intent_id))
    .find((value): value is string => value !== null);
  const storedCharge = rows
    .map((row) => blankToNull(row.charge_id))
    .find((value): value is string => value !== null);
  const paymentIntentId =
    ids.paymentIntentId ?? storedPayment ?? chargeIdentity(ids.chargeId) ?? chargeIdentity(storedCharge);
  if (!paymentIntentId) return null;
  const result = await applyClawback(tx, {
    userId: input.userId,
    credits: input.credits,
    paymentIntentId,
    stripeEventId: rows[0].stripe_event_id,
    note: rows[0].note ?? "pending clawback",
  });
  for (const row of rows) {
    await tx.run(`DELETE FROM pending_clawbacks WHERE id = ?`, [row.id]);
  }
  return result;
}

export async function getBalance(db: Db, userId: string): Promise<number> {
  assertUserId(userId);
  return balanceOf(db, userId);
}

export async function getAccount(db: Db, userId: string): Promise<{ balance: number; paused: boolean }> {
  assertUserId(userId);
  const row = await db.get<{ balance: unknown; paused: unknown }>(
    `SELECT balance, paused FROM credit_balances WHERE user_id = ?`,
    [userId],
  );
  if (!row) return { balance: 0, paused: false };
  return { balance: asInt(row.balance), paused: asBool(row.paused) === true };
}

/** Advisory read. Spend with reserve or track, not with check. */
export async function check(
  db: Db,
  userId: string,
  amount: number,
): Promise<{ ok: boolean; balance: number; paused?: boolean }> {
  assertUserId(userId);
  assertNonNegativeInt(amount);
  const account = await getAccount(db, userId);
  if (account.paused) return { ok: false, balance: account.balance, paused: true };
  return { ok: account.balance >= amount, balance: account.balance };
}

export async function reserve(
  db: Db,
  input: { userId: string; amount: number; idempotencyKey: string },
): Promise<ReserveSuccess | ReserveFailure> {
  assertUserId(input.userId);
  assertPositiveInt(input.amount);
  assertIdempotencyKey(input.idempotencyKey);
  await reapExpiredHolds(db);

  return db.transaction(async (tx) => {
    const locked = await lockBalanceRow(tx, input.userId);
    const existing = await loadByKey(tx, input.userId, input.idempotencyKey);
    if (existing) {
      if (existing.kind !== "reserve") {
        return { ok: false, error: "idempotency_key_reused", balance: locked.balance };
      }
      const reservedAmount = -asInt(existing.delta);
      if (reservedAmount !== input.amount) {
        return { ok: false, error: "idempotency_amount_mismatch", balance: locked.balance };
      }
      if (existing.status === "held") {
        return {
          ok: true,
          replay: true,
          reservationId: existing.id,
          status: "held",
          balance: locked.balance,
        };
      }
      return {
        ok: false,
        error: finishedReserveError(existing.status ?? ""),
        balance: locked.balance,
      };
    }
    if (locked.paused) {
      return { ok: false, error: "account_paused", balance: locked.balance };
    }

    const updated = await tx.get<{ balance: unknown }>(
      `UPDATE credit_balances
       SET balance = balance - ?, updated_at = ?
       WHERE user_id = ? AND balance >= ?
       RETURNING balance`,
      [input.amount, isoNow(), input.userId, input.amount],
    );
    if (!updated) {
      return { ok: false, error: "insufficient_credits", balance: await balanceOf(tx, input.userId) };
    }

    const reservationId = await insertEntry(tx, {
      userId: input.userId,
      delta: -input.amount,
      kind: "reserve",
      status: "held",
      idempotencyKey: input.idempotencyKey,
      stripeEventId: null,
      checkoutSessionId: null,
      paymentIntentId: null,
      packId: null,
      note: null,
      livemode: null,
    });
    return {
      ok: true,
      replay: false,
      reservationId,
      status: "held",
      balance: asInt(updated.balance),
    };
  });
}

export async function finalize(
  db: Db,
  userId: string,
  idempotencyKey: string,
): Promise<MutationSuccess | MutationFailure> {
  assertUserId(userId);
  assertIdempotencyKey(idempotencyKey);
  return db.transaction(async (tx) => settle(tx, userId, idempotencyKey, "finalized"));
}

export async function release(
  db: Db,
  userId: string,
  idempotencyKey: string,
): Promise<MutationSuccess | MutationFailure> {
  assertUserId(userId);
  assertIdempotencyKey(idempotencyKey);
  return db.transaction(async (tx) => settle(tx, userId, idempotencyKey, "released"));
}

async function settle(
  tx: Executor,
  userId: string,
  idempotencyKey: string,
  target: "finalized" | "released",
): Promise<MutationSuccess | MutationFailure> {
  const initial = await loadReserve(tx, userId, idempotencyKey);
  if (!initial) {
    return { ok: false, error: "reservation_not_found", balance: await balanceOf(tx, userId) };
  }
  await lockBalanceRow(tx, userId);
  const current = await loadReserve(tx, userId, idempotencyKey);
  if (!current) {
    return { ok: false, error: "reservation_not_found", balance: await balanceOf(tx, userId) };
  }
  if (current.status === "expired") {
    return { ok: false, error: "hold_expired", balance: await balanceOf(tx, userId) };
  }
  if (current.status === target) {
    return {
      ok: true,
      replay: true,
      balance: await balanceOf(tx, userId),
      reservationId: current.id,
    };
  }
  if (current.status === "finalized" || current.status === "released") {
    return {
      ok: false,
      error: current.status === "finalized" ? "already_finalized" : "already_released",
      balance: await balanceOf(tx, userId),
    };
  }
  if (current.status !== "held") throw new LedgerError("corrupt_reservation");

  const claimed = await tx.get<{ id: string }>(
    `UPDATE credit_ledger_entries
     SET status = ?
     WHERE id = ? AND user_id = ? AND status = 'held'
     RETURNING id`,
    [target, current.id, userId],
  );
  if (!claimed) {
    const again = await loadReserve(tx, userId, idempotencyKey);
    if (again?.status === target) {
      return {
        ok: true,
        replay: true,
        balance: await balanceOf(tx, userId),
        reservationId: again.id,
      };
    }
    if (again?.status === "expired") {
      return { ok: false, error: "hold_expired", balance: await balanceOf(tx, userId) };
    }
    return {
      ok: false,
      error: again?.status === "finalized" ? "already_finalized" : "already_released",
      balance: await balanceOf(tx, userId),
    };
  }

  if (target === "released") {
    const amount = -asInt(current.delta);
    if (amount <= 0) throw new LedgerError("invalid_reservation_delta");
    await creditBalance(tx, userId, amount);
  }

  await insertEntry(tx, {
    userId,
    delta: target === "released" ? -asInt(current.delta) : 0,
    kind: target === "released" ? "release" : "finalize",
    status: target,
    idempotencyKey: null,
    stripeEventId: null,
    checkoutSessionId: null,
    paymentIntentId: null,
    packId: null,
    note: null,
    livemode: null,
  });

  return {
    ok: true,
    replay: false,
    balance: await balanceOf(tx, userId),
    reservationId: current.id,
  };
}

export async function track(
  db: Db,
  input: { userId: string; amount: number; idempotencyKey: string; note?: string | null },
): Promise<
  | { ok: true; replay: boolean; balance: number }
  | Pick<ReserveFailure, "ok" | "error" | "balance">
> {
  assertUserId(input.userId);
  assertPositiveInt(input.amount);
  assertIdempotencyKey(input.idempotencyKey);

  return db.transaction(async (tx) => {
    const locked = await lockBalanceRow(tx, input.userId);
    const existing = await loadByKey(tx, input.userId, input.idempotencyKey);
    if (existing) {
      if (existing.kind !== "track") {
        return { ok: false as const, error: "idempotency_key_reused" as const, balance: locked.balance };
      }
      if (-asInt(existing.delta) !== input.amount) {
        return { ok: false as const, error: "idempotency_amount_mismatch" as const, balance: locked.balance };
      }
      return { ok: true as const, replay: true, balance: locked.balance };
    }
    if (locked.paused) {
      return { ok: false as const, error: "account_paused" as const, balance: locked.balance };
    }
    const updated = await tx.get<{ balance: unknown }>(
      `UPDATE credit_balances
       SET balance = balance - ?, updated_at = ?
       WHERE user_id = ? AND balance >= ?
       RETURNING balance`,
      [input.amount, isoNow(), input.userId, input.amount],
    );
    if (!updated) {
      return { ok: false as const, error: "insufficient_credits" as const, balance: await balanceOf(tx, input.userId) };
    }
    await insertEntry(tx, {
      userId: input.userId,
      delta: -input.amount,
      kind: "track",
      status: null,
      idempotencyKey: input.idempotencyKey,
      stripeEventId: null,
      checkoutSessionId: null,
      paymentIntentId: null,
      packId: null,
      note: input.note ?? null,
      livemode: null,
    });
    return { ok: true as const, replay: false, balance: asInt(updated.balance) };
  });
}

/**
 * balance = grants − finalized spends − held reserves − clawbacks.
 *
 * finalized spends = finalized reserve amounts + track amounts.
 * Released and expired reserves are omitted: their credits are back in the balance.
 * Release, expire, finalize, and shortfall journal rows are not added again.
 * The equality is exact for this integer ledger.
 */
export async function balanceBreakdown(
  db: Db,
  userId: string,
): Promise<{
  balance: number;
  expected: number;
  grants: number;
  finalizedSpends: number;
  heldReserves: number;
  clawbacks: number;
}> {
  assertUserId(userId);
  const row = await db.get<{
    grants: unknown;
    tracks: unknown;
    finalized_reserves: unknown;
    held: unknown;
    clawbacks: unknown;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN kind = 'grant' THEN delta ELSE 0 END), 0) AS grants,
       COALESCE(SUM(CASE WHEN kind = 'track' THEN -delta ELSE 0 END), 0) AS tracks,
       COALESCE(SUM(CASE WHEN kind = 'reserve' AND status = 'finalized' THEN -delta ELSE 0 END), 0) AS finalized_reserves,
       COALESCE(SUM(CASE WHEN kind = 'reserve' AND status = 'held' THEN -delta ELSE 0 END), 0) AS held,
       COALESCE(SUM(CASE WHEN kind = 'clawback' THEN -delta ELSE 0 END), 0) AS clawbacks
     FROM credit_ledger_entries
     WHERE user_id = ?`,
    [userId],
  );
  const grants = asInt(row?.grants ?? 0);
  const finalizedSpends = asInt(row?.tracks ?? 0) + asInt(row?.finalized_reserves ?? 0);
  const heldReserves = asInt(row?.held ?? 0);
  const clawbacks = asInt(row?.clawbacks ?? 0);
  const expected = grants - finalizedSpends - heldReserves - clawbacks;
  const balance = await getBalance(db, userId);
  return { balance, expected, grants, finalizedSpends, heldReserves, clawbacks };
}

export async function listEntries(db: Db, userId: string, limit = 20): Promise<LedgerEntry[]> {
  assertUserId(userId);
  const capped = Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 20;
  const rows = await db.all<EntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM credit_ledger_entries WHERE user_id = ? ORDER BY seq DESC LIMIT ?`,
    [userId, capped],
  );
  return rows.map(mapEntry);
}

export async function listHeldReservations(db: Db, userId: string): Promise<{ idempotencyKey: string }[]> {
  assertUserId(userId);
  const rows = await db.all<{ idempotency_key: string }>(
    `SELECT idempotency_key FROM credit_ledger_entries
     WHERE user_id = ? AND kind = 'reserve' AND status = 'held'
     ORDER BY seq ASC`,
    [userId],
  );
  return rows.flatMap((row) => (row.idempotency_key ? [{ idempotencyKey: row.idempotency_key }] : []));
}

/** Insert the demo starting balance once. Callers decide whether the demo flag allows it. */
export async function seedDemoUser(db: Db, userId: string, credits = 100): Promise<void> {
  assertUserId(userId);
  assertPositiveInt(credits);
  await grantCredits(db, {
    userId,
    credits,
    packId: "demo_seed",
    idempotencyKey: `seed:${userId}`,
    note: "Demo starting balance",
  });
}

async function expireOne(tx: Executor, reservationId: string, cutoff: string): Promise<boolean> {
  const initial = await tx.get<EntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM credit_ledger_entries WHERE id = ?`,
    [reservationId],
  );
  if (!initial || initial.kind !== "reserve" || initial.status !== "held") return false;
  if (initial.created_at > cutoff) return false;
  await lockBalanceRow(tx, initial.user_id);
  const current = await tx.get<EntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM credit_ledger_entries WHERE id = ?`,
    [reservationId],
  );
  if (!current || current.status !== "held" || current.created_at > cutoff) return false;
  const amount = -asInt(current.delta);
  if (amount <= 0) throw new LedgerError("invalid_reservation_delta");
  const claimed = await tx.get<{ id: string }>(
    `UPDATE credit_ledger_entries
     SET status = 'expired'
     WHERE id = ? AND status = 'held'
     RETURNING id`,
    [current.id],
  );
  if (!claimed) return false;
  await creditBalance(tx, current.user_id, amount);
  await insertEntry(tx, {
    userId: current.user_id,
    delta: amount,
    kind: "expire",
    status: "expired",
    idempotencyKey: null,
    stripeEventId: null,
    checkoutSessionId: null,
    paymentIntentId: null,
    packId: null,
    note: "Hold expired",
    livemode: null,
  });
  return true;
}

/**
 * Return credits for holds older than the TTL. Safe to call often.
 * One call processes up to 200 holds; call again if you expect more.
 *
 * Production must run `npm run holds:reap`. Postgres locks the batch with
 * FOR UPDATE SKIP LOCKED so two reapers do not claim the same hold. SQLite
 * has no SKIP LOCKED; each hold is claimed with UPDATE ... WHERE status = 'held',
 * and only the process that changes the row returns the credits.
 */
export async function reapExpiredHolds(
  db: Db,
  options?: { now?: Date; ttlSeconds?: number },
): Promise<{ expired: number }> {
  const now = options?.now ?? new Date();
  const ttl = options?.ttlSeconds ?? holdTtlSeconds();
  const cutoff = new Date(now.getTime() - ttl * 1000).toISOString();
  if ((await databaseDialect(db)) === "postgres") {
    const expired = await db.transaction(async (tx) => {
      const rows = await tx.all<{ id: string }>(
        `SELECT id FROM credit_ledger_entries
         WHERE kind = 'reserve' AND status = 'held' AND created_at <= ?
         ORDER BY created_at ASC
         LIMIT ?
         FOR UPDATE SKIP LOCKED`,
        [cutoff, REAPER_BATCH],
      );
      let count = 0;
      for (const row of rows) {
        if (await expireOne(tx, row.id, cutoff)) count += 1;
      }
      return count;
    });
    return { expired };
  }

  const rows = await db.all<{ id: string }>(
    `SELECT id FROM credit_ledger_entries
     WHERE kind = 'reserve' AND status = 'held' AND created_at <= ?
     ORDER BY created_at ASC
     LIMIT ?`,
    [cutoff, REAPER_BATCH],
  );
  let expired = 0;
  for (const row of rows) {
    const did = await db.transaction((tx) => expireOne(tx, row.id, cutoff));
    if (did) expired += 1;
  }
  return { expired };
}
