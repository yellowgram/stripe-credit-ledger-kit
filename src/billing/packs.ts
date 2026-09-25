export type CreditPack = {
  id: string;
  name: string;
  credits: number;
  /** Stripe unit_amount in the smallest currency unit (cents for usd). */
  amountCents: number;
  currency: "usd";
  description: string;
};

/**
 * One-time Checkout packs. Edit prices and sizes here.
 * The webhook grants `credits` only when metadata.packId matches one of these
 * and metadata.credits equals that pack's credit count.
 */
export const PACKS: readonly CreditPack[] = [
  {
    id: "pack_100",
    name: "Starter",
    credits: 100,
    amountCents: 500,
    currency: "usd",
    description: "100 credits",
  },
  {
    id: "pack_500",
    name: "Builder",
    credits: 500,
    amountCents: 2000,
    currency: "usd",
    description: "500 credits",
  },
  {
    id: "pack_2000",
    name: "Studio",
    credits: 2000,
    amountCents: 6000,
    currency: "usd",
    description: "2,000 credits",
  },
];

export function getPack(packId: string): CreditPack | undefined {
  return PACKS.find((pack) => pack.id === packId);
}

/** Metadata written onto the Checkout Session and its PaymentIntent. */
export function creditPackMetadata(userId: string, pack: CreditPack): {
  userId: string;
  credits: string;
  packId: string;
} {
  return {
    userId,
    credits: String(pack.credits),
    packId: pack.id,
  };
}
