import type Stripe from "stripe";
import { LedgerError } from "./errors";
import { applyClawback, applyGrant } from "./ledger";
import { getPack } from "./packs";
import type { Db, Executor } from "./types";

/**
 * Primary grant path: checkout.session.completed when payment_status is paid.
 * Delayed payment methods: checkout.session.async_payment_succeeded.
 * payment_intent.succeeded is stored and ignored so it cannot double-grant.
 *
 * Credits come from the pack catalog. metadata.credits is not authority.
 * session.amount_total must equal the pack price and currency must match.
 *
 * charge.refunded and charge.dispute.created claw back the full grant.
 * Open holds are released in that same transaction, then the balance is debited.
 * A missing grant is stored and ignored (HTTP 200), not retried forever.
 */
const SESSION_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

const CLAWBACK_EVENT_TYPES = new Set(["charge.refunded", "charge.dispute.created"]);

export type StripeEventInput = {
  id: string;
  type: string;
  livemode?: boolean;
  data: {
    object?: {
      id?: string;
      object?: string;
      payment_status?: string;
      amount_total?: number | null;
      currency?: string | null;
      payment_intent?: string | { id?: string } | null;
      charge?: string | { id?: string; payment_intent?: string | { id?: string } | null } | null;
      latest_charge?: string | { id?: string } | null;
      checkout_session?: string | null;
      metadata?: Record<string, string> | null;
    } | null;
  };
};

export type WebhookResult = {
  duplicate: boolean;
  granted: boolean;
  reason?:
    | "duplicate_event"
    | "ignored_event"
    | "unpaid"
    | "session_already_granted"
    | "clawed_back"
    | "already_clawed_back"
    | "ignored_unknown_payment_intent"
    | "invalid_metadata";
  clawedBack?: number;
  shortfall?: number;
  paused?: boolean;
};

type StripeModeEnv = {
  STRIPE_SECRET_KEY?: string;
  STRIPE_EXPECT_LIVEMODE?: string;
  [key: string]: string | undefined;
};

function isoNow(): string {
  return new Date().toISOString();
}

/**
 * sk_live_ expects livemode true. Anything else (including sk_test_ and an
 * unset key) expects livemode false. STRIPE_EXPECT_LIVEMODE=true|false wins.
 */
