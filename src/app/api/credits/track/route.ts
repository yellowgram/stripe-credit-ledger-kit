import { randomUUID } from "node:crypto";
import { track } from "@/billing";
import { errorResponse, positiveInt, readJson } from "@/server/http";
import { demoUserId, getDb, ready } from "@/server/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** At-most-once spend. Pass an idempotencyKey when the client may retry. */
export async function POST(req: Request): Promise<Response> {
  try {
    await ready();
    const body = await readJson(req);
    const amount = positiveInt(body.amount);
    const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim()
      : randomUUID();
    const result = await track(getDb(), { userId: demoUserId(), amount, idempotencyKey });
    return Response.json({ ...result, idempotencyKey }, { status: result.ok ? 200 : 402 });
  } catch (error) {
    return errorResponse(error);
  }
}
