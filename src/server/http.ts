import { LedgerError } from "@/billing";

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LedgerError("invalid_json");
  }
  return parsed as Record<string, unknown>;
}

export function errorResponse(error: unknown): Response {
  if (error instanceof LedgerError) {
    return Response.json({ error: error.code }, { status: 400 });
  }
  if (error instanceof SyntaxError) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (isStripeError(error)) {
    const detail = process.env.NODE_ENV !== "production" ? error.message : undefined;
    return Response.json({ error: "stripe_error", detail }, { status: 502 });
  }
  console.error(error);
  const detail = process.env.NODE_ENV !== "production" && error instanceof Error ? error.message : undefined;
  return Response.json({ error: "internal_error", detail }, { status: 500 });
}

function isStripeError(error: unknown): error is { message: string; type: string } {
  if (!error || typeof error !== "object" || !("type" in error) || !("message" in error)) {
    return false;
  }
  const type = (error as { type: unknown }).type;
  const message = (error as { message: unknown }).message;
  return typeof type === "string" && type.startsWith("Stripe") && typeof message === "string";
}

export function positiveInt(value: unknown, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new LedgerError("amount_must_be_positive_integer");
  }
  return parsed;
}
