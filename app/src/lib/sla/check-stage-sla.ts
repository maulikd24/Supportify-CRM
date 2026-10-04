import { prisma } from "@/lib/db/prisma";
import { sendSlaBreachEmail } from "@/lib/notifications/send-sla-breach-email";

const BATCH_SIZE = 200;

/**
 * Sweeps active clients and notifies on stage-SLA breach. SLA status itself is computed on
 * read (client list/dashboard) via computeSlaStatus — this only handles the notification side.
 *
 * Alerts exactly once per stay in a stage: the claim below stamps slaBreachNotifiedAt, and a
 * client only qualifies again once it has entered a new stage (stamp older than stageEnteredAt).
 * The claim is a single UPDATE … FOR UPDATE SKIP LOCKED, so overlapping runs never alert twice,
 * and it selects only clients still owed an alert, so a backlog of already-alerted breaches can't
 * crowd newer ones out of the batch.
 */
export async function checkStageSla() {
  // Timestamps are stored as UTC `timestamp without time zone`, hence `now() AT TIME ZONE 'UTC'`.
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Client" SET "slaBreachNotifiedAt" = now() AT TIME ZONE 'UTC'
    WHERE id IN (
      SELECT c.id FROM "Client" c
      JOIN "Stage" s ON s.id = c."currentStageId"
      WHERE c.status = 'ACTIVE'
        AND s."slaHours" > 0
        AND c."stageEnteredAt" <= (now() AT TIME ZONE 'UTC') - make_interval(hours => s."slaHours")
        AND (c."slaBreachNotifiedAt" IS NULL OR c."slaBreachNotifiedAt" < c."stageEnteredAt")
      ORDER BY c."stageEnteredAt" ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE OF c SKIP LOCKED
    )
    RETURNING id`;
  if (claimed.length === 0) return { breached: 0 };

  const clients = await prisma.client.findMany({
    where: { id: { in: claimed.map((c) => c.id) } },
    include: { currentStage: true, assignedTo: true },
  });

  for (const client of clients) {
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

  return { breached: clients.length };
}
