import { prisma } from "@/lib/db/prisma";
import { getHelpdeskProvider, helpdeskProviderOption, isHelpdeskProvider, type HelpdeskProviderOption } from "@/lib/qa/helpdesks";

export type HelpdeskSummary = HelpdeskProviderOption & { accountLabel: string; isValid: boolean; lastCheckedAt: Date | null };

/** The org's connected helpdesk, as plain data pages can pass to client components (no credentials). */
export async function getHelpdeskSummary(organizationId: string): Promise<HelpdeskSummary | null> {
  const connection = await prisma.helpdeskConnection.findUnique({
    where: { organizationId },
    select: { provider: true, accountLabel: true, isValid: true, lastCheckedAt: true },
  });
  if (!connection || !isHelpdeskProvider(connection.provider)) return null;
  return { ...helpdeskProviderOption(getHelpdeskProvider(connection.provider)), accountLabel: connection.accountLabel, isValid: connection.isValid, lastCheckedAt: connection.lastCheckedAt };
}
