import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/record";
import { UserError } from "@/lib/actions/user-error";
import { reviewCriteria } from "@/lib/qa/scorecard";
import type { Prisma } from "@/generated/prisma/client";

export const raiseDisputeSchema = z.object({
  /** null = disputing the overall score. */
  criterionKey: z.string().min(1).nullable().default(null),
  reason: z.string().trim().min(10, "Explain why the score is wrong (at least 10 characters)").max(2000, "Keep the reason under 2,000 characters"),
});

/**
 * Opens a dispute on a review, notifies the org's owners/admins and audits it.
 * `reviewWhere` narrows which reviews the caller may dispute (agents: only their own).
 */
export async function raiseDispute(opts: {
  organizationId: string;
  user: { id: string; name: string };
  reviewId: string;
  input: z.input<typeof raiseDisputeSchema>;
  reviewWhere?: Prisma.TicketReviewWhereInput;
}): Promise<{ id: string }> {
  const { organizationId, user, reviewId } = opts;
  const parsed = raiseDisputeSchema.parse(opts.input);

  const review = await prisma.ticketReview.findFirst({
    where: { AND: [{ id: reviewId, organizationId }, opts.reviewWhere ?? {}] },
    select: { id: true, ticketId: true, criteriaScores: true, scorecardSnapshot: true },
  });
  if (!review) throw new UserError("Review not found");
  if (parsed.criterionKey) {
    const scores = (review.criteriaScores as Record<string, number> | null) ?? {};
    const known = reviewCriteria(review.scorecardSnapshot).some((c) => c.key === parsed.criterionKey);
    if (!known || typeof scores[parsed.criterionKey] !== "number") throw new UserError("Pick one of this review's criteria");
  }
  const open = await prisma.reviewDispute.count({ where: { organizationId, reviewId, status: "OPEN" } });
  if (open > 0) throw new UserError("This review already has an open dispute");

  const dispute = await prisma.reviewDispute.create({
    data: { organizationId, reviewId, raisedById: user.id, criterionKey: parsed.criterionKey, reason: parsed.reason },
  });

  const admins = await prisma.user.findMany({
    where: { organizationId, isActive: true, orgRole: { in: ["OWNER", "ADMIN"] }, id: { not: user.id } },
    select: { id: true },
  });
  if (admins.length > 0) {
    await prisma.notification.createMany({
      data: admins.map((a) => ({
        organizationId,
        userId: a.id,
        type: "qa_dispute_raised",
        payload: { disputeId: dispute.id, reviewId, ticketId: review.ticketId, raisedByName: user.name },
      })),
    });
  }

  await recordAudit({
    organizationId,
    userId: user.id,
    entity: "ReviewDispute",
    entityId: dispute.id,
    action: "qa.dispute_raised",
    newValue: { reviewId, criterionKey: parsed.criterionKey },
  });
  return { id: dispute.id };
}
