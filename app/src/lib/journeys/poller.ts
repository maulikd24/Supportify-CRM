import { prisma } from "@/lib/db/prisma";
import { advanceRun } from "@/lib/journeys/engine";

/** Finds journey run steps whose wait has elapsed and resumes their run. */
export async function processDueJourneySteps(): Promise<{ processed: number }> {
  const dueSteps = await prisma.journeyRunStep.findMany({
    where: { status: "pending", scheduledFor: { lte: new Date() } },
    select: { runId: true },
    distinct: ["runId"],
    orderBy: { scheduledFor: "asc" },
    take: 200,
  });

  for (const step of dueSteps) {
    await advanceRun(step.runId);
  }

  return { processed: dueSteps.length };
}
