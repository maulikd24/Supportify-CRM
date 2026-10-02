import { NextResponse } from "next/server";

import { isAuthorizedCron } from "@/lib/cron/auth";
import { checkOverdueTasks } from "@/lib/sla/check-overdue-tasks";
import { checkStageSla } from "@/lib/sla/check-stage-sla";
import { processDueJourneySteps } from "@/lib/journeys/poller";
import { checkDisengagement } from "@/lib/copilot/check-disengagement";

export const maxDuration = 60;

async function tick(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const taskSlaResult = await checkOverdueTasks();
  const stageSlaResult = await checkStageSla();
  const journeyResult = await processDueJourneySteps();
  const disengagementResult = await checkDisengagement();

  return NextResponse.json({
    ok: true,
    taskSla: taskSlaResult,
    stageSla: stageSlaResult,
    journeys: journeyResult,
    disengagement: disengagementResult,
  });
}

/** Vercel Cron calls GET; external schedulers may still POST. */
export const GET = tick;
export const POST = tick;
