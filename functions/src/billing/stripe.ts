import Stripe from "stripe";

import { STRIPE_SECRET_KEY } from "../config.js";

let cachedClient: Stripe | null = null;
let cachedKey: string | null = null;

export function stripeClient(): Stripe {
  const key = STRIPE_SECRET_KEY.value();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured.");
  if (!cachedClient || cachedKey !== key) {
    cachedClient = new Stripe(key, {
      maxNetworkRetries: 2,
      telemetry: false,
    });
    cachedKey = key;
  }
  return cachedClient;
}

export function stripeObjectId(
  value: string | { id?: string | null } | null | undefined,
): string | null {
  if (typeof value === "string") return value;
  return typeof value?.id === "string" ? value.id : null;
}
