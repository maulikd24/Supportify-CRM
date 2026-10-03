import { prisma } from "@/lib/db/prisma";

/** QA plans that include the "QA depth" features: custom scorecards, coaching and disputes. */
const GROWTH_PLANS = ["growth", "scale", "enterprise"];

export const QA_GROWTH_UPSELL = "available on Growth plans and above. Upgrade in Billing to use it.";

/** True on Growth, Scale and Enterprise (active or in the past-due grace period), and during a live trial. */
export async function qaGrowthFeaturesAvailable(organizationId: string): Promise<boolean> {
  const sub = await prisma.productSubscription.findUnique({
    where: { organizationId_product: { organizationId, product: "QA_SENTINEL" } },
    select: { status: true, planId: true, trialEndsAt: true },
  });
  if (!sub) return false;
  if (sub.status === "TRIALING") return Boolean(sub.trialEndsAt && sub.trialEndsAt > new Date());
  return (sub.status === "ACTIVE" || sub.status === "PAST_DUE") && sub.planId != null && GROWTH_PLANS.includes(sub.planId);
}
