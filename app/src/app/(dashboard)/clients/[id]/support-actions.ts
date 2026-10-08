"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireCrmRole } from "@/lib/auth/require-role";
import { recordAudit } from "@/lib/audit/record";
import { UserError, withUserErrors } from "@/lib/actions/user-error";
import { setRequesterClient } from "@/lib/support-health/link";
import { evaluateSupportRisk, supportHealthAvailable } from "@/lib/support-health/health";

/** Admin-only, both products active, and the client must be in the admin's own org. */
async function guard(clientId: string) {
  const session = await requireCrmRole(["ADMIN"]);
  const organizationId = session.user.organizationId;
  if (!(await supportHealthAvailable(organizationId))) throw new UserError("Support experience needs both CRM and QA Sentinel.");
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId }, select: { id: true } });
  if (!client) throw new UserError("Client not found");
  return session;
}

async function recheck(organizationId: string, clientIds: string[]) {
  for (const id of clientIds) await evaluateSupportRisk(organizationId, id);
}

/** Links a reviewed ticket's customer (and so all their tickets, past and future) to this client. */
export const linkTicketToClientAction = withUserErrors(async function linkTicketToClientAction(clientId: string, ticketInput: string) {
  const session = await guard(clientId);
  const organizationId = session.user.organizationId;
  const ticketId = z.string().trim().min(1, "Enter a ticket ID").max(64).parse(ticketInput).replace(/^#/, "");

  const review = await prisma.ticketReview.findFirst({
    where: { organizationId, ticketId },
    orderBy: { createdAt: "desc" },
    select: { id: true, requesterEmail: true, requesterPhone: true },
  });
  if (!review) throw new UserError(`No QA review found for ticket ${ticketId}. Review it in QA Sentinel first.`);

  let affected: string[];
  if (review.requesterEmail || review.requesterPhone) {
    affected = await setRequesterClient(session.user, { email: review.requesterEmail, phone: review.requesterPhone }, clientId);
  } else {
    // The helpdesk didn't say who the customer was: link just this ticket.
    const before = await prisma.ticketReview.findUniqueOrThrow({ where: { id: review.id }, select: { clientId: true } });
    await prisma.ticketReview.update({ where: { id: review.id }, data: { clientId, clientLinkedBy: "manual" } });
    affected = [...new Set([clientId, ...(before.clientId ? [before.clientId] : [])])];
  }
  await recordAudit({
    organizationId,
    userId: session.user.id,
    entity: "Client",
    entityId: clientId,
    action: "qa.requester_linked",
    newValue: { ticketId, email: review.requesterEmail, phone: review.requesterPhone },
  });
  await recheck(organizationId, affected);
  revalidatePath(`/clients/${clientId}`);
});

const identitySchema = z.object({ email: z.string().nullable(), phone: z.string().nullable() });

/** Unlinks one requester from this client; their tickets won't be matched to any client again. */
export const unlinkRequesterAction = withUserErrors(async function unlinkRequesterAction(clientId: string, input: z.input<typeof identitySchema>) {
  const session = await guard(clientId);
  const organizationId = session.user.organizationId;
  const identity = identitySchema.parse(input);
  if (!identity.email && !identity.phone) throw new UserError("Nothing to unlink");

  // Only a requester actually linked to this client can be unlinked from it.
  const linked = await prisma.ticketReview.count({
    where: {
      organizationId,
      clientId,
      OR: [...(identity.email ? [{ requesterEmail: identity.email }] : []), ...(identity.phone ? [{ requesterPhone: identity.phone }] : [])],
    },
  });
  if (linked === 0) throw new UserError("That requester isn't linked to this client.");

  const affected = await setRequesterClient(session.user, identity, null);
  await recordAudit({
    organizationId,
    userId: session.user.id,
    entity: "Client",
    entityId: clientId,
    action: "qa.requester_unlinked",
    oldValue: identity,
  });
  await recheck(organizationId, affected);
  revalidatePath(`/clients/${clientId}`);
});
