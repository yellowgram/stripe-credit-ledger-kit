import { timingSafeEqual } from "node:crypto";
import { createDbFromEnv, ensureSchema, reapExpiredHolds, seedDemoUser, type Db } from "@/billing";

const globalStore = globalThis as unknown as {
  __creditLedgerDb?: Db;
  __creditLedgerReady?: Promise<void>;
};

export function demoUserId(): string {
  const configured = process.env.DEMO_USER_ID?.trim();
  return configured || "demo_user";
}

/**
 * Default off. True only for a local walkthrough.
 * Ignored when NODE_ENV=production so `next start` cannot leave spend, reset, or seed open.
 */
export function demoControlsEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.ALLOW_DEMO_CONTROLS === "true";
}

function headerMatchesSecret(configured: string, presented: string | null): boolean {
  if (!presented) return false;
  const left = Buffer.from(configured);
  const right = Buffer.from(presented);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Demo shell gate for checkout, check, and track.
 * Open when the demo flag is on, or when x-ledger-secret matches LEDGER_API_SECRET.
 * The secret does not choose a user. Those routes still use DEMO_USER_ID.
 */
export function shellApiAllowed(req: Request): boolean {
  if (demoControlsEnabled()) return true;
  const configured = process.env.LEDGER_API_SECRET?.trim();
  if (!configured) return false;
  return headerMatchesSecret(configured, req.headers.get("x-ledger-secret")?.trim() ?? null);
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

/** Checkout return URLs. Only an http(s) NEXT_PUBLIC_APP_URL is used. Request headers are ignored. */
export function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured && /^https?:\/\//i.test(configured)) return configured;
  return "http://localhost:3000";
}
