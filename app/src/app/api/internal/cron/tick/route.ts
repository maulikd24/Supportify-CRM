import { NextResponse } from "next/server";

import { isAuthorizedCron } from "@/lib/cron/auth";
import { checkOverdueTasks } from "@/lib/sla/check-overdue-tasks";
import { checkStageSla } from "@/lib/sla/check-stage-sla";
import { processDueJourneySteps } from "@/lib/journeys/poller";
import { checkDisengagement } from "@/lib/copilot/check-disengagement";
import { cleanupRateLimits } from "@/lib/security/rate-limit";
import { resetMonthlyUsageForAnnualPlans } from "@/lib/billing/usage-reset";
import { purgeExpiredConversations } from "@/lib/cx/ingest/retention";
import { kickCxWorker } from "@/lib/cx/ingest/trigger";

export const maxDuration = 60;

/**
 * Runs every few minutes (GitHub Actions, see .github/workflows/cron-tick.yml) plus a daily
 * Vercel cron backstop. Every job here must be safe to run that often and concurrently with
 * itself — each claims its own work atomically.
 */
const JOBS = {
  taskSla: checkOverdueTasks,
  stageSla: checkStageSla,
  journeys: processDueJourneySteps,
  disengagement: checkDisengagement,
  rateLimitBucketsDeleted: cleanupRateLimits,
  annualUsageResets: resetMonthlyUsageForAnnualPlans,
  cxRetention: purgeExpiredConversations,
  // CX imports run in their own self-chaining worker, never inside this tick.
  cxWorker: kickCxWorker,
} satisfies Record<string, () => Promise<unknown>>;

async function tick(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Run every job even if an earlier one throws, so one failure can't stall journeys or SLA alerts.
  const results: Record<string, unknown> = {};
  const failed: string[] = [];
  for (const [name, job] of Object.entries(JOBS)) {
    try {
      results[name] = await job();
    } catch (error) {
      failed.push(name);
      results[name] = { error: error instanceof Error ? error.message : "failed" };
      console.error(`Cron job ${name} failed`, error);
    }
  }

  // A 500 makes the scheduler's run fail visibly instead of hiding a broken job.
  return NextResponse.json({ ok: failed.length === 0, failed, ...results }, { status: failed.length ? 500 : 200 });
}

/** Vercel Cron calls GET; external schedulers may still POST. */
export const GET = tick;
export const POST = tick;
