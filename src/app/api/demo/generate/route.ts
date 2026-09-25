import { runDemoGeneration } from "@/demo/llm";
import { errorResponse, positiveInt, readJson } from "@/server/http";
import { demoUserId, getDb, ready } from "@/server/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin demo of reserve → fake LLM → finalize | release.
 * Replace this route with your product. Do not deploy it without auth.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    await ready();
    const body = await readJson(req);
    const credits = positiveInt(body.credits, 10);
    const fail = body.fail === true;
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;
    const result = await runDemoGeneration(getDb(), {
      userId: demoUserId(),
      credits,
      fail,
      idempotencyKey,
    });
    const status = result.ok ? 200 : result.error === "insufficient_credits" ? 402 : 502;
    return Response.json(result, { status });
  } catch (error) {
    return errorResponse(error);
  }
}
