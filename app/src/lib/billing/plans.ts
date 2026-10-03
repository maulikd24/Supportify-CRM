import type { Product } from "@/generated/prisma/client";

/**
 * Static plan catalog. Real Stripe Products/Prices are created in the Stripe
 * Dashboard (or a one-time setup script) once a Stripe account exists — their
 * IDs are wired in via the env vars named below. Enterprise tiers are
 * "contact us": no self-serve Checkout, no Stripe Price needed yet.
 */

export type BillingInterval = "month" | "year";

export type PlanTier = {
  id: string;
  name: string;
  /** Monthly price label, e.g. "$49/mo" or "$29/seat/mo". */
  priceLabel: string;
  /** Annual price label (10× monthly — two months free). */
  annualPriceLabel?: string;
  /** QA_SENTINEL plans: reviews allowed per month. null = unlimited (enterprise). */
  reviewQuota?: number | null;
  /** CRM plans: maximum seats. null = unlimited (enterprise). */
  seats?: number | null;
  stripePriceEnvVar?: string;
  /** Stripe Price for annual billing; the annual option only appears once it's set. */
  stripeAnnualPriceEnvVar?: string;
  contactSales?: boolean;
  /** Highlighted as the recommended plan. */
  featured?: boolean;
  features: string[];
};

export const QA_SENTINEL_PLANS: PlanTier[] = [
  {
    id: "starter",
    name: "Starter",
    priceLabel: "$49/mo",
    annualPriceLabel: "$490/yr",
    reviewQuota: 100,
    stripePriceEnvVar: "STRIPE_PRICE_QA_STARTER",
    stripeAnnualPriceEnvVar: "STRIPE_PRICE_QA_STARTER_ANNUAL",
    features: ["100 AI reviews/month", "Auto-review of solved tickets", "DSAT analysis", "Works with Zendesk, Freshdesk, Intercom + 8 more"],
  },
  {
    id: "growth",
    name: "Growth",
    priceLabel: "$149/mo",
    annualPriceLabel: "$1,490/yr",
    reviewQuota: 500,
    stripePriceEnvVar: "STRIPE_PRICE_QA_GROWTH",
    stripeAnnualPriceEnvVar: "STRIPE_PRICE_QA_GROWTH_ANNUAL",
    featured: true,
    features: ["500 AI reviews/month", "Everything in Starter", "Custom scorecards", "Coaching & score disputes", "Agent portal for 25 agents", "Priority support"],
  },
  {
    id: "scale",
    name: "Scale",
    priceLabel: "$399/mo",
    annualPriceLabel: "$3,990/yr",
    reviewQuota: 2000,
    stripePriceEnvVar: "STRIPE_PRICE_QA_SCALE",
    stripeAnnualPriceEnvVar: "STRIPE_PRICE_QA_SCALE_ANNUAL",
    features: ["2,000 AI reviews/month", "Everything in Growth", "Agent portal for 100 agents", "Lowest price per review", "Priority support"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceLabel: "Contact us",
    reviewQuota: null,
    contactSales: true,
    features: ["Unlimited reviews", "SSO (SAML)", "Custom terms & invoicing", "Dedicated support"],
  },
];

export const CRM_PLANS: PlanTier[] = [
  {
    id: "starter",
    name: "Starter",
    priceLabel: "$29/seat/mo",
    annualPriceLabel: "$290/seat/yr",
    seats: 5,
    stripePriceEnvVar: "STRIPE_PRICE_CRM_STARTER",
    stripeAnnualPriceEnvVar: "STRIPE_PRICE_CRM_STARTER_ANNUAL",
    features: ["Up to 5 team members", "Client pipeline & journeys", "Task management"],
  },
  {
    id: "growth",
    name: "Growth",
    priceLabel: "$49/seat/mo",
    annualPriceLabel: "$490/seat/yr",
    seats: 20,
    stripePriceEnvVar: "STRIPE_PRICE_CRM_GROWTH",
    stripeAnnualPriceEnvVar: "STRIPE_PRICE_CRM_GROWTH_ANNUAL",
    featured: true,
    features: ["Up to 20 team members", "Everything in Starter", "Priority support"],
  },
  {
    id: "scale",
    name: "Scale",
    priceLabel: "$69/seat/mo",
    annualPriceLabel: "$690/seat/yr",
    seats: 50,
    stripePriceEnvVar: "STRIPE_PRICE_CRM_SCALE",
    stripeAnnualPriceEnvVar: "STRIPE_PRICE_CRM_SCALE_ANNUAL",
    features: ["Up to 50 team members", "Everything in Growth", "Priority support"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceLabel: "Contact us",
    seats: null,
    contactSales: true,
    features: ["Unlimited team members", "SSO (SAML)", "Custom terms & invoicing", "Dedicated support"],
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

export function stripePriceIdFor(plan: PlanTier, interval: BillingInterval = "month"): string | undefined {
  const envVar = interval === "year" ? plan.stripeAnnualPriceEnvVar : plan.stripePriceEnvVar;
  return envVar ? process.env[envVar] : undefined;
}

/** Annual billing is offered for a product only once every self-serve plan has an annual Stripe price. */
export function annualBillingAvailable(product: Product): boolean {
  return plansForProduct(product)
    .filter((p) => !p.contactSales)
    .every((p) => Boolean(stripePriceIdFor(p, "year")));
}

export const TRIAL_DAYS = 14;

/**
 * QA Sentinel usage-based overage: reviews beyond the plan quota, billed per review
 * through a Stripe Billing Meter. Opt-in per org (allowOverage + optional cap).
 * Requires a Stripe meter (event name below) and a metered Price attached to it.
 */
export const QA_OVERAGE = {
  priceLabel: "$0.25",
  meterEventEnvVar: "STRIPE_METER_EVENT_QA_REVIEW",
  stripePriceEnvVar: "STRIPE_PRICE_QA_OVERAGE",
} as const;

export function qaOverageConfig(): { meterEventName: string; priceId: string } | null {
  const meterEventName = process.env[QA_OVERAGE.meterEventEnvVar];
  const priceId = process.env[QA_OVERAGE.stripePriceEnvVar];
  return meterEventName && priceId ? { meterEventName, priceId } : null;
}

/** Days a PAST_DUE subscription keeps access while the customer fixes payment. */
export const PAST_DUE_GRACE_DAYS = 7;

/** Limits applied to free trials, so a trial can't run unlimited AI reviews or seats. */
export const TRIAL_LIMITS = { reviewQuota: 50, seats: 3 } as const;

export type PlanLimits = { seats?: number | null; reviewQuota?: number | null };

/** The limit columns a ProductSubscription should carry for a trial of `product`. */
export function trialLimitsFor(product: Product): PlanLimits {
  return product === "CRM" ? { seats: TRIAL_LIMITS.seats } : { reviewQuota: TRIAL_LIMITS.reviewQuota };
}

/**
 * The limit columns for a self-serve plan. Returns {} for unknown or
 * contact-sales plans so limits set by staff in /admin are left untouched.
 */
export function limitsForPlan(product: Product, planId: string | null | undefined): PlanLimits {
  const plan = planId ? planById(product, planId) : undefined;
  if (!plan || plan.contactSales) return {};
  return product === "CRM" ? { seats: plan.seats ?? null } : { reviewQuota: plan.reviewQuota ?? null };
}
