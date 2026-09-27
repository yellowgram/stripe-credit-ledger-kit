import { resetDemoUser } from "@/demo/reset";
import { LedgerError } from "@/billing";
import { errorResponse, readJson } from "@/server/http";
import { demoControlsEnabled, demoUserId, getDb, ready } from "@/server/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    if (!demoControlsEnabled()) {
      return Response.json({ error: "demo_controls_disabled" }, { status: 404 });
    }
    await ready();
    const body = await readJson(req);
    const target = body.target === undefined ? 100 : body.target;
    if (typeof target !== "number" || !Number.isSafeInteger(target) || target < 0) {
      throw new LedgerError("invalid_target");
    }
    const result = await resetDemoUser(getDb(), demoUserId(), target);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
