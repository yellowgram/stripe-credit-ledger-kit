import { PACKS, getAccount, listEntries } from "@/billing";
import { demoControlsEnabled, demoUserId, getDb, ready } from "@/server/ledger";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
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