export function expectedLivemode(env: StripeModeEnv = process.env): boolean {
  if (env.STRIPE_EXPECT_LIVEMODE === "true") return true;
  if (env.STRIPE_EXPECT_LIVEMODE === "false") return false;
  return (env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_");
}

export function verifyStripeEvent(
  stripe: Stripe,
  rawBody: string,
  signature: string | null | undefined,
  secret: string | undefined,
): Stripe.Event {
  if (!signature) throw new LedgerError("missing_signature");
  if (!secret) throw new LedgerError("missing_webhook_secret");
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

function paymentIntentIdOf(value: string | { id?: string } | null | undefined): string | null {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (value && typeof value === "object" && typeof value.id === "string" && value.id.trim() !== "") {
    return value.id;
  }
  return null;
}

function chargeIdOf(
  value: string | { id?: string; payment_intent?: string | { id?: string } | null } | null | undefined,
): string | null {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (value && typeof value === "object" && typeof value.id === "string" && value.id.trim() !== "") {
    return value.id;
  }
  return null;
}

function readGrant(session: NonNullable<StripeEventInput["data"]["object"]>): {
  sessionId: string;
  userId: string;
  packId: string;
  credits: number;
  paymentIntentId: string | null;
  chargeId: string | null;
} {
  const sessionId = session.id;
  const metadata = session.metadata ?? {};
  const userId = metadata.userId?.trim();
  const packId = metadata.packId?.trim();
  if (!sessionId || !userId || !packId) {
    throw new LedgerError("invalid_metadata");
  }
  const pack = getPack(packId);
  if (!pack) throw new LedgerError("unknown_pack");
  if (session.amount_total !== pack.amountCents) {
    throw new LedgerError("amount_mismatch");
  }
  if ((session.currency ?? "").toLowerCase() !== pack.currency) {
    throw new LedgerError("currency_mismatch");
  }
  return {
    sessionId,
    userId,
    packId,
    credits: pack.credits,
    paymentIntentId: paymentIntentIdOf(session.payment_intent),
    chargeId: chargeIdOf(session.latest_charge) ?? chargeIdOf(session.charge),
  };
}

/**
 * Charge id to look up when a refund or dispute has no payment intent on the payload.
 * Webhook API versions often send dispute.charge as an id and omit payment_intent.
 */
export function unresolvedChargeId(event: StripeEventInput): string | null {
  if (!event?.type || !CLAWBACK_EVENT_TYPES.has(event.type) || !event.data?.object) return null;
  const ids = clawbackIds(event.data.object);
  if (ids.paymentIntentId) return null;
  return ids.chargeId;
}

export function withPaymentIntent(event: StripeEventInput, paymentIntentId: string): StripeEventInput {
  const object = event.data.object;
  if (!object) return event;
  return {
    ...event,
    data: { ...event.data, object: { ...object, payment_intent: paymentIntentId } },
  };
}

/**
 * Verify the signature before calling this.
 * Signature problems and livemode_mismatch are the caller's 400.
 * livemode is checked before any insert so a wrong key does not burn the event id.
 * Other throws are retryable (HTTP 500): the stripe_events insert rolls back.
 */
export async function handleStripeEvent(
  db: Db,
  event: StripeEventInput,
  env: StripeModeEnv = process.env,
): Promise<WebhookResult> {
  if (!event?.id || !event?.type || !event.data) {
    throw new LedgerError("invalid_event");
  }
  const live = event.livemode === true;
  if (live !== expectedLivemode(env)) {
    throw new LedgerError("livemode_mismatch");
  }

  return db.transaction(async (tx) => {
    const inserted = await tx.get<{ id: string }>(
      `INSERT INTO stripe_events (id, type, livemode, received_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [event.id, event.type, live ? 1 : 0, isoNow()],
    );
    if (!inserted) {
      return { duplicate: true, granted: false, reason: "duplicate_event" };
    }

    if (CLAWBACK_EVENT_TYPES.has(event.type)) {
      return clawbackEvent(tx, event);
    }

    if (!SESSION_EVENT_TYPES.has(event.type)) {
      return { duplicate: false, granted: false, reason: "ignored_event" };
    }

    const session = event.data.object;
    if (!session) throw new LedgerError("invalid_event");

    if (event.type === "checkout.session.completed" && session.payment_status !== "paid") {
      return { duplicate: false, granted: false, reason: "unpaid" };
    }

    let grant: ReturnType<typeof readGrant>;
    try {
      grant = readGrant(session);
    } catch (error) {
      if (error instanceof LedgerError && error.code === "invalid_metadata") {
        return { duplicate: false, granted: false, reason: "invalid_metadata" };
      }
      throw error;
    }
    if (!grant.paymentIntentId) throw new LedgerError("missing_payment_intent");
    const already = await tx.get<{ id: string }>(
      `SELECT id FROM credit_ledger_entries WHERE checkout_session_id = ?`,
      [grant.sessionId],
    );
    if (already) {
      return { duplicate: false, granted: false, reason: "session_already_granted" };
    }

    const applied = await applyGrant(tx, {
      userId: grant.userId,
      credits: grant.credits,
      packId: grant.packId,
      idempotencyKey: event.id,
      stripeEventId: event.id,
      checkoutSessionId: grant.sessionId,
      paymentIntentId: grant.paymentIntentId,
      chargeId: grant.chargeId,
      livemode: live,
      note: "Stripe Checkout credit pack",
    });
    if (applied.replay) {
      return { duplicate: false, granted: false, reason: "session_already_granted" };
    }
    return { duplicate: false, granted: true };
  });
}

type GrantHit = { user_id: string; delta: unknown; payment_intent_id: string | null };

async function findGrant(
  tx: Executor,
  ids: { paymentIntentId: string | null; chargeId: string | null; sessionId: string | null },
): Promise<GrantHit | undefined> {
  if (ids.paymentIntentId) {
    const byPayment = await tx.get<GrantHit>(
      `SELECT user_id, delta, payment_intent_id FROM credit_ledger_entries
       WHERE kind = 'grant' AND payment_intent_id = ?`,
      [ids.paymentIntentId],
    );
    if (byPayment) return byPayment;
  }
  if (ids.chargeId) {
    const byCharge = await tx.get<GrantHit>(
      `SELECT user_id, delta, payment_intent_id FROM credit_ledger_entries
       WHERE kind = 'grant' AND charge_id = ?`,
      [ids.chargeId],
    );
    if (byCharge) return byCharge;
  }
  if (ids.sessionId) {
    const bySession = await tx.get<GrantHit>(
      `SELECT user_id, delta, payment_intent_id FROM credit_ledger_entries
       WHERE kind = 'grant' AND checkout_session_id = ?`,
      [ids.sessionId],
    );
    if (bySession) return bySession;
  }
  return undefined;
}

function clawbackIds(object: NonNullable<StripeEventInput["data"]["object"]>): {
  paymentIntentId: string | null;
  chargeId: string | null;
  sessionId: string | null;
} {
  const nestedCharge = object.charge && typeof object.charge === "object" ? object.charge : null;
  const paymentIntentId =
    paymentIntentIdOf(object.payment_intent) ?? paymentIntentIdOf(nestedCharge?.payment_intent);
  const chargeId =
    chargeIdOf(object.charge) ?? (object.object === "charge" ? (object.id ?? null) : null);
  const sessionId =
    typeof object.checkout_session === "string" && object.checkout_session.trim() !== ""
      ? object.checkout_session
      : object.object === "checkout.session"
        ? (object.id ?? null)
        : null;
  return { paymentIntentId, chargeId, sessionId };
}

async function clawbackEvent(tx: Executor, event: StripeEventInput): Promise<WebhookResult> {
  const object = event.data.object;
  if (!object) {
    return { duplicate: false, granted: false, reason: "ignored_unknown_payment_intent" };
  }
  const ids = clawbackIds(object);
  const grant = await findGrant(tx, ids);
  if (!grant) {
    return { duplicate: false, granted: false, reason: "ignored_unknown_payment_intent" };
  }
  const paymentIntentId = grant.payment_intent_id ?? ids.paymentIntentId ?? (ids.chargeId ? `charge:${ids.chargeId}` : null);
  if (!paymentIntentId) {
    return { duplicate: false, granted: false, reason: "ignored_unknown_payment_intent" };
  }
  const credits = Number(grant.delta);
  if (!Number.isSafeInteger(credits) || credits <= 0) throw new LedgerError("invalid_grant");
  const applied = await applyClawback(tx, {
    userId: grant.user_id,
    credits,
    paymentIntentId,
    stripeEventId: event.id,
    note: event.type,
  });
  if (applied.replay) {
    return {
      duplicate: false,
      granted: false,
      reason: "already_clawed_back",
      paused: applied.paused,
    };
  }
  return {
    duplicate: false,
    granted: false,
    reason: "clawed_back",
    clawedBack: applied.clawedBack,
    shortfall: applied.shortfall,
    paused: applied.paused,
  };
}
