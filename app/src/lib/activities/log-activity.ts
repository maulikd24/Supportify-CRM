import { prisma } from "@/lib/db/prisma";
import type { ActivityType, Prisma } from "@/generated/prisma/client";

export async function logActivity(params: {
  clientId: string;
  userId?: string | null;
  type: ActivityType;
  payload: Prisma.InputJsonValue;
}) {
  // Derive organizationId from the client itself rather than trusting a
  // caller-supplied value — the client row is the single source of truth for
  // which tenant this activity belongs to.
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: params.clientId },
    select: { organizationId: true },
  });
  return prisma.activity.create({
    data: {
      organizationId: client.organizationId,
      clientId: params.clientId,
      userId: params.userId ?? null,
      type: params.type,
      payload: params.payload,
    },
  });
}
