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
 * One-time Checkout packs. Edit sizes here.
 * Changing price (amountCents) or currency requires a new packId.
 * Do not change price or currency on an existing packId in place.
 * The webhook grants pack.credits when metadata.packId matches one of these,
 * session.amount_total equals amountCents, and currency matches.
 * The catalog plus amount_total and currency are the grant authority.
 * A mismatch rolls the grant back. metadata.credits is not authority.
 * This file does not store a frozen pack snapshot.
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
