import { createDbFromEnv, ensureSchema, seedDemoUser, type Db } from "@/billing";

const globalStore = globalThis as unknown as {
  __creditLedgerDb?: Db;
  __creditLedgerReady?: Promise<void>;
};

export function demoUserId(): string {
  const configured = process.env.DEMO_USER_ID?.trim();
  return configured || "demo_user";
}

export function demoControlsEnabled(): boolean {
  return process.env.ALLOW_DEMO_CONTROLS !== "false";
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
      await seedDemoUser(db, userId, 100);
    })().catch((error: unknown) => {
      globalStore.__creditLedgerReady = undefined;
      throw error;
    });
  }
  return globalStore.__creditLedgerReady;
}

export function appOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : "http://localhost:3000";
}
