"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireOrg } from "@/lib/auth/require-role";
import { recordAudit } from "@/lib/audit/record";
import { UserError, withUserErrors } from "@/lib/actions/user-error";
import { QA_GROWTH_UPSELL, qaGrowthFeaturesAvailable } from "@/lib/qa/plan-features";
import { computeScore, reviewCriteria } from "@/lib/qa/scorecard";
import { raiseDispute, raiseDisputeSchema } from "@/lib/qa/disputes";
import type { Prisma } from "@/generated/prisma/client";

function revalidate(reviewId: string) {
  revalidatePath("/qa/disputes");
  revalidatePath(`/qa/reviews/${reviewId}`);
}

export const raiseDisputeAction = withUserErrors(async function raiseDisputeAction(reviewId: string, input: z.input<typeof raiseDisputeSchema>) {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;
  if (!(await qaGrowthFeaturesAvailable(organizationId))) throw new UserError(`Score disputes are ${QA_GROWTH_UPSELL}`);
  const result = await raiseDispute({ organizationId, user: session.user, reviewId, input });
  revalidate(reviewId);
  return result;
});

const resolveSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("uphold"), note: z.string().trim().min(1, "Add a note explaining the decision").max(2000) }),
  z.object({
    decision: z.literal("adjust"),
    note: z.string().trim().min(1, "Add a note explaining the decision").max(2000),
    scores: z.record(z.string(), z.number().int("Scores must be whole numbers").min(0, "Scores must be 0–100").max(100, "Scores must be 0–100")),
  }),
]);

/** Owners/admins settle a dispute by upholding the score or adjusting criterion scores. Allowed on any plan. */
export const resolveDisputeAction = withUserErrors(async function resolveDisputeAction(id: string, input: z.input<typeof resolveSchema>) {
  const session = await requireOrg(["OWNER", "ADMIN"]);
  const organizationId = session.user.organizationId;
  const parsed = resolveSchema.parse(input);

  const dispute = await prisma.reviewDispute.findFirst({ where: { id, organizationId }, include: { review: true } });
  if (!dispute) throw new UserError("Dispute not found");
  if (dispute.status !== "OPEN") throw new UserError("This dispute has already been resolved");
  const { review } = dispute;
  const originalScore = review.overallScore;
  const now = new Date();

  let adjusted: { criteriaScores: Record<string, number>; overall: number; autoFailed: boolean; autoFailReasons: string[] } | null = null;
  if (parsed.decision === "adjust") {
    const criteria = reviewCriteria(review.scorecardSnapshot);
    const current = (review.criteriaScores as Record<string, number> | null) ?? {};
    const unknown = Object.keys(parsed.scores).filter((k) => !criteria.some((c) => c.key === k));
    if (unknown.length > 0) throw new UserError("Scores must be for this review's criteria");
    const criteriaScores = { ...current, ...parsed.scores };
    if (Object.entries(parsed.scores).every(([k, v]) => current[k] === v)) throw new UserError("Change at least one score, or uphold the original");
    adjusted = { criteriaScores, ...computeScore(criteria, criteriaScores) };
  }

  await prisma.$transaction(async (tx) => {
    // Conditional on OPEN so two admins can't resolve the same dispute twice.
    const { count } = await tx.reviewDispute.updateMany({
      where: { id, organizationId, status: "OPEN" },
      data: {
        status: adjusted ? "ADJUSTED" : "UPHELD",
        resolvedById: session.user.id,
        resolutionNote: parsed.note,
        originalScore,
        adjustedScore: adjusted ? adjusted.overall : originalScore,
        resolvedAt: now,
      },
    });
    if (count === 0) throw new UserError("This dispute has already been resolved");
    if (adjusted) {
      await tx.ticketReview.update({
        where: { id: review.id },
        data: {
          criteriaScores: adjusted.criteriaScores as Prisma.InputJsonValue,
          overallScore: adjusted.overall,
          autoFailed: adjusted.autoFailed,
          autoFailReasons: adjusted.autoFailReasons as Prisma.InputJsonValue,
          scoreEditedAt: now,
        },
      });
    }
  });

  if (dispute.raisedById !== session.user.id) {
    await prisma.notification.create({
      data: {
        organizationId,
        userId: dispute.raisedById,
        type: "qa_dispute_resolved",
        payload: { disputeId: id, reviewId: review.id, ticketId: review.ticketId, outcome: adjusted ? "adjusted" : "upheld" },
      },
    });
  }
  await recordAudit({
    organizationId,
    userId: session.user.id,
    entity: "TicketReview",
    entityId: review.id,
    action: adjusted ? "qa.review_score_adjusted" : "qa.dispute_upheld",
    oldValue: { overallScore: originalScore, criteriaScores: review.criteriaScores as Prisma.InputJsonValue },
    newValue: adjusted ? { overallScore: adjusted.overall, criteriaScores: adjusted.criteriaScores, disputeId: id } : { disputeId: id },
  });
  revalidate(review.id);
  revalidatePath("/qa");
  revalidatePath("/qa/agents");
});
