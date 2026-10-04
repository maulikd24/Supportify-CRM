import { prisma } from "@/lib/db/prisma";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { UserError } from "@/lib/actions/user-error";
import type { Prisma, Role } from "@/generated/prisma/client";

/**
 * Who may see and act on which clients *within* an org — the same rule the client
 * pages apply when rendering (clients/page.tsx, clients/[id]/page.tsx):
 * ADMIN sees every client; MANAGER sees their own and their direct reports'; RM and
 * DEALER see only their own. An unassigned client is visible to ADMINs only.
 *
 * Server actions are callable directly, so every action that takes a client, task or
 * document id must go through these too — page-level visibility alone doesn't stop an
 * RM from editing, reassigning or messaging another RM's client by id.
 */

type Actor = { id: string; role: Role; organizationId: string };

/** Where-clause limiting a client query to what `actor` may see (always org-scoped). */
export async function visibleClientsWhere(actor: Actor): Promise<Prisma.ClientWhereInput> {
  const visibleUserIds = await getVisibleUserIds(actor.id, actor.role, actor.organizationId);
  return visibleUserIds
    ? { organizationId: actor.organizationId, assignedToId: { in: visibleUserIds } }
    : { organizationId: actor.organizationId };
}

/** Throws "Client not found" unless `actor` may act on the client — the same answer as a missing one, so ids can't be probed. */
export async function requireClientAccess(actor: Actor, clientId: string): Promise<void> {
  const client = await prisma.client.findFirst({ where: { id: clientId, ...(await visibleClientsWhere(actor)) }, select: { id: true } });
  if (!client) throw new UserError("Client not found");
}

/** Access to a document follows access to its client. */
export async function requireDocumentAccess(actor: Actor, documentId: string): Promise<void> {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, organizationId: actor.organizationId },
    select: { clientId: true },
  });
  if (!doc) throw new UserError("Document not found");
  await requireClientAccess(actor, doc.clientId).catch(() => {
    throw new UserError("Document not found");
  });
}
