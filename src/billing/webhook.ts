import type Stripe from "stripe";
import { LedgerError } from "./errors";
import { applyGrant } from "./ledger";
import { getPack } from "./packs";
import type { Db } from "./types";

/**
 * Primary grant path: checkout.session.completed when payment_status is paid.
 * Delayed payment methods: checkout.session.async_payment_succeeded.
 * payment_intent.succeeded is stored and ignored so it cannot double-grant.
 */
const SESSION_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

export type StripeEventInput = {
  id: string;
  type: string;
  data: {
    object?: {
      id?: string;
      object?: string;
      payment_status?: string;
      metadata?: Record<string, string> | null;
    } | null;
  };
};

export type WebhookResult = {
  duplicate: boolean;
  granted: boolean;
  reason?: "duplicate_event" | "ignored_event" | "unpaid" | "session_already_granted";
};

function isoNow(): string {
  return new Date().toISOString();
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

function readGrant(session: NonNullable<StripeEventInput["data"]["object"]>): {
  sessionId: string;
  userId: string;
  packId: string;
  credits: number;
} {
  const sessionId = session.id;
  const metadata = session.metadata ?? {};
  const userId = metadata.userId?.trim();
  const packId = metadata.packId?.trim();
  const credits = Number(metadata.credits);
  if (!sessionId || !userId || !packId || !Number.isSafeInteger(credits) || credits <= 0) {
    throw new LedgerError("invalid_metadata");
  }
  const pack = getPack(packId);
  if (!pack || pack.credits !== credits) {
    throw new LedgerError("pack_mismatch");
  }
  return { sessionId, userId, packId, credits };
}

/**
 * Verify the signature before calling this. Inserts stripe_events.id (unique)
 * and grants in the same transaction. A retry of the same event.id is a no-op.
 * A second event type for the same Checkout Session does not grant again.
 * Throws roll the event insert back so Stripe can retry a transient failure.
 */
export async function handleStripeEvent(db: Db, event: StripeEventInput): Promise<WebhookResult> {
  if (!event?.id || !event?.type || !event.data) {
    throw new LedgerError("invalid_event");
  }

  return db.transaction(async (tx) => {
    const inserted = await tx.get<{ id: string }>(
      `INSERT INTO stripe_events (id, type, received_at)
       VALUES (?, ?, ?)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [event.id, event.type, isoNow()],
    );
    if (!inserted) {
      return { duplicate: true, granted: false, reason: "duplicate_event" };
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
      note: "Stripe Checkout credit pack",
    });
    if (applied.replay) {
      return { duplicate: false, granted: false, reason: "session_already_granted" };
    }
    return { duplicate: false, granted: true };
  });
}
