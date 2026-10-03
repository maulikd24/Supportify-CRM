import { prisma } from "@/lib/db/prisma";

/** Agents this org has reviewed (helpdesk email + latest known name), alphabetically. */
export async function reviewedAgents(organizationId: string): Promise<{ email: string; name: string }[]> {
  const rows = await prisma.ticketReview.findMany({
    where: { organizationId, agentEmail: { not: null } },
    distinct: ["agentEmail"],
    orderBy: [{ agentEmail: "asc" }, { createdAt: "desc" }],
    select: { agentEmail: true, agentName: true },
    take: 1000,
  });
  return rows
    .map((r) => ({ email: (r.agentEmail as string).toLowerCase(), name: r.agentName || (r.agentEmail as string) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
