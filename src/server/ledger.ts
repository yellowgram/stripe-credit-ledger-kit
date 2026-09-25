import { createDbFromEnv, ensureSchema, reapExpiredHolds, seedDemoUser, type Db } from "@/billing";

const globalStore = globalThis as unknown as {
  __creditLedgerDb?: Db;
  __creditLedgerReady?: Promise<void>;
};

export function demoUserId(): string {
  const configured = process.env.DEMO_USER_ID?.trim();
  return configured || "demo_user";
}

/** Default off. Set ALLOW_DEMO_CONTROLS=true only for a local walkthrough. */
export function demoControlsEnabled(): boolean {
  return process.env.ALLOW_DEMO_CONTROLS === "true";
}

export function getDb(): Db {
  if (!globalStore.__creditLedgerDb) {
    globalStore.__creditLedgerDb = createDbFromEnv();
  }
  return globalStore.__creditLedgerDb;
}

export function ready(): Promise<void> {
  if (!globalStore.__creditLedgerReady) {
    const db = getDb();
    const userId = demoUserId();
    globalStore.__creditLedgerReady = (async () => {
      await ensureSchema(db);
      await reapExpiredHolds(db);
      if (demoControlsEnabled()) {
        await seedDemoUser(db, userId, 100);
      }
    })().catch((error: unknown) => {
      globalStore.__creditLedgerReady = undefined;
      throw error;
    });
  }
  return globalStore.__creditLedgerReady;
}

/** Checkout return URLs. Request headers are ignored so a proxy cannot redirect the buyer. */
export function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  return configured || "http://localhost:3000";
}
