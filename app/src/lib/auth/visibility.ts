import { prisma } from "@/lib/db/prisma";
import type { Role } from "@/generated/prisma/client";

/**
 * Returns the set of user IDs whose leads/tasks a given user is allowed to see.
 * `null` means "no restriction *within the org*" — every call site must still
 * apply its own organizationId filter on top of this; this function alone is
 * not a tenant boundary.
 */
export async function getVisibleUserIds(userId: string, role: Role, organizationId: string): Promise<string[] | null> {
  if (role === "ADMIN") return null;
  if (role === "RM") return [userId];
  if (role === "DEALER") return [userId]; // no dealer-client linkage yet — safest, most restrictive default

  // MANAGER: self + direct reports. Intentionally not filtered by isActive — a
  // manager must keep seeing a removed report's existing clients/tasks, not lose them.
  const reports = await prisma.user.findMany({
    where: { managerId: userId, organizationId },
    select: { id: true },
  });
  return [userId, ...reports.map((r) => r.id)];
}
