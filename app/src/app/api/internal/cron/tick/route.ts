import { NextResponse } from "next/server";

import { checkOverdueTasks } from "@/lib/sla/check-overdue-tasks";
import { checkStageSla } from "@/lib/sla/check-stage-sla";
import { processDueJourneySteps } from "@/lib/journeys/poller";
import { checkDisengagement } from "@/lib/copilot/check-disengagement";

export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
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
