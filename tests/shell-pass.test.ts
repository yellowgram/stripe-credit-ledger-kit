import { afterEach, describe, expect, it } from "vitest";
import { GET as balanceGet } from "../src/app/api/balance/route";
import { appOrigin, demoControlsEnabled } from "../src/server/ledger";

describe("demo shell production lock", () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    ALLOW_DEMO_CONTROLS: process.env.ALLOW_DEMO_CONTROLS,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    LEDGER_API_SECRET: process.env.LEDGER_API_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else Object.assign(process.env, { [key]: value });
    }
  });

  it("ignores the demo flag in production and hides ledger rows", async () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.ALLOW_DEMO_CONTROLS = "true";
    delete process.env.LEDGER_API_SECRET;
    delete process.env.DATABASE_URL;
    expect(demoControlsEnabled()).toBe(false);

    const response = await balanceGet(new Request("http://localhost/api/balance"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ balance: 0, demoControls: false, entries: [], userId: null });
    expect(body.packs).toHaveLength(3);
  });

  it("uses only an http(s) app origin", () => {
    process.env.NEXT_PUBLIC_APP_URL = "javascript:alert(1)";
    expect(appOrigin()).toBe("http://localhost:3000");
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example/base/";
    expect(appOrigin()).toBe("https://app.example/base");
  });
});
