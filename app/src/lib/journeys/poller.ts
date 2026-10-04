import { prisma } from "@/lib/db/prisma";
import { advanceRun } from "@/lib/journeys/engine";

const BATCH_SIZE = 200;
const LEASE_MINUTES = 10;

/**
 * Finds journey run steps whose wait has elapsed and resumes their run.
 *
 * Due steps are claimed with a lease: one UPDATE … FOR UPDATE SKIP LOCKED pushes their
 * scheduledFor LEASE_MINUTES ahead, so an overlapping run (or a retry of this one) can't
 * pick up the same step and send the same message twice. advanceRun then marks the step
 * done or reschedules it as usual; if this process dies first, the lease simply expires
 * and the step is retried.
 */
export async function processDueJourneySteps(): Promise<{ processed: number; failed: number }> {
  // Timestamps are stored as UTC `timestamp without time zone`, hence `now() AT TIME ZONE 'UTC'`.
  const claimed = await prisma.$queryRaw<{ runId: string }[]>`
    UPDATE "JourneyRunStep"
    SET "scheduledFor" = (now() AT TIME ZONE 'UTC') + make_interval(mins => ${LEASE_MINUTES})
    WHERE id IN (
      SELECT id FROM "JourneyRunStep"
      WHERE status = 'pending' AND "scheduledFor" <= now() AT TIME ZONE 'UTC'
      ORDER BY "scheduledFor" ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "runId"`;

  const runIds = [...new Set(claimed.map((step) => step.runId))];
  let failed = 0;
  for (const runId of runIds) {
    // One broken journey must not stop every other run (or the rest of the cron tick).
    try {
      await advanceRun(runId);
    } catch (error) {
      failed += 1;
      console.error("Journey run failed to advance", { runId, error });
    }
  }

  return { processed: runIds.length, failed };
}
