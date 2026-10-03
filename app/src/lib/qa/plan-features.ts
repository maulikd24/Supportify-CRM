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

/** Agent-portal logins included per QA plan (null = unlimited). Trials get a handful to try it. */
export const AGENT_SEATS: Record<string, number | null> = { growth: 25, scale: 100, enterprise: null };
export const TRIAL_AGENT_SEATS = 5;

/** How many agent-portal logins the org may have active, or null for unlimited. 0 when the plan has no portal. */
export async function agentSeatLimit(organizationId: string): Promise<number | null> {
  const sub = await prisma.productSubscription.findUnique({
    where: { organizationId_product: { organizationId, product: "QA_SENTINEL" } },
    select: { status: true, planId: true },
  });
  if (!sub || !(await qaGrowthFeaturesAvailable(organizationId))) return 0;
  if (sub.status === "TRIALING") return TRIAL_AGENT_SEATS;
  return sub.planId != null && sub.planId in AGENT_SEATS ? AGENT_SEATS[sub.planId] : 0;
}
