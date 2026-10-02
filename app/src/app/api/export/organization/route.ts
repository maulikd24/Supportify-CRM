import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { recordAudit } from "@/lib/audit/record";

export async function GET() {
  const session = await requireRole(["ADMIN"]);
  const organizationId = session.user.organizationId;

  const [organization, clients, tasks, activities, journeys, sopDocuments, ticketReviews, dsatAnalyses] =
    await Promise.all([
      prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { name: true, slug: true, createdAt: true },
      }),
      prisma.client.findMany({
        where: { organizationId },
        include: { currentStage: true, documents: true, stageHistory: true },
      }),
      prisma.task.findMany({ where: { organizationId } }),
      prisma.activity.findMany({ where: { organizationId } }),
      prisma.journey.findMany({ where: { organizationId } }),
      prisma.sopDocument.findMany({ where: { organizationId } }),
      prisma.ticketReview.findMany({ where: { organizationId } }),
      prisma.dsatAnalysis.findMany({ where: { organizationId } }),
    ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    organization,
    crm: { clients, tasks, activities, journeys },
    qaSentinel: { sopDocuments, ticketReviews, dsatAnalyses },
  };

  await recordAudit({ organizationId, userId: session.user.id, entity: "Organization", entityId: organizationId, action: "data.export_organization" });
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="supportify-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
