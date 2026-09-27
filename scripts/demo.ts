/**
 * Sealed fixture smoke for `npm run demo`.
 *
 * Signs a local checkout.session.completed for pack_100, grants it on the
 * migrated database, then replays that same event id. The signature is
 * checked in-process with a built-in fixture secret. There is no Stripe
 * network call and no card charge.
 *
 * Requires `npm run db:migrate` first. This script does not create tables.
 * `npm run demo:webhook` is the same kind of fixture posted at a running dev server.
 */
import { config } from "dotenv";

config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const FIXTURE_WEBHOOK_SECRET = `whsec_${Buffer.from("stripe-credit-ledger-kit-demo-fixture").toString("base64")}`;

class DemoFail extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoFail";
  }
}

function isMissingSchema(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table/i.test(message) || /relation ["']stripe_events["'] does not exist/i.test(message);
}

async function main(): Promise<void> {
  const Stripe = (await import("stripe")).default;
  const { createDbFromEnv } = await import("../src/billing/db");
  const { getBalance } = await import("../src/billing/ledger");
  const { getPack } = await import("../src/billing/packs");
  const { handleStripeEvent, verifyStripeEvent } = await import("../src/billing/webhook");
  type StripeEventInput = import("../src/billing/webhook").StripeEventInput;

  const pack = getPack("pack_100");
  if (!pack) {
    throw new DemoFail("pack_100 is missing from the catalog");
  }

  const userId = process.env.DEMO_USER_ID?.trim() || "demo_user";
  const db = createDbFromEnv();
  try {
    await db.get(`SELECT id FROM stripe_events LIMIT 1`);

    const stamp = Date.now();
    const eventId = `evt_demo_${stamp}`;
    const sessionId = `cs_demo_${stamp}`;
    const event: StripeEventInput = {
      id: eventId,
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: sessionId,
          object: "checkout.session",
          payment_status: "paid",
          amount_total: pack.amountCents,
          currency: pack.currency,
          payment_intent: `pi_${sessionId}`,
          metadata: {
            userId,
            credits: String(pack.credits),
            packId: pack.id,
          },
        },
      },
    };

    const payload = JSON.stringify(event);
    const stripe = new Stripe("sk_test_signature_only");
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: FIXTURE_WEBHOOK_SECRET,
    });
    const verified = verifyStripeEvent(stripe, payload, signature, FIXTURE_WEBHOOK_SECRET);
    if (verified.id !== eventId || verified.type !== "checkout.session.completed") {
      throw new DemoFail("signed fixture did not verify");
    }

    const fixtureMode = {
      STRIPE_SECRET_KEY: "sk_test_signature_only",
      STRIPE_EXPECT_LIVEMODE: "false",
    };
    const before = await getBalance(db, userId);
    const granted = await handleStripeEvent(db, event, fixtureMode);
    const mid = await getBalance(db, userId);
    const replayed = await handleStripeEvent(db, event, fixtureMode);
    const after = await getBalance(db, userId);

    const grantOk = granted.duplicate === false && granted.granted === true && mid === before + pack.credits;
    const replayOk =
      replayed.duplicate === true &&
      replayed.granted === false &&
      replayed.reason === "duplicate_event" &&
      after === mid;

    if (!grantOk || !replayOk) {
      throw new DemoFail(
        `signed webhook grant + replay ${JSON.stringify({ before, mid, after, granted, replayed })}`,
      );
    }

    console.log("PASS  npm run demo");
    console.log(
      `signed checkout.session.completed ${eventId} granted ${pack.id} (+${pack.credits}) to ${userId}`,
    );
    console.log(`balance ${before} → ${mid}`);
    console.log(`replay ${eventId} duplicate_event; balance stayed ${after}`);
    console.log("Fixture only. No Stripe network. No card charge.");
  } catch (error) {
    if (error instanceof DemoFail) {
      console.error(`FAIL  ${error.message}`);
      process.exitCode = 1;
      return;
    }
    if (isMissingSchema(error)) {
      console.error("FAIL  schema is not migrated. Run npm run db:migrate, then npm run demo.");
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
