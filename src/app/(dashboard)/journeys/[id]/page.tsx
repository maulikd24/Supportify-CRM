import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { JourneyCanvasLoader } from "@/components/journey-builder/journey-canvas-loader";
import type { JourneyGraph } from "@/lib/journeys/types";

export default async function JourneyBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const { id } = await params;

  const [journey, users, templates] = await Promise.all([
    prisma.journey.findUnique({
      where: { id, organizationId: session.user.organizationId },
      include: { _count: { select: { runs: { where: { status: { in: ["RUNNING", "WAITING"] } } } } } },
    }),
    prisma.user.findMany({
      where: { organizationId: session.user.organizationId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.messageTemplate.findMany({
      where: { organizationId: session.user.organizationId, approved: true },
      select: { id: true, name: true, channel: true },
    }),
  ]);
  if (!journey) notFound();

  const inFlightCount = journey._count.runs;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold">{journey.name}</h1>
        <p className="text-sm text-muted-foreground">
          Version {journey.version} · {inFlightCount} lead(s) currently in this journey
        </p>
      </div>
      <JourneyCanvasLoader
        journeyId={journey.id}
        initialGraph={journey.definition as unknown as JourneyGraph}
        isActive={journey.isActive}
        canEdit={inFlightCount === 0}
        users={users}
        templates={templates}
      />
    </div>
  );
}
