import { prisma } from "@/lib/db/prisma";

export class QuotaExceededError extends Error {}

/**
 * Atomically claims one QA review from the org's period quota *before* the
 * (paid) LLM call runs. A read-then-increment would let concurrent single and
 * bulk reviews all pass the check and overshoot the quota; a conditional
 * UPDATE is re-evaluated under Postgres's row lock, so only claims that still
 * fit succeed. Call releaseReview() if the review then fails.
 */
export async function reserveReview(organizationId: string): Promise<void> {
  const subscription = await prisma.productSubscription.findUnique({
    where: { organizationId_product: { organizationId, product: "QA_SENTINEL" } },
    select: { id: true, reviewQuota: true },
  });
  if (!subscription) throw new QuotaExceededError("This organization has no QA Sentinel subscription.");

  const { reviewQuota } = subscription;
  const { count } = await prisma.productSubscription.updateMany({
    where: {
      id: subscription.id,
      reviewQuota, // null = unlimited (enterprise); also fails safe if the quota changed mid-flight
      ...(reviewQuota != null ? { reviewsUsedThisPeriod: { lt: reviewQuota } } : {}),
    },
    data: { reviewsUsedThisPeriod: { increment: 1 } },
  });

  if (count === 0) {
    throw new QuotaExceededError(
      `You've used all ${reviewQuota} reviews included in your plan this period. Upgrade in Billing to run more.`,
    );
  }
}

/** Refunds a reservation made by reserveReview() when the review itself failed. */
export async function releaseReview(organizationId: string): Promise<void> {
  await prisma.productSubscription.updateMany({
    where: { organizationId, product: "QA_SENTINEL", reviewsUsedThisPeriod: { gt: 0 } },
    data: { reviewsUsedThisPeriod: { decrement: 1 } },
  });
}
