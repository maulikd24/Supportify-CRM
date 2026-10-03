"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireOrg } from "@/lib/auth/require-role";
import { recordAudit } from "@/lib/audit/record";
import { UserError, withUserErrors } from "@/lib/actions/user-error";
import { QA_GROWTH_UPSELL, qaGrowthFeaturesAvailable } from "@/lib/qa/plan-features";
import type { CoachingStatus } from "@/generated/prisma/client";

const createSchema = z.object({
  agentEmail: z.string().trim().toLowerCase().email("Pick an agent"),
  reviewId: z.string().min(1).nullable().default(null),
  focusAreas: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
  notes: z.string().trim().min(1, "Add coaching notes for the agent").max(4000, "Notes must be 4,000 characters or fewer"),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid due date")
    .nullable()
    .default(null),
});

function revalidate(reviewId?: string | null) {
  revalidatePath("/qa/coaching");
  revalidatePath("/qa/agents");
  if (reviewId) revalidatePath(`/qa/reviews/${reviewId}`);
}

export const createCoachingAction = withUserErrors(async function createCoachingAction(input: z.input<typeof createSchema>) {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;
  if (!(await qaGrowthFeaturesAvailable(organizationId))) throw new UserError(`Coaching is ${QA_GROWTH_UPSELL}`);
  const parsed = createSchema.parse(input);

  // Agents are identified by their helpdesk email; it must be someone this org has reviewed.
  const review = parsed.reviewId
    ? await prisma.ticketReview.findFirst({ where: { id: parsed.reviewId, organizationId }, select: { id: true, agentEmail: true, agentName: true } })
    : await prisma.ticketReview.findFirst({
        where: { organizationId, agentEmail: { equals: parsed.agentEmail, mode: "insensitive" } },
        orderBy: { createdAt: "desc" },
        select: { id: true, agentEmail: true, agentName: true },
      });
  if (!review?.agentEmail) throw new UserError(parsed.reviewId ? "Review not found" : "No reviews found for that agent");
  if (review.agentEmail.toLowerCase() !== parsed.agentEmail) throw new UserError("That review belongs to a different agent");

  const coaching = await prisma.coachingSession.create({
    data: {
      organizationId,
      agentEmail: parsed.agentEmail,
      agentName: review.agentName,
      reviewId: parsed.reviewId,
      coachId: session.user.id,
      focusAreas: parsed.focusAreas,
      notes: parsed.notes,
      dueDate: parsed.dueDate ? new Date(`${parsed.dueDate}T23:59:59Z`) : null,
    },
  });

  // If the agent also has a Supportify login, let them know.
  const agentUser = await prisma.user.findFirst({
    where: {
      organizationId,
      isActive: true,
      id: { not: session.user.id },
      OR: [{ email: { equals: parsed.agentEmail, mode: "insensitive" } }, { helpdeskEmail: { equals: parsed.agentEmail, mode: "insensitive" } }],
    },
    select: { id: true },
  });
  if (agentUser) {
    await prisma.notification.create({
      data: { organizationId, userId: agentUser.id, type: "qa_coaching_assigned", payload: { coachingId: coaching.id, coachName: session.user.name } },
    });
  }

  await recordAudit({
    organizationId,
    userId: session.user.id,
    entity: "CoachingSession",
    entityId: coaching.id,
    action: "qa.coaching_created",
    newValue: { agentEmail: parsed.agentEmail, reviewId: parsed.reviewId, focusAreas: parsed.focusAreas },
  });
  revalidate(parsed.reviewId);
  return { id: coaching.id };
});

const updateSchema = z.object({
  status: z.enum(["ACKNOWLEDGED", "COMPLETED", "CANCELLED"]),
  agentResponse: z.string().trim().max(4000).optional(),
  outcome: z.string().trim().max(4000).optional(),
});

const NEXT_STATUSES: Record<CoachingStatus, CoachingStatus[]> = {
  ASSIGNED: ["ACKNOWLEDGED", "COMPLETED", "CANCELLED"],
  ACKNOWLEDGED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/** Moves a session along. Allowed for its coach and for owners/admins, on any plan, so downgraded orgs can wrap up. */
export const updateCoachingAction = withUserErrors(async function updateCoachingAction(id: string, input: z.input<typeof updateSchema>) {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;
  const parsed = updateSchema.parse(input);

  const coaching = await prisma.coachingSession.findFirst({ where: { id, organizationId } });
  if (!coaching) throw new UserError("Coaching session not found");
  const isAdmin = session.user.orgRole === "OWNER" || session.user.orgRole === "ADMIN";
  if (coaching.coachId !== session.user.id && !isAdmin) throw new UserError("Only the coach or an admin can update this session");
  if (!NEXT_STATUSES[coaching.status].includes(parsed.status)) {
    throw new UserError(`This session is already ${coaching.status.toLowerCase()}`);
  }

  const now = new Date();
  const { count } = await prisma.coachingSession.updateMany({
    where: { id, organizationId, status: coaching.status },
    data: {
      status: parsed.status,
      ...(parsed.agentResponse ? { agentResponse: parsed.agentResponse } : {}),
      ...(parsed.outcome ? { outcome: parsed.outcome } : {}),
      ...(parsed.status === "ACKNOWLEDGED" || (parsed.status === "COMPLETED" && !coaching.acknowledgedAt) ? { acknowledgedAt: now } : {}),
      ...(parsed.status === "COMPLETED" ? { completedAt: now } : {}),
    },
  });
  if (count === 0) throw new UserError("Someone else just updated this session. Refresh and try again.");

  await recordAudit({
    organizationId,
    userId: session.user.id,
    entity: "CoachingSession",
    entityId: id,
    action: `qa.coaching_${parsed.status.toLowerCase()}`,
    oldValue: { status: coaching.status },
    newValue: { status: parsed.status },
  });
  revalidate(coaching.reviewId);
});
