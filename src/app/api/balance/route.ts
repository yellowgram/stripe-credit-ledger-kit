import { PACKS, getBalance, listEntries } from "@/billing";
import { demoUserId, getDb, ready } from "@/server/ledger";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await ready();
    const userId = demoUserId();
    const db = getDb();
    const [balance, entries] = await Promise.all([getBalance(db, userId), listEntries(db, userId, 12)]);
    return Response.json({ userId, balance, packs: PACKS, entries });
  } catch (error) {
    return errorResponse(error);
  }
}
