import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as checkoutPost } from "../src/app/api/checkout/route";
import { POST as checkPost } from "../src/app/api/credits/check/route";
import { POST as trackPost } from "../src/app/api/credits/track/route";

describe("demo shell gates checkout, check, and track", () => {
  const saved = {
    ALLOW_DEMO_CONTROLS: process.env.ALLOW_DEMO_CONTROLS,
    LEDGER_API_SECRET: process.env.LEDGER_API_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    SQLITE_PATH: process.env.SQLITE_PATH,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  };

  beforeAll(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "credit-ledger-gates-"));
    delete process.env.ALLOW_DEMO_CONTROLS;
    delete process.env.LEDGER_API_SECRET;
    delete process.env.DATABASE_URL;
    process.env.SQLITE_PATH = path.join(dir, "ledger.sqlite");
    process.env.STRIPE_SECRET_KEY = "sk_test_replace_me";
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function post(url: string, body: unknown, secret?: string): Request {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (secret) headers["x-ledger-secret"] = secret;
    return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
  }

  it("returns 404 when demo controls are off and no server secret is set", async () => {
    const checkout = await checkoutPost(post("http://localhost/api/checkout", { packId: "pack_100" }));
    const check = await checkPost(post("http://localhost/api/credits/check", { amount: 1 }));
    const track = await trackPost(
      post("http://localhost/api/credits/track", { amount: 1, idempotencyKey: "k1" }),
    );
    expect(checkout.status).toBe(404);
    expect(check.status).toBe(404);
    expect(track.status).toBe(404);
    expect(await checkout.json()).toMatchObject({ error: "demo_controls_disabled" });
  });

  it("allows the same routes with the server secret header", async () => {
    process.env.LEDGER_API_SECRET = "shell-secret";
    const checkout = await checkoutPost(
      post("http://localhost/api/checkout", { packId: "pack_100" }, "shell-secret"),
    );
    const check = await checkPost(post("http://localhost/api/credits/check", { amount: 1 }, "shell-secret"));
    const track = await trackPost(post("http://localhost/api/credits/track", { amount: 1 }, "shell-secret"));
    expect(checkout.status).not.toBe(404);
    expect(check.status).toBe(200);
    expect(track.status).toBe(400);
    expect(await track.json()).toMatchObject({ error: "invalid_idempotency_key" });

    const wrong = await checkoutPost(post("http://localhost/api/checkout", { packId: "pack_100" }, "nope"));
    expect(wrong.status).toBe(404);
    delete process.env.LEDGER_API_SECRET;
  });

  it("allows the routes when demo controls are on", async () => {
    process.env.ALLOW_DEMO_CONTROLS = "true";
    const checkout = await checkoutPost(post("http://localhost/api/checkout", { packId: "pack_100" }));
    expect(checkout.status).not.toBe(404);
    delete process.env.ALLOW_DEMO_CONTROLS;
  });
});
