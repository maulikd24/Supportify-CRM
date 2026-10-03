import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

/** The helpdesk emails an agent-portal user's reviews are filed under (login email, plus helpdeskEmail if set). */
export async function agentIdentity(userId: string, organizationId: string) {
  const user = await prisma.user.findFirstOrThrow({
    where: { id: userId, organizationId, orgRole: "AGENT" },
    select: { id: true, name: true, email: true, helpdeskEmail: true },
  });
  const emails = [...new Set([user.email, user.helpdeskEmail].filter((e): e is string => Boolean(e)).map((e) => e.toLowerCase()))];
  return { ...user, emails };
}

/** Reviews belonging to these agent emails (case-insensitive). Always combine with organizationId. */
export function agentReviewsWhere(emails: string[]): Prisma.TicketReviewWhereInput {
  return { OR: emails.map((e) => ({ agentEmail: { equals: e, mode: "insensitive" as const } })) };
}
