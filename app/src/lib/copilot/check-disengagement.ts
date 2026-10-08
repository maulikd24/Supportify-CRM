import { prisma } from "@/lib/db/prisma";
import { routeAlerts } from "@/lib/alerts/route";
import type { Alert } from "@/lib/alerts/types";

const DISENGAGEMENT_THRESHOLD_DAYS = 5;
const CANDIDATE_LIMIT = 200;

/**
 * Flags ACTIVE clients with no recent Activity/Message as disengaged, notifying their RM once per
 * quiet spell: the claim stamps disengagedNotifiedAt, and a client only qualifies again after some
 * Activity/Message newer than that stamp (i.e. after contact resumed and then lapsed again).
 * The claim is one UPDATE … FOR UPDATE SKIP LOCKED, so overlapping runs never alert twice, and it
 * only selects clients still owed an alert, so already-alerted ones can't crowd out newer ones.
 */
export async function checkDisengagement(): Promise<{ flagged: number }> {
  const now = new Date();

  // Timestamps are stored as UTC `timestamp without time zone`, hence `now() AT TIME ZONE 'UTC'`.
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    WITH t AS (SELECT (now() AT TIME ZONE 'UTC') - make_interval(days => ${DISENGAGEMENT_THRESHOLD_DAYS}) AS threshold)
    UPDATE "Client" SET "disengagedNotifiedAt" = now() AT TIME ZONE 'UTC'
    WHERE id IN (
      SELECT c.id FROM "Client" c, t
      WHERE c.status = 'ACTIVE'
        AND c."assignedToId" IS NOT NULL
        AND c."createdAt" < t.threshold
        AND NOT EXISTS (SELECT 1 FROM "Activity" a WHERE a."clientId" = c.id AND a."createdAt" >= t.threshold)
        AND NOT EXISTS (SELECT 1 FROM "Message" m WHERE m."clientId" = c.id AND m."createdAt" >= t.threshold)
        AND (
          c."disengagedNotifiedAt" IS NULL
          OR EXISTS (SELECT 1 FROM "Activity" a WHERE a."clientId" = c.id AND a."createdAt" > c."disengagedNotifiedAt")
          OR EXISTS (SELECT 1 FROM "Message" m WHERE m."clientId" = c.id AND m."createdAt" > c."disengagedNotifiedAt")
        )
      ORDER BY c."createdAt" ASC
      LIMIT ${CANDIDATE_LIMIT}
      FOR UPDATE OF c SKIP LOCKED
    )
    RETURNING id`;
  if (claimed.length === 0) return { flagged: 0 };

  const clients = await prisma.client.findMany({
    where: { id: { in: claimed.map((c) => c.id) } },
    select: {
      id: true,
      organizationId: true,
      name: true,
      assignedToId: true,
      createdAt: true,
      currentStage: { select: { name: true } },
      assignedTo: { select: { name: true } },
    },
  });

  const clientIds = clients.map((c) => c.id);

  const [lastActivities, lastMessages] = await Promise.all([
    prisma.activity.findMany({
      where: { clientId: { in: clientIds } },
      orderBy: [{ clientId: "asc" }, { createdAt: "desc" }],
      distinct: ["clientId"],
      select: { clientId: true, createdAt: true },
    }),
    prisma.message.findMany({
      where: { clientId: { in: clientIds } },
      orderBy: [{ clientId: "asc" }, { createdAt: "desc" }],
      distinct: ["clientId"],
      select: { clientId: true, createdAt: true },
    }),
  ]);

  const lastActivityByClient = new Map(lastActivities.map((a) => [a.clientId, a.createdAt]));
  const lastMessageByClient = new Map(lastMessages.map((m) => [m.clientId, m.createdAt]));

  let flagged = 0;
  const alerts: Alert[] = [];

  for (const client of clients) {
    if (!client.assignedToId) continue;

    const candidates = [lastActivityByClient.get(client.id), lastMessageByClient.get(client.id), client.createdAt].filter(
      (d): d is Date => d !== undefined,
    );
    const lastContact = candidates.reduce((latest, current) => (current > latest ? current : latest), client.createdAt);

    const daysSinceLastActivity = Math.floor((now.getTime() - lastContact.getTime()) / (1000 * 60 * 60 * 24));

    await prisma.notification.create({
      data: {
        organizationId: client.organizationId,
        userId: client.assignedToId,
        type: "client_disengaged",
        payload: { clientId: client.id, clientName: client.name, daysSinceLastActivity },
      },
    });
    flagged += 1;
    alerts.push({
      organizationId: client.organizationId,
      type: "client_disengaged",
      clientId: client.id,
      clientName: client.name,
      stage: client.currentStage.name,
      daysQuiet: daysSinceLastActivity,
      assignedToName: client.assignedTo?.name ?? null,
    });
  }

  await routeAlerts(alerts);
  return { flagged };
}
