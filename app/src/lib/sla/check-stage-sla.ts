import { prisma } from "@/lib/db/prisma";
import { computeSlaStatus } from "@/lib/stage-engine/sla-status";
import { sendSlaBreachEmail } from "@/lib/notifications/send-sla-breach-email";

/**
 * Sweeps active clients and notifies on stage-SLA breach. SLA status itself is computed on
 * read (client list/dashboard) via computeSlaStatus — this only handles the notification side,
 * and is idempotent per breach (skips clients that already have an unread breach notification
 * for their current stage).
 */
export async function checkStageSla() {
  const now = new Date();

  const clients = await prisma.client.findMany({
    where: { status: "ACTIVE" },
    include: { currentStage: true, assignedTo: true },
    orderBy: { stageEnteredAt: "asc" },
    take: 200,
  });

  let breached = 0;

  for (const client of clients) {
    const status = computeSlaStatus(client.stageEnteredAt, client.currentStage.slaHours, now);
    if (status !== "OVERDUE") continue;

    const alreadyNotified = await prisma.notification.findFirst({
      where: {
        type: "stage_sla_breach",
        readAt: null,
        payload: { path: ["clientId"], equals: client.id },
      },
    });
    if (alreadyNotified) continue;

    breached += 1;

    if (client.assignedToId) {
      await prisma.notification.create({
        data: {
          organizationId: client.organizationId,
          userId: client.assignedToId,
          type: "stage_sla_breach",
          payload: { clientId: client.id, clientName: client.name, stage: client.currentStage.name },
        },
      });

      if (client.priority === "HIGH" && client.assignedTo?.managerId) {
        await prisma.notification.create({
          data: {
            organizationId: client.organizationId,
            userId: client.assignedTo.managerId,
            type: "stage_sla_breach",
            payload: {
              clientId: client.id,
              clientName: client.name,
              stage: client.currentStage.name,
              assignedToName: client.assignedTo.name,
              escalated: true,
            },
          },
        });
      }

      await sendSlaBreachEmail(client);
    }
  }

  return { breached };
}
