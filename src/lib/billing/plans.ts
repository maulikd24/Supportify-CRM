import type { Product } from "@/generated/prisma/client";

/**
 * Static plan catalog. Real Stripe Products/Prices are created in the Stripe
 * Dashboard (or a one-time setup script) once a Stripe account exists — their
 * IDs are wired in via the env vars named below. Enterprise tiers are
 * "contact us": no self-serve Checkout, no Stripe Price needed yet.
 */

export type PlanTier = {
  id: string;
  name: string;
  priceLabel: string;
  /** QA_SENTINEL plans: reviews allowed per billing period. null = unlimited (enterprise). */
  reviewQuota?: number | null;
  /** CRM plans: purchased seats. null = unlimited (enterprise). */
  seats?: number | null;
  stripePriceEnvVar?: string;
  contactSales?: boolean;
  features: string[];
};

export const QA_SENTINEL_PLANS: PlanTier[] = [
  {
    id: "starter",
    name: "Starter",
    priceLabel: "$49/mo",
    reviewQuota: 100,
    stripePriceEnvVar: "STRIPE_PRICE_QA_STARTER",
    features: ["100 AI reviews/month", "1 Zendesk connection", "DSAT analysis"],
  },
  {
    id: "growth",
    name: "Growth",
    priceLabel: "$149/mo",
    reviewQuota: 500,
    stripePriceEnvVar: "STRIPE_PRICE_QA_GROWTH",
    features: ["500 AI reviews/month", "Unlimited SOPs", "DSAT analysis", "Priority support"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceLabel: "Contact us",
    reviewQuota: null,
    contactSales: true,
    features: ["Unlimited reviews", "SSO (coming soon)", "Dedicated support"],
  },
];

export const CRM_PLANS: PlanTier[] = [
  {
    id: "starter",
    name: "Starter",
    priceLabel: "$29/seat/mo",
    seats: 5,
    stripePriceEnvVar: "STRIPE_PRICE_CRM_STARTER",
    features: ["Up to 5 team members", "Client pipeline & journeys", "Task management"],
  },
  {
    id: "growth",
    name: "Growth",
    priceLabel: "$49/seat/mo",
    seats: 20,
    stripePriceEnvVar: "STRIPE_PRICE_CRM_GROWTH",
    features: ["Up to 20 team members", "Everything in Starter", "Priority support"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceLabel: "Contact us",
    seats: null,
    contactSales: true,
    features: ["Unlimited team members", "SSO (coming soon)", "Dedicated support"],
  },
];

export const PRODUCT_LABELS: Record<Product, string> = {
  QA_SENTINEL: "QA Sentinel",
  CRM: "CRM",
};

export function plansForProduct(product: Product): PlanTier[] {
  return product === "QA_SENTINEL" ? QA_SENTINEL_PLANS : CRM_PLANS;
}

export function planById(product: Product, planId: string): PlanTier | undefined {
  return plansForProduct(product).find((p) => p.id === planId);
}

export function stripePriceIdFor(plan: PlanTier): string | undefined {
  if (!plan.stripePriceEnvVar) return undefined;
  return process.env[plan.stripePriceEnvVar];
}

export const TRIAL_DAYS = 14;
