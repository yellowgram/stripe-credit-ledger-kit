import { config } from "dotenv";

config({ path: ".env" });
config({ path: ".env.local", override: true });

async function main(): Promise<void> {
  const { createDbFromEnv } = await import("../src/billing/db");
  const { ensureSchema } = await import("../src/billing/schema");
  const { seedDemoUser } = await import("../src/billing/ledger");

  const db = createDbFromEnv();
  const userId = process.env.DEMO_USER_ID?.trim() || "demo_user";

  await ensureSchema(db);
  await seedDemoUser(db, userId, 100);
  console.log(`Schema ready. Demo user "${userId}" has a starting balance if this was the first boot.`);
  await db.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
