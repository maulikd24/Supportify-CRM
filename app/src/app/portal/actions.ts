"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireAgent } from "@/lib/auth/require-role";
import { recordAudit } from "@/lib/audit/record";
import { UserError, withUserErrors } from "@/lib/actions/user-error";
import { qaGrowthFeaturesAvailable } from "@/lib/qa/plan-features";
import { raiseDispute, type raiseDisputeSchema } from "@/lib/qa/disputes";
import { agentIdentity, agentReviewsWhere } from "@/lib/qa/portal";

async function requirePortal() {
  const session = await requireAgent();
  const { organizationId } = session.user;
  if (!(await qaGrowthFeaturesAvailable(organizationId))) throw new UserError("The agent portal isn't available on your organization's plan");
  return { session, organizationId, agent: await agentIdentity(session.user.id, organizationId) };
}

/** Agents dispute scores on their own reviews only. */
export const raiseMyDisputeAction = withUserErrors(async function raiseMyDisputeAction(reviewId: string, input: z.input<typeof raiseDisputeSchema>) {
  const { organizationId, agent } = await requirePortal();
  const result = await raiseDispute({ organizationId, user: agent, reviewId, input, reviewWhere: agentReviewsWhere(agent.emails) });
  revalidatePath(`/portal/reviews/${reviewId}`);
  revalidatePath("/portal");
  return result;
});

const acknowledgeSchema = z.object({
  agentResponse: z.string().trim().min(1, "Add a short response for your coach").max(4000, "Keep your response under 4,000 characters"),
});

export const acknowledgeCoachingAction = withUserErrors(async function acknowledgeCoachingAction(id: string, input: z.input<typeof acknowledgeSchema>) {
  const { organizationId, agent } = await requirePortal();
  const parsed = acknowledgeSchema.parse(input);

  const coaching = await prisma.coachingSession.findFirst({ where: { id, organizationId, agentEmail: { in: agent.emails } } });
  if (!coaching) throw new UserError("Coaching session not found");
  const { count } = await prisma.coachingSession.updateMany({
    where: { id, organizationId, status: "ASSIGNED" },
    data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), agentResponse: parsed.agentResponse },
  });
  if (count === 0) throw new UserError("This session has already been acknowledged");

  await prisma.notification.create({
    data: { organizationId, userId: coaching.coachId, type: "qa_coaching_acknowledged", payload: { coachingId: id, agentName: agent.name } },
  });
  await recordAudit({
    organizationId,
    userId: agent.id,
    entity: "CoachingSession",
    entityId: id,
    action: "qa.coaching_acknowledged",
    oldValue: { status: "ASSIGNED" },
    newValue: { status: "ACKNOWLEDGED" },
  });
  revalidatePath("/portal/coaching");
  revalidatePath("/portal");
});
