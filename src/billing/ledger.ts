/**
 * MIT License — this file only. Copyright (c) 2026 yellowgram.
 * Full notice: src/billing/LICENSE.MIT. The rest of the repository is not MIT.
 *
 * Policy (bill the reservation):
 * - check is advisory. It does not lock.
 * - reserve and track are the hard gate. Both run
 *   UPDATE credit_balances SET balance = balance - ? WHERE user_id = ? AND balance >= ?
 *   inside a transaction that first locks the user's balance row.
 * - Credits leave the spendable balance when reserve succeeds.
 * - finalize confirms the hold and does not change the balance.
 * - release returns the full reserved amount. Call it when the provider fails.
 * - This file does not bill partial token usage. Fork finalize if you need that.
 */
import { randomUUID } from "node:crypto";
import { LedgerError } from "./errors";
import type {
  Db,
  Executor,
  GrantInput,
  Insufficient,
  LedgerEntry,
  LedgerKind,
  MutationFailure,
  MutationSuccess,
  ReservationStatus,
  ReserveSuccess,
} from "./types";

const ENTRY_COLUMNS = `id, user_id, delta, kind, status, idempotency_key, stripe_event_id, checkout_session_id, pack_id, note, created_at, seq`;

type EntryRow = {
  id: string;
  user_id: string;
  delta: unknown;
  kind: string;
  status: string | null;
  idempotency_key: string | null;
  stripe_event_id: string | null;
  checkout_session_id: string | null;
  pack_id: string | null;
  note: string | null;
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

function mapEntry(row: EntryRow): LedgerEntry {
  const kind = row.kind as LedgerKind;
  const status = (row.status ?? null) as ReservationStatus | null;
  return {
    id: row.id,
    userId: row.user_id,
    delta: asInt(row.delta),
    kind,
    status,
    idempotencyKey: row.idempotency_key,
    stripeEventId: row.stripe_event_id,
    checkoutSessionId: row.checkout_session_id,
    packId: row.pack_id,
    note: row.note,
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

/**
 * Serialize mutations for one user. The following UPDATE locks the row on
 * Postgres for the rest of the transaction. SQLite serializes writers with
 * BEGIN IMMEDIATE in the adapter. The balance predicate is still what makes
 * the last credit safe if two connections interleave.
 */
async function lockBalanceRow(tx: Executor, userId: string): Promise<void> {
  await tx.run(
    `INSERT INTO credit_balances (user_id, balance, updated_at)
     VALUES (?, 0, ?)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, isoNow()],
  );
  const row = await tx.get<{ balance: unknown }>(
    `UPDATE credit_balances SET updated_at = ? WHERE user_id = ? RETURNING balance`,
    [isoNow(), userId],
  );
  if (!row) throw new LedgerError("balance_row_missing");
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
    packId: string | null;
    note: string | null;
  },
): Promise<string> {
  const id = entry.id ?? randomUUID();
  await tx.run(
    `INSERT INTO credit_ledger_entries
      (id, user_id, delta, kind, status, idempotency_key, stripe_event_id, checkout_session_id, pack_id, note, created_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      entry.userId,
      entry.delta,
      entry.kind,
      entry.status,
      entry.idempotencyKey,
      entry.stripeEventId,
      entry.checkoutSessionId,
      entry.packId,
      entry.note,
      isoNow(),
      nextSeq(),
    ],
  );
  return id;
}

async function loadReserve(tx: Executor, idempotencyKey: string): Promise<EntryRow | undefined> {
  return tx.get<EntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM credit_ledger_entries WHERE idempotency_key = ? AND kind = 'reserve'`,
    [idempotencyKey],
  );
}

async function grantReplay(tx: Executor, input: GrantInput): Promise<boolean> {
  const byKey = await tx.get<{ id: string }>(
    `SELECT id FROM credit_ledger_entries WHERE idempotency_key = ? AND kind = 'grant'`,
    [input.idempotencyKey],
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

/** Grant inside an existing transaction (webhook path). */
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
    `UPDATE credit_balances SET balance = balance + ?, updated_at = ? WHERE user_id = ?`,
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
    packId: input.packId,
    note: input.note ?? null,
  });
  return { balance: await balanceOf(tx, input.userId), replay: false };
}

export async function grantCredits(db: Db, input: GrantInput): Promise<{ balance: number; replay: boolean }> {
  return db.transaction((tx) => applyGrant(tx, input));
}

export async function getBalance(db: Db, userId: string): Promise<number> {
  assertUserId(userId);
  return balanceOf(db, userId);
}

/** Advisory read. Spend with reserve or track, not with check. */
export async function check(db: Db, userId: string, amount: number): Promise<{ ok: boolean; balance: number }> {
  assertUserId(userId);
  assertNonNegativeInt(amount);
  const balance = await getBalance(db, userId);
  return { ok: balance >= amount, balance };
}

export async function reserve(
  db: Db,
  input: { userId: string; amount: number; idempotencyKey: string },
): Promise<ReserveSuccess | Insufficient> {
  assertUserId(input.userId);
  assertPositiveInt(input.amount);
  assertIdempotencyKey(input.idempotencyKey);

  return db.transaction(async (tx) => {
    await lockBalanceRow(tx, input.userId);
    const existing = await loadReserve(tx, input.idempotencyKey);
    if (existing) {
      if (existing.status !== "held" && existing.status !== "finalized" && existing.status !== "released") {
        throw new LedgerError("corrupt_reservation");
      }
      return {
        ok: true,
        replay: true,
        reservationId: existing.id,
        status: existing.status,
        balance: await balanceOf(tx, input.userId),
      };
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
      packId: null,
      note: null,
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

export async function finalize(db: Db, idempotencyKey: string): Promise<MutationSuccess | MutationFailure> {
  assertIdempotencyKey(idempotencyKey);
  return db.transaction(async (tx) => settle(tx, idempotencyKey, "finalized"));
}

export async function release(db: Db, idempotencyKey: string): Promise<MutationSuccess | MutationFailure> {
  assertIdempotencyKey(idempotencyKey);
  return db.transaction(async (tx) => settle(tx, idempotencyKey, "released"));
}

async function settle(
  tx: Executor,
  idempotencyKey: string,
  target: "finalized" | "released",
): Promise<MutationSuccess | MutationFailure> {
  const initial = await loadReserve(tx, idempotencyKey);
  if (!initial) {
    return { ok: false, error: "reservation_not_found", balance: 0 };
  }
  await lockBalanceRow(tx, initial.user_id);
  const current = await loadReserve(tx, idempotencyKey);
  if (!current) {
    return { ok: false, error: "reservation_not_found", balance: await balanceOf(tx, initial.user_id) };
  }
  if (current.status === target) {
    return {
      ok: true,
      replay: true,
      balance: await balanceOf(tx, current.user_id),
      reservationId: current.id,
    };
  }
  if (current.status === "finalized" || current.status === "released") {
    return {
      ok: false,
      error: current.status === "finalized" ? "already_finalized" : "already_released",
      balance: await balanceOf(tx, current.user_id),
    };
  }
  if (current.status !== "held") throw new LedgerError("corrupt_reservation");

  const claimed = await tx.get<{ id: string }>(
    `UPDATE credit_ledger_entries SET status = ? WHERE id = ? AND status = 'held' RETURNING id`,
    [target, current.id],
  );
  if (!claimed) {
    const again = await loadReserve(tx, idempotencyKey);
    if (again?.status === target) {
      return {
        ok: true,
        replay: true,
        balance: await balanceOf(tx, again.user_id),
        reservationId: again.id,
      };
    }
    return {
      ok: false,
      error: again?.status === "finalized" ? "already_finalized" : "already_released",
      balance: await balanceOf(tx, current.user_id),
    };
  }

  if (target === "released") {
    const amount = -asInt(current.delta);
    if (amount <= 0) throw new LedgerError("invalid_reservation_delta");
    await tx.run(
      `UPDATE credit_balances SET balance = balance + ?, updated_at = ? WHERE user_id = ?`,
      [amount, isoNow(), current.user_id],
    );
  }

  await insertEntry(tx, {
    userId: current.user_id,
    delta: target === "released" ? -asInt(current.delta) : 0,
    kind: target === "released" ? "release" : "finalize",
    status: target,
    idempotencyKey,
    stripeEventId: null,
    checkoutSessionId: null,
    packId: null,
    note: null,
  });

  return {
    ok: true,
    replay: false,
    balance: await balanceOf(tx, current.user_id),
    reservationId: current.id,
  };
}

/**
 * At-most-once spend for work you do not need to roll back.
 * Prefer reserve → finalize | release around LLM calls.
 */
export async function track(
  db: Db,
  input: { userId: string; amount: number; idempotencyKey: string; note?: string | null },
): Promise<{ ok: true; replay: boolean; balance: number } | Insufficient> {
  assertUserId(input.userId);
  assertPositiveInt(input.amount);
  assertIdempotencyKey(input.idempotencyKey);

  return db.transaction(async (tx) => {
    await lockBalanceRow(tx, input.userId);
    const existing = await tx.get<{ id: string }>(
      `SELECT id FROM credit_ledger_entries WHERE idempotency_key = ? AND kind = 'track'`,
      [input.idempotencyKey],
    );
    if (existing) {
      return { ok: true, replay: true, balance: await balanceOf(tx, input.userId) };
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
    await insertEntry(tx, {
      userId: input.userId,
      delta: -input.amount,
      kind: "track",
      status: null,
      idempotencyKey: input.idempotencyKey,
      stripeEventId: null,
      checkoutSessionId: null,
      packId: null,
      note: input.note ?? null,
    });
    return { ok: true, replay: false, balance: asInt(updated.balance) };
  });
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

/** Insert the demo starting balance once. Safe to call on every boot. */
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
