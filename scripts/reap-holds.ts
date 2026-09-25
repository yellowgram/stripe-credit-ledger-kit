import { config } from "dotenv";

config({ path: ".env" });
config({ path: ".env.local", override: true });

function intervalSeconds(): number {
  const raw = process.env.CREDIT_HOLD_REAP_INTERVAL_SECONDS;
  if (raw === undefined || raw.trim() === "") return 60;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("CREDIT_HOLD_REAP_INTERVAL_SECONDS must be an integer >= 1");
  }
  return parsed;
}

async function main(): Promise<void> {
  const { createDbFromEnv } = await import("../src/billing/db");
  const { reapExpiredHolds } = await import("../src/billing/ledger");
  const { ensureSchema } = await import("../src/billing/schema");

  const db = createDbFromEnv();
  await ensureSchema(db);
  const once = process.argv.includes("--once");
  const waitSeconds = intervalSeconds();

  do {
    const result = await reapExpiredHolds(db);
    console.log(`${new Date().toISOString()} expired=${result.expired}`);
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
  } while (true);

  await db.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
