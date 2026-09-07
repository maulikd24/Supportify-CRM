"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireRole, requireUser } from "@/lib/auth/require-role";
import { validateJourneyGraph } from "@/lib/journeys/schema";
import { enrollClientManually } from "@/lib/journeys/dispatch";
import type { JourneyGraph } from "@/lib/journeys/types";

const EMPTY_GRAPH: JourneyGraph = {
  nodes: [
    {
      id: "trigger-1",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: { triggerType: "client_created" },
    },
  ],
  edges: [],
};

export async function createJourneyAction(name: string) {
  const session = await requireRole(["ADMIN", "MANAGER"]);

  const journey = await prisma.journey.create({
    data: {
      organizationId: session.user.organizationId,
      name: name || "Untitled Journey",
      definition: EMPTY_GRAPH as unknown as object,
      createdById: session.user.id,
    },
  });

  revalidatePath("/journeys");
  redirect(`/journeys/${journey.id}`);
}

export async function saveJourneyGraphAction(journeyId: string, graph: JourneyGraph) {
  const session = await requireRole(["ADMIN", "MANAGER"]);

  const validated = validateJourneyGraph(graph);

  const inFlightRuns = await prisma.journeyRun.count({
    where: { journeyId, status: { in: ["RUNNING", "WAITING"] } },
  });
  if (inFlightRuns > 0) {
    throw new Error(
      `Cannot edit: ${inFlightRuns} client(s) are currently in this journey. Deactivate it first.`,
    );
  }

  await prisma.journey.update({
    where: { id: journeyId, organizationId: session.user.organizationId },
    data: { definition: validated as unknown as object, version: { increment: 1 } },
  });

  revalidatePath(`/journeys/${journeyId}`);
}

export async function setJourneyActiveAction(journeyId: string, isActive: boolean) {
  const session = await requireRole(["ADMIN", "MANAGER"]);

  await prisma.journey.update({
    where: { id: journeyId, organizationId: session.user.organizationId },
    data: { isActive },
  });

  revalidatePath("/journeys");
  revalidatePath(`/journeys/${journeyId}`);
}

export async function deleteJourneyAction(journeyId: string) {
  const session = await requireRole(["ADMIN", "MANAGER"]);

  const journey = await prisma.journey.findUnique({
    where: { id: journeyId, organizationId: session.user.organizationId },
    select: { id: true },
  });
  if (!journey) throw new Error("Journey not found");

  const inFlightRuns = await prisma.journeyRun.count({
    where: { journeyId, status: { in: ["RUNNING", "WAITING"] } },
  });
  if (inFlightRuns > 0) {
    throw new Error(`Cannot delete: ${inFlightRuns} client(s) are currently in this journey.`);
  }

  await prisma.journeyRunStep.deleteMany({ where: { run: { journeyId } } });
  await prisma.journeyRun.deleteMany({ where: { journeyId } });
  await prisma.journey.delete({ where: { id: journeyId, organizationId: session.user.organizationId } });

  revalidatePath("/journeys");
  redirect("/journeys");
}

export async function enrollClientInJourneyAction(journeyId: string, clientId: string) {
  const session = await requireUser();

  const [journey, client] = await Promise.all([
    prisma.journey.findUnique({ where: { id: journeyId, organizationId: session.user.organizationId }, select: { id: true } }),
    prisma.client.findUnique({ where: { id: clientId, organizationId: session.user.organizationId }, select: { id: true } }),
  ]);
  if (!journey || !client) throw new Error("Journey or client not found");

  await enrollClientManually(journeyId, clientId);
  revalidatePath(`/clients/${clientId}`);
}
