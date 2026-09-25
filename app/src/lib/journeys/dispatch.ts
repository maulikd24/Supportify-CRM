import { prisma } from "@/lib/db/prisma";
import { advanceRun } from "@/lib/journeys/engine";
import type { JourneyGraph, TriggerNodeData, TriggerType } from "@/lib/journeys/types";

async function enroll(journeyId: string, clientId: string) {
  const existing = await prisma.journeyRun.findFirst({
    where: { journeyId, clientId, status: { in: ["RUNNING", "WAITING"] } },
  });
  if (existing) return existing;

  const journey = await prisma.journey.findUniqueOrThrow({
    where: { id: journeyId },
    select: { organizationId: true },
  });

  return prisma.journeyRun.create({
    data: { organizationId: journey.organizationId, journeyId, clientId, status: "RUNNING", currentNodeId: null },
  });
}

/** Finds active journeys whose trigger matches this event and enrolls the client, then runs each to its first pause point. */
export async function onEvent(triggerType: TriggerType, clientId: string): Promise<void> {
  // Derive organizationId from the client itself — journeys must never fire across tenants.
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { organizationId: true } });
  const journeys = await prisma.journey.findMany({ where: { organizationId: client.organizationId, isActive: true } });

  for (const journey of journeys) {
    const graph = journey.definition as unknown as JourneyGraph;
    const matches = graph.nodes.some(
      (n) => n.type === "trigger" && (n.data as TriggerNodeData).triggerType === triggerType,
    );
    if (!matches) continue;

    const run = await enroll(journey.id, clientId);
    if (run.currentNodeId === null && run.status === "RUNNING") {
      await advanceRun(run.id);
    }
  }
}

/** Manually enrolls a single client into a specific journey (used by the "Add to journey" UI action). */
export async function enrollClientManually(journeyId: string, clientId: string): Promise<void> {
  const run = await enroll(journeyId, clientId);
  await advanceRun(run.id);
}
