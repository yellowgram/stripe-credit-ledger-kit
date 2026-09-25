import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as trackPost } from "../src/app/api/credits/track/route";
import { POST } from "../src/app/api/webhooks/stripe/route";
import { createSqliteDb } from "../src/billing/db";
import { appOrigin, demoControlsEnabled } from "../src/server/ledger";
import { checkoutEvent } from "./helpers";

const secret = `whsec_${Buffer.from("credit-ledger-status-secret").toString("base64")}`;

describe("webhook HTTP status and demo defaults", () => {
  const saved = {
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_EXPECT_LIVEMODE: process.env.STRIPE_EXPECT_LIVEMODE,
    ALLOW_DEMO_CONTROLS: process.env.ALLOW_DEMO_CONTROLS,
    DATABASE_URL: process.env.DATABASE_URL,
    SQLITE_PATH: process.env.SQLITE_PATH,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
  let sqliteFile = "";

  beforeAll(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "credit-ledger-http-"));
    sqliteFile = path.join(dir, "ledger.sqlite");
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    process.env.STRIPE_SECRET_KEY = "sk_test_status";
    delete process.env.STRIPE_EXPECT_LIVEMODE;
    delete process.env.ALLOW_DEMO_CONTROLS;
    delete process.env.DATABASE_URL;
    process.env.SQLITE_PATH = sqliteFile;
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function signed(event: unknown): Request {
    const payload = JSON.stringify(event);
    const stripe = new Stripe("sk_test_status");
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    return new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": header,
        "x-forwarded-host": "evil.example",
      },
      body: payload,
    });
  }

  it("returns 400 for a missing signature, a placeholder secret, and a bad signature", async () => {
    const missing = await POST(
      new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: "{}" }),
    );
    expect(missing.status).toBe(400);

    process.env.STRIPE_WEBHOOK_SECRET = "whsec_replace_me";
    const placeholder = await POST(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=deadbeef" },
        body: "{}",
      }),
    );
    expect(placeholder.status).toBe(400);
    process.env.STRIPE_WEBHOOK_SECRET = secret;

    const bad = await POST(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=deadbeef" },
        body: "{}",
      }),
    );
    expect(bad.status).toBe(400);
  });

  it("returns 500 for a livemode mismatch and an amount mismatch so Stripe retries", async () => {
    const live = await POST(
      signed({
        id: "evt_http_live",
        object: "event",
        type: "checkout.session.completed",
        livemode: true,
        data: { object: { id: "cs_http_live", payment_status: "paid" } },
      }),
    );
    expect(live.status).toBe(500);
    expect(await live.json()).toMatchObject({ error: "livemode_mismatch" });

    const amount = await POST(
      signed(
        checkoutEvent({
          id: "evt_http_amount",
          sessionId: "cs_http_amount",
          amountTotal: 1,
          livemode: false,
        }),
      ),
    );
    expect(amount.status).toBe(500);
    expect(await amount.json()).toMatchObject({ error: "amount_mismatch" });

    const db = createSqliteDb(sqliteFile);
    const count = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM stripe_events`);
    expect(Number(count?.n)).toBe(0);
    await db.close();
  });

  it("requires a client idempotency key on track and keeps demo controls off by default", async () => {
    expect(demoControlsEnabled()).toBe(false);
    process.env.ALLOW_DEMO_CONTROLS = "false";
    expect(demoControlsEnabled()).toBe(false);
    process.env.ALLOW_DEMO_CONTROLS = "true";
    expect(demoControlsEnabled()).toBe(true);
    delete process.env.ALLOW_DEMO_CONTROLS;

    expect(appOrigin()).toBe("https://app.example");

    const missingKey = await trackPost(
      new Request("http://localhost/api/credits/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: 1 }),
      }),
    );
    expect(missingKey.status).toBe(400);
    expect(await missingKey.json()).toMatchObject({ error: "invalid_idempotency_key" });
  });
});
