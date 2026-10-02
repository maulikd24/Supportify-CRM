import { prisma } from "@/lib/db/prisma";
import { DEFAULT_SCORECARD, parseCriteria, type ResolvedScorecard } from "@/lib/qa/scorecard-criteria";

export * from "@/lib/qa/scorecard-criteria";

/** Plans that include custom scorecards (plus live trials). */
const SCORECARD_PLANS = ["growth", "scale", "enterprise"];

export async function customScorecardsAvailable(organizationId: string): Promise<boolean> {
  const sub = await prisma.productSubscription.findUnique({
    where: { organizationId_product: { organizationId, product: "QA_SENTINEL" } },
    select: { status: true, planId: true, trialEndsAt: true },
  });
  if (!sub) return false;
  if (sub.status === "TRIALING") return Boolean(sub.trialEndsAt && sub.trialEndsAt > new Date());
  return (sub.status === "ACTIVE" || sub.status === "PAST_DUE") && sub.planId != null && SCORECARD_PLANS.includes(sub.planId);
}

/**
 * The scorecard a review should use: the requested one, else the org's default,
 * else the built-in one. Orgs without custom-scorecard access always get the built-in.
 */
export async function resolveScorecard(organizationId: string, scorecardId?: string | null): Promise<ResolvedScorecard> {
  if (!(await customScorecardsAvailable(organizationId))) return DEFAULT_SCORECARD;
  const row =
    (scorecardId ? await prisma.scorecard.findFirst({ where: { id: scorecardId, organizationId } }) : null) ??
    (await prisma.scorecard.findFirst({ where: { organizationId, isDefault: true } }));
  const criteria = row ? parseCriteria(row.criteria) : null;
  return row && criteria ? { id: row.id, name: row.name, criteria } : DEFAULT_SCORECARD;
}

