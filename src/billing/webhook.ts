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
 * charge.refunded and charge.dispute.created claw back the full grant
 * (min of balance and grant size). A shortfall pauses the user.
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
    | "already_clawed_back";
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

function readGrant(session: NonNullable<StripeEventInput["data"]["object"]>): {
  sessionId: string;
  userId: string;
  packId: string;
  credits: number;
  paymentIntentId: string | null;
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
  };
}

/**
 * Verify the signature before calling this.
 * Signature problems are the caller's 400. Throws here are retryable (HTTP 500):
 * the stripe_events insert rolls back with the transaction.
 * livemode is checked before any insert so a wrong key does not burn the event id.
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

    const grant = readGrant(session);
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
      livemode: live,
      note: "Stripe Checkout credit pack",
    });
    if (applied.replay) {
      return { duplicate: false, granted: false, reason: "session_already_granted" };
    }
    return { duplicate: false, granted: true };
  });
}

async function clawbackEvent(tx: Executor, event: StripeEventInput): Promise<WebhookResult> {
  const paymentIntentId = paymentIntentIdOf(event.data.object?.payment_intent);
  if (!paymentIntentId) throw new LedgerError("grant_not_found");
  const grant = await tx.get<{ user_id: string; delta: unknown }>(
    `SELECT user_id, delta FROM credit_ledger_entries
     WHERE payment_intent_id = ? AND kind = 'grant'`,
    [paymentIntentId],
  );
  if (!grant) throw new LedgerError("grant_not_found");
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
