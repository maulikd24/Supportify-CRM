import { prisma } from "@/lib/db/prisma";
import { DEFAULT_RETENTION_MONTHS } from "@/lib/cx/settings-shared";

const FINISHED_JOB_DAYS = 30;

/**
 * Deletes conversations older than each org's retention period (CxCostSettings.retentionMonths,
 * default 13) by when they started, plus finished import jobs older than 30 days. Runs from
 * the cron tick; safe to run often and concurrently (plain deletes).
 */
export async function purgeExpiredConversations(): Promise<{ conversations: number; jobs: number }> {
  // Timestamps are stored as UTC `timestamp without time zone`, hence `now() AT TIME ZONE 'UTC'`.
  const conversations = await prisma.$executeRaw`
    DELETE FROM "Conversation" c
    USING "Organization" o
    LEFT JOIN "CxCostSettings" s ON s."organizationId" = o.id
    WHERE c."organizationId" = o.id
      AND c."startedAt" < (now() AT TIME ZONE 'UTC') - make_interval(months => COALESCE(s."retentionMonths", ${DEFAULT_RETENTION_MONTHS}))`;
  const jobs = await prisma.$executeRaw`
    DELETE FROM "CxIngestJob"
    WHERE status IN ('DONE', 'FAILED')
      AND "processedAt" < (now() AT TIME ZONE 'UTC') - make_interval(days => ${FINISHED_JOB_DAYS})`;
  return { conversations, jobs };
}
