import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * Daily totals per dimension, rebuilt from the conversations themselves for each touched day
 * (UTC), so re-analysing a conversation never double-counts. Volume counts every conversation;
 * the other sums only analysed ones (their counts say how many contributed).
 */

const NEGATIVE_BELOW = -0.3;
const HIGH_RISK_FROM = 0.6;

const DIMENSIONS: Record<string, { key: Prisma.Sql; join: Prisma.Sql; where: Prisma.Sql }> = {
  all: { key: Prisma.sql`''`, join: Prisma.empty, where: Prisma.empty },
  topic: { key: Prisma.sql`ct."topicId"`, join: Prisma.sql`JOIN "ConversationTopic" ct ON ct."conversationId" = c.id`, where: Prisma.empty },
  channel: { key: Prisma.sql`COALESCE(c.channel, 'unknown')`, join: Prisma.empty, where: Prisma.empty },
  source: { key: Prisma.sql`c."sourceType"::text`, join: Prisma.empty, where: Prisma.empty },
  team: { key: Prisma.sql`c."teamId"`, join: Prisma.empty, where: Prisma.sql`AND c."teamId" IS NOT NULL` },
};

export async function recomputeDays(organizationId: string, days: string[]): Promise<void> {
  for (const day of new Set(days)) {
    const start = new Date(`${day}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) continue;
    const end = new Date(start.getTime() + 86_400_000);
    await prisma.$transaction([
      prisma.cxMetricBucket.deleteMany({ where: { organizationId, day: start } }),
      ...Object.entries(DIMENSIONS).map(([name, d]) =>
        prisma.$executeRaw`
          INSERT INTO "CxMetricBucket" ("organizationId", day, dimension, "dimensionId", conversations,
            "sentimentSum", "sentimentCount", "negativeCount", "ratingSum", "ratingCount",
            "predictedCsatSum", "predictedCsatCount", "highRiskCount", "deflectableCount", "handleTimeSum", "handleTimeCount")
          SELECT ${organizationId}, ${start}::date, ${name}, ${d.key}, count(*),
            COALESCE(sum(a.sentiment), 0), count(a.sentiment), count(*) FILTER (WHERE a.sentiment < ${NEGATIVE_BELOW}),
            COALESCE(sum(c.rating) FILTER (WHERE c."ratingScale" IN ('csat_5', 'stars_5')), 0),
            count(c.rating) FILTER (WHERE c."ratingScale" IN ('csat_5', 'stars_5')),
            COALESCE(sum(a."predictedCsat"), 0), count(a."predictedCsat"),
            count(*) FILTER (WHERE a."churnRisk" >= ${HIGH_RISK_FROM} OR a."escalationRisk" >= ${HIGH_RISK_FROM}),
            count(*) FILTER (WHERE a.deflectable),
            COALESCE(sum(c."handleTimeSec"), 0), count(c."handleTimeSec")
          FROM "Conversation" c
          LEFT JOIN "ConversationAnalysis" a ON a."conversationId" = c.id
          ${d.join}
          WHERE c."organizationId" = ${organizationId} AND c."startedAt" >= ${start} AND c."startedAt" < ${end} ${d.where}
          GROUP BY 4
          HAVING count(*) > 0`,
      ),
    ]);
  }
}
