import { prisma } from "@/lib/db/prisma";

/**
 * Annual plans are billed once a year but their review and AI-draft quotas are monthly, and
 * Stripe only signals a new period yearly. This resets usage a month after each
 * annual subscription's usage period started. Runs from the daily cron.
 */
export async function resetMonthlyUsageForAnnualPlans(now = new Date()): Promise<number> {
  const monthAgo = new Date(now);
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  const { count } = await prisma.productSubscription.updateMany({
    where: {
      billingInterval: "year",
      OR: [{ usagePeriodStart: null }, { usagePeriodStart: { lte: monthAgo } }],
    },
    data: { reviewsUsedThisPeriod: 0, overageReviewsThisPeriod: 0, aiDraftsUsedThisPeriod: 0, usagePeriodStart: now },
  });
  return count;
}
