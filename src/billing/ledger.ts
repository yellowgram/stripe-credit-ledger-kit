/**
 * MIT License — this file only. Copyright (c) 2026 yellowgram.
 * Full notice: src/billing/LICENSE.MIT. The rest of the repository is not MIT.
 *
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
 *   row, and the credits returned. Call reapExpiredHolds on a timer; reserve()
 *   also calls it so a crash does not black-hole credits forever.
 * - This file does not bill partial token usage.
 */
import { randomUUID } from "node:crypto";
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
    packId: string | null;
    note: string | null;
    livemode: boolean | null;
  },
): Promise<string> {
  const id = entry.id ?? randomUUID();
  await tx.run(
    `INSERT INTO credit_ledger_entries
      (id, user_id, delta, kind, status, idempotency_key, stripe_event_id, checkout_session_id, payment_intent_id, pack_id, note, livemode, created_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      entry.userId,
      entry.delta,
      entry.kind,
      entry.status,
      entry.idempotencyKey,
      entry.stripeEventId,
      entry.checkoutSessionId,
      entry.paymentIntentId,
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

async function grantReplay(tx: Executor, input: GrantInput): Promise<boolean> {
  const byKey = await tx.get<{ id: string }>(
    `SELECT id FROM credit_ledger_entries
     WHERE user_id = ? AND idempotency_key = ? AND kind = 'grant'`,
    [input.userId, input.idempotencyKey],
  );
  if (byKey) return true;
  if (input.stripeEventId) {
    const byEvent = await tx.get<{ id: string }>(
      `SELECT id FROM credit_ledger_entries WHERE stripe_event_id = ?`,
      [input.stripeEventId],
    );
    if (byEvent) return true;
  }
  if (input.checkoutSessionId) {
    const bySession = await tx.get<{ id: string }>(
      `SELECT id FROM credit_ledger_entries WHERE checkout_session_id = ?`,
      [input.checkoutSessionId],
    );
    if (bySession) return true;
  }
  return false;
}

/** Grant inside an existing transaction (webhook path). A new grant clears pause. */
export async function applyGrant(tx: Executor, input: GrantInput): Promise<{ balance: number; replay: boolean }> {
  assertUserId(input.userId);
  assertPositiveInt(input.credits);
  assertIdempotencyKey(input.idempotencyKey);
  if (typeof input.packId !== "string" || input.packId.trim() === "" || input.packId.length > 200) {
    throw new LedgerError("invalid_pack");
  }
  await lockBalanceRow(tx, input.userId);
  if (await grantReplay(tx, input)) {
    return { balance: await balanceOf(tx, input.userId), replay: true };
  }
  await tx.run(
    `UPDATE credit_balances
     SET balance = balance + ?, paused = 0, updated_at = ?
     WHERE user_id = ?`,
    [input.credits, isoNow(), input.userId],
  );
  await insertEntry(tx, {
    userId: input.userId,
    delta: input.credits,
    kind: "grant",
    status: null,
    idempotencyKey: input.idempotencyKey,
    stripeEventId: input.stripeEventId ?? null,
    checkoutSessionId: input.checkoutSessionId ?? null,
    paymentIntentId: input.paymentIntentId ?? null,
    packId: input.packId,
    note: input.note ?? null,
    livemode: input.livemode ?? null,
  });
  return { balance: await balanceOf(tx, input.userId), replay: false };
}

export async function grantCredits(db: Db, input: GrantInput): Promise<{ balance: number; replay: boolean }> {
  return db.transaction((tx) => applyGrant(tx, input));
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
 * Remove up to `credits` from the spendable balance. If the user already spent
 * part of the grant, take what is left, pause the user, and journal the shortfall.
 * One clawback row per payment intent. A later new grant clears the pause.
 */
export async function applyClawback(tx: Executor, input: ClawbackInput): Promise<ClawbackResult> {
  assertUserId(input.userId);
  assertPositiveInt(input.credits);
  assertIdempotencyKey(input.stripeEventId);
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
  await insertEntry(tx, {
    userId: input.userId,
    delta: -clawedBack,
    kind: "clawback",
    status: null,
    idempotencyKey: input.stripeEventId,
    stripeEventId: input.stripeEventId,
    checkoutSessionId: null,
    paymentIntentId: input.paymentIntentId,
    packId: null,
    note: input.note,
    livemode: null,
  });
  let paused = false;
  if (shortfall > 0) {
    await tx.run(`UPDATE credit_balances SET paused = 1, updated_at = ? WHERE user_id = ?`, [
      isoNow(),
      input.userId,
    ]);
    await insertEntry(tx, {
      userId: input.userId,
      delta: 0,
      kind: "shortfall",
      status: null,
      idempotencyKey: `${input.stripeEventId}:shortfall`,
      stripeEventId: null,
      checkoutSessionId: null,
      paymentIntentId: null,
      packId: null,
      note: `shortfall ${shortfall} credits`,
      livemode: null,
    });
    paused = true;
  }
  return {
    balance: await balanceOf(tx, input.userId),
    clawedBack,
    shortfall,
    paused,
    replay: false,
  };
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
    await tx.run(
      `UPDATE credit_balances SET balance = balance + ?, updated_at = ? WHERE user_id = ?`,
      [amount, isoNow(), userId],
    );
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
  await tx.run(
    `UPDATE credit_balances SET balance = balance + ?, updated_at = ? WHERE user_id = ?`,
    [amount, isoNow(), current.user_id],
  );
  await insertEntry(tx, {
    userId: current.user_id,
    delta: amount,
    kind: "expire",
    status: "expired",
    idempotencyKey: `expire:${current.id}`,
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
 */
export async function reapExpiredHolds(
  db: Db,
  options?: { now?: Date; ttlSeconds?: number },
): Promise<{ expired: number }> {
  const now = options?.now ?? new Date();
  const ttl = options?.ttlSeconds ?? holdTtlSeconds();
  const cutoff = new Date(now.getTime() - ttl * 1000).toISOString();
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
