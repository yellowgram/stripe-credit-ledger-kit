import { randomUUID } from "node:crypto";
import { finalize, release, reserve } from "../billing/ledger";
import type { Db } from "../billing/types";

export type DemoCallResult = {
  ok: boolean;
  replay?: boolean;
  error?: string;
  balance: number;
  idempotencyKey: string;
  output: string | null;
  detail?: string;
};

/**
 * Demo stand-in for an LLM call.
 * Reserves credits, then either finalizes (bill the reserved amount) or
 * releases the full reservation when the provider fails. No model is called.
 */
export async function runDemoGeneration(
  db: Db,
  input: { userId: string; credits: number; fail?: boolean; idempotencyKey?: string },
): Promise<DemoCallResult> {
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  const reserved = await reserve(db, {
    userId: input.userId,
    amount: input.credits,
    idempotencyKey,
  });
  if (!reserved.ok) {
    return {
      ok: false,
      error: reserved.error,
      balance: reserved.balance,
      idempotencyKey,
      output: null,
    };
  }

  try {
    if (input.fail) {
      throw new Error("provider_500");
    }
    const done = await finalize(db, input.userId, idempotencyKey);
    if (!done.ok) {
      const released = await release(db, input.userId, idempotencyKey);
      return {
        ok: false,
        error: done.error,
        balance: released.balance,
        idempotencyKey,
        output: null,
      };
    }
    return {
      ok: true,
      replay: false,
      balance: done.balance,
      idempotencyKey,
      output: "Demo completion. No model was called — this shell only proves the ledger.",
    };
  } catch (error) {
    const released = await release(db, input.userId, idempotencyKey);
    return {
      ok: false,
      error: "llm_failed_credits_released",
      balance: released.ok ? released.balance : 0,
      idempotencyKey,
      output: null,
      detail: error instanceof Error ? error.message : "provider_failed",
    };
  }
}
