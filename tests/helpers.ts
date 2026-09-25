import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSqliteDb } from "../src/billing/db";
import { ensureSchema } from "../src/billing/schema";
import type { Db } from "../src/billing/types";
import type { StripeEventInput } from "../src/billing/webhook";

export async function tempDb(): Promise<{ db: Db; file: string; cleanup: () => Promise<void> }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "credit-ledger-"));
  const file = path.join(dir, "ledger.sqlite");
  const db = createSqliteDb(file);
  await ensureSchema(db);
  return {
    db,
    file,
    cleanup: async () => {
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Separate OS process so two SQLite connections can race. */
export function runChild<T>(script: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", script], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `${script} exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch {
        reject(new Error(`bad json from ${script}: ${stdout}\n${stderr}`));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export function checkoutEvent(input: {
  id: string;
  type?: string;
  sessionId: string;
  userId?: string;
  credits?: number;
  packId?: string;
  paymentStatus?: string;
}): StripeEventInput {
  return {
    id: input.id,
    type: input.type ?? "checkout.session.completed",
    data: {
      object: {
        id: input.sessionId,
        object: "checkout.session",
        payment_status: input.paymentStatus ?? "paid",
        metadata: {
          userId: input.userId ?? "user_1",
          credits: String(input.credits ?? 100),
          packId: input.packId ?? "pack_100",
        },
      },
    },
  };
}
