import Stripe from "stripe";

const globalForStripe = globalThis as unknown as { stripe: Stripe | undefined };

/** Lazily constructed so importing this module doesn't require STRIPE_SECRET_KEY unless billing is actually used. */
export function getStripe(): Stripe {
  if (globalForStripe.stripe) return globalForStripe.stripe;

  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    throw new Error("STRIPE_SECRET_KEY is not set. Add it to your environment to enable billing.");
  }
  const client = new Stripe(apiKey);
  if (process.env.NODE_ENV !== "production") globalForStripe.stripe = client;
  return client;
}
