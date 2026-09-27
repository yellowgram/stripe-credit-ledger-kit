import { config } from "dotenv";

config({ path: ".env" });
config({ path: ".env.local", override: true });

async function main(): Promise<void> {
  const { createDbFromEnv } = await import("../src/billing/db");
  const { migrate } = await import("../src/billing/schema");
  const { seedDemoUser } = await import("../src/billing/ledger");

  const db = createDbFromEnv();
  const userId = process.env.DEMO_USER_ID?.trim() || "demo_user";

  const applied = await migrate(db);
  if (applied.length > 0) {
    console.log(`Applied ${applied.join(", ")}.`);
  }
  if (process.env.ALLOW_DEMO_CONTROLS === "true") {
    await seedDemoUser(db, userId, 100);
    console.log(`Schema ready. Demo user "${userId}" seeded with 100 credits if this was the first boot.`);
  } else {
    console.log("Schema ready. Demo seed skipped (set ALLOW_DEMO_CONTROLS=true for the local walkthrough).");
  }
  await db.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
