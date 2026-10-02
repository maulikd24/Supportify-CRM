"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireOrg } from "@/lib/auth/require-role";
import { runReview } from "@/lib/qa/run-review";
import { claimReviewSlot, releaseReviewSlot, reportOverageReview } from "@/lib/qa/usage";
import { UserError, withUserErrors } from "@/lib/actions/user-error";

const reviewSchema = z.object({
  ticketId: z.string().min(1, "Ticket ID is required"),
  sopId: z.string().min(1, "Select a SOP"),
});

export const createReviewAction = withUserErrors(async function createReviewAction(formData: FormData): Promise<{ reviewId: string; error?: undefined } | { error: string; reviewId?: undefined }> {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;

  const parsed = reviewSchema.parse({
    ticketId: formData.get("ticketId"),
    sopId: formData.get("sopId"),
  });

  const [connection, sop] = await Promise.all([
    prisma.zendeskConnection.findUnique({ where: { organizationId } }),
    prisma.sopDocument.findUnique({ where: { id: parsed.sopId, organizationId } }),
  ]);

  // Known problems are returned, not thrown: production builds hide thrown server-action messages.
  if (!connection) return { error: "Connect Zendesk in Settings before running a review" };
  if (!sop) return { error: "SOP not found" };

  const slot = await claimReviewSlot(organizationId);
  if (!slot.ok) return { error: slot.reason };

  let review;
  try {
    review = await runReview(organizationId, connection, sop, parsed.ticketId, { source: "manual", isOverage: slot.overage });
  } catch (error) {
    await releaseReviewSlot(organizationId, slot.overage);
    console.error("Manual review failed", { organizationId, ticketId: parsed.ticketId, error });
    return { error: error instanceof Error ? error.message : "The review failed. Please try again." };
  }
  if (slot.overage) await reportOverageReview(organizationId, review.id);

  revalidatePath("/qa/reviews");
  revalidatePath("/qa");
  return { reviewId: review.id };
});

export type BulkReviewSummary = {
  reviewed: number;
  failed: number;
  quotaBlocked: number;
  errors: string[];
};

const MAX_BULK_TICKETS = 100;

/** Runs a review for each ticket ID (newline/comma-separated), stopping once the plan's remaining quota is used up. */
export const createBulkReviewAction = withUserErrors(async function createBulkReviewAction(ticketIdsRaw: string, sopId: string): Promise<BulkReviewSummary> {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;

  const ticketIds = [...new Set(ticketIdsRaw.split(/[\n,]+/).map((t) => t.trim()).filter(Boolean))];
  if (ticketIds.length === 0) throw new UserError("No ticket IDs provided");
  if (ticketIds.length > MAX_BULK_TICKETS) {
    throw new UserError(`Bulk review is limited to ${MAX_BULK_TICKETS} tickets at a time (got ${ticketIds.length}).`);
  }

  const [connection, sop] = await Promise.all([
    prisma.zendeskConnection.findUnique({ where: { organizationId } }),
    prisma.sopDocument.findUnique({ where: { id: sopId, organizationId } }),
  ]);
  if (!connection) throw new UserError("Connect Zendesk in Settings before running a review");
  if (!sop) throw new UserError("SOP not found");

  const summary: BulkReviewSummary = { reviewed: 0, failed: 0, quotaBlocked: 0, errors: [] };
  let quotaReason: string | null = null;

  for (const ticketId of ticketIds) {
    if (quotaReason) {
      summary.quotaBlocked += 1;
      continue;
    }
    const slot = await claimReviewSlot(organizationId);
    if (!slot.ok) {
      quotaReason = slot.reason;
      summary.quotaBlocked += 1;
      continue;
    }
    try {
      const review = await runReview(organizationId, connection, sop, ticketId, { source: "bulk", isOverage: slot.overage });
      if (slot.overage) await reportOverageReview(organizationId, review.id);
      summary.reviewed += 1;
    } catch (error) {
      await releaseReviewSlot(organizationId, slot.overage);
      summary.failed += 1;
      summary.errors.push(`Ticket ${ticketId}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }
  if (quotaReason) summary.errors.unshift(quotaReason);

  revalidatePath("/qa/reviews");
  revalidatePath("/qa");
  return summary;
});

export const saveAuditorCommentAction = withUserErrors(async function saveAuditorCommentAction(reviewId: string, comment: string) {
  const session = await requireOrg();

  await prisma.ticketReview.update({
    where: { id: reviewId, organizationId: session.user.organizationId },
    data: { auditorComment: comment.trim() || null, auditorUpdatedAt: new Date() },
  });

  revalidatePath(`/qa/reviews/${reviewId}`);
});
