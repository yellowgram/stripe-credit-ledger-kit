import { runLastCreditRace } from "@/demo/reset";
import { errorResponse, positiveInt, readJson } from "@/server/http";
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
    const amount = positiveInt(body.amount, 10);
    const result = await runLastCreditRace(getDb(), demoUserId(), amount);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
