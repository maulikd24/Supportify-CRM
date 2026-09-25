import { prisma } from "@/lib/db/prisma";

const DISENGAGEMENT_THRESHOLD_DAYS = 5;
const CANDIDATE_LIMIT = 200;

/** Flags ACTIVE clients with no recent Activity/Message as disengaged, notifying their RM once per breach. */
export async function checkDisengagement(): Promise<{ flagged: number }> {
  const now = new Date();
  const threshold = new Date(now.getTime() - DISENGAGEMENT_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);

  const clients = await prisma.client.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, organizationId: true, name: true, assignedToId: true, createdAt: true },
    orderBy: { stageEnteredAt: "asc" },
    take: CANDIDATE_LIMIT,
  });

  if (clients.length === 0) return { flagged: 0 };

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

  for (const client of clients) {
    if (!client.assignedToId) continue;

    const candidates = [lastActivityByClient.get(client.id), lastMessageByClient.get(client.id), client.createdAt].filter(
      (d): d is Date => d !== undefined,
    );
    const lastContact = candidates.reduce((latest, current) => (current > latest ? current : latest), client.createdAt);

    if (lastContact >= threshold) continue;

    const alreadyNotified = await prisma.notification.findFirst({
      where: {
        userId: client.assignedToId,
        type: "client_disengaged",
        readAt: null,
        payload: { path: ["clientId"], equals: client.id },
      },
    });
    if (alreadyNotified) continue;

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
  }

  return { flagged };
}
