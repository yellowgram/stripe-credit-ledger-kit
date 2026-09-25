import { PACKS, getAccount, listEntries } from "@/billing";
import { demoControlsEnabled, demoUserId, getDb, ready, shellApiAllowed } from "@/server/ledger";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!shellApiAllowed(req)) {
    return Response.json({
      userId: null,
      balance: 0,
      paused: false,
      demoControls: false,
      packs: PACKS,
      entries: [],
    });
  }
  try {
    await ready();
    const userId = demoUserId();
    const db = getDb();
    const [account, entries] = await Promise.all([getAccount(db, userId), listEntries(db, userId, 12)]);
    return Response.json({
      userId,
      balance: account.balance,
      paused: account.paused,
      demoControls: demoControlsEnabled(),
      packs: PACKS,
      entries,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
