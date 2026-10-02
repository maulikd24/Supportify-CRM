import { prisma } from "@/lib/db/prisma";
import { getStripe } from "@/lib/billing/stripe";
import { QA_OVERAGE, TRIAL_LIMITS, qaOverageConfig } from "@/lib/billing/plans";
import type { ProductSubscription } from "@/generated/prisma/client";

export type ReviewSlot =
  | { ok: true; overage: boolean }
  | { ok: false; code: "no_subscription" | "quota" | "overage_cap"; reason: string };

type OverageFields = Pick<ProductSubscription, "status" | "stripeSubscriptionId" | "allowOverage">;

/**
 * Whether this subscription *could* bill overages, and if not, why — shown in
 * QA Settings next to the overage toggle. Trials never go into overage.
 */
export function overageAvailability(sub: OverageFields | null): { available: boolean; reason?: string } {
  if (!sub) return { available: false, reason: "QA Sentinel isn't active for your organization." };
  if (sub.status !== "ACTIVE" || !sub.stripeSubscriptionId) {
    return { available: false, reason: "Overages are available on paid plans. Subscribe in Billing to turn them on." };
  }
  if (!qaOverageConfig()) {
    return { available: false, reason: "Overage billing isn't set up yet. Contact support to enable it." };
  }
  return { available: true };
}

function quotaReason(sub: Pick<ProductSubscription, "status" | "reviewQuota">): string {
  if (sub.status === "TRIALING") {
    return `Your trial includes ${sub.reviewQuota ?? TRIAL_LIMITS.reviewQuota} AI reviews. Subscribe in Billing to keep reviewing.`;
  }
  return `You've used all ${sub.reviewQuota} reviews included in your plan this period. Turn on overages (${QA_OVERAGE.priceLabel}/review) in QA Settings, or upgrade in Billing.`;
}

/**
 * Atomically reserves one review against the plan quota, falling back to an
 * opt-in overage slot when the quota is used up. Conditional updates make it
 * race-safe between the background worker and people running manual reviews.
 * Call releaseReviewSlot() if the review then fails.
 */
export async function claimReviewSlot(organizationId: string): Promise<ReviewSlot> {
  const sub = await prisma.productSubscription.findUnique({
    where: { organizationId_product: { organizationId, product: "QA_SENTINEL" } },
  });
  if (!sub) return { ok: false, code: "no_subscription", reason: "QA Sentinel isn't active for your organization." };

  if (sub.reviewQuota == null) {
    await prisma.productSubscription.update({ where: { id: sub.id }, data: { reviewsUsedThisPeriod: { increment: 1 } } });
    return { ok: true, overage: false };
  }

  const included = await prisma.productSubscription.updateMany({
    where: { id: sub.id, reviewsUsedThisPeriod: { lt: sub.reviewQuota } },
    data: { reviewsUsedThisPeriod: { increment: 1 } },
  });
  if (included.count === 1) return { ok: true, overage: false };

  if (!sub.allowOverage || !overageAvailability(sub).available) {
    return { ok: false, code: "quota", reason: quotaReason(sub) };
  }

  const overage = await prisma.productSubscription.updateMany({
    where: {
      id: sub.id,
      allowOverage: true,
      ...(sub.overageCap != null ? { overageReviewsThisPeriod: { lt: sub.overageCap } } : {}),
    },
    data: { overageReviewsThisPeriod: { increment: 1 } },
  });
  if (overage.count === 1) return { ok: true, overage: true };

  return {
    ok: false,
    code: "overage_cap",
    reason: `You've reached your overage cap of ${sub.overageCap} reviews this period. Raise it in QA Settings.`,
  };
}

/** Gives back a slot claimed for a review that then failed. */
export async function releaseReviewSlot(organizationId: string, overage: boolean): Promise<void> {
  const field = overage ? "overageReviewsThisPeriod" : "reviewsUsedThisPeriod";
  await prisma.productSubscription.updateMany({
    where: { organizationId, product: "QA_SENTINEL", [field]: { gt: 0 } },
    data: { [field]: { decrement: 1 } },
  });
}

/**
 * Reports one overage review to the Stripe Billing Meter. Best-effort: the
 * review is already stored and counted; a reporting failure is logged so it
 * can be reconciled, never surfaced to the customer.
 */
export async function reportOverageReview(organizationId: string, reviewId: string): Promise<void> {
  const config = qaOverageConfig();
  if (!config) return;
  try {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { stripeCustomerId: true },
    });
    if (!org.stripeCustomerId) throw new Error("Organization has no Stripe customer");
    await getStripe().billing.meterEvents.create({
      event_name: config.meterEventName,
      // Idempotent per review, so a retry can never double-bill.
      identifier: `qa-review-${reviewId}`,
      payload: { stripe_customer_id: org.stripeCustomerId, value: "1" },
    });
  } catch (error) {
    console.error("Failed to report QA overage review to Stripe", { organizationId, reviewId, error });
  }
}

/**
 * Ensures the metered overage price is on the org's QA subscription, so meter
 * usage shows up on its invoices. Needed for subscriptions created before
 * overage billing existed.
 */
export async function ensureOverageSubscriptionItem(stripeSubscriptionId: string): Promise<void> {
  const config = qaOverageConfig();
  if (!config) return;
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  if (subscription.items.data.some((item) => item.price.id === config.priceId)) return;
  await stripe.subscriptionItems.create({ subscription: stripeSubscriptionId, price: config.priceId });
}
