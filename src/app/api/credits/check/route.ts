import { check } from "@/billing";
import { errorResponse, positiveInt, readJson } from "@/server/http";
import { demoUserId, getDb, ready, shellApiAllowed } from "@/server/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Advisory. A 200 with ok:false still means "do not call the model". */
export async function POST(req: Request): Promise<Response> {
  try {
    if (!shellApiAllowed(req)) {
      return Response.json({ error: "demo_controls_disabled" }, { status: 404 });
    }
    await ready();
    const body = await readJson(req);
    const amount = positiveInt(body.amount);
    const result = await check(getDb(), demoUserId(), amount);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
