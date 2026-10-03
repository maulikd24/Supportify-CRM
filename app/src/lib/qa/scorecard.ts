import { prisma } from "@/lib/db/prisma";
import { qaGrowthFeaturesAvailable } from "@/lib/qa/plan-features";
import { DEFAULT_SCORECARD, parseCriteria, type ResolvedScorecard } from "@/lib/qa/scorecard-criteria";

export * from "@/lib/qa/scorecard-criteria";

/** Custom scorecards are a Growth-and-above feature (plus live trials). */
export const customScorecardsAvailable = qaGrowthFeaturesAvailable;

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

