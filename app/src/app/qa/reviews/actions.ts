"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireOrg } from "@/lib/auth/require-role";
import { decryptJson } from "@/lib/security/crypto";
import { ZendeskClient, type ZendeskCredentials } from "@/lib/qa/zendesk-client";
import { assessTicket } from "@/lib/qa/assessor";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import type { Prisma, SopDocument, ZendeskConnection } from "@/generated/prisma/client";

const reviewSchema = z.object({
  ticketId: z.string().min(1, "Ticket ID is required"),
  sopId: z.string().min(1, "Select a SOP"),
});

/** Core single-ticket review: fetches the conversation, scores it, and stores the result. No quota check — callers own that. */
async function runReview(
  organizationId: string,
  connection: ZendeskConnection,
  sop: SopDocument,
  ticketId: string,
) {
  const credentials = decryptJson<ZendeskCredentials>(connection.encryptedToken);
  const zendesk = new ZendeskClient(credentials);
  const ticketData = await zendesk.getTicketWithConversation(ticketId);

  const ticket = ticketData.ticket as { subject?: string; status?: string; priority?: string };
  const { result, usage } = await assessTicket({
    ticket,
    conversation: ticketData.conversation,
    sops: [{ name: sop.name, content: sop.content }],
  });

  const review = await prisma.ticketReview.create({
    data: {
      organizationId,
      ticketId,
      ticketSubject: ticket.subject ?? "",
      agentName: ticketData.agentName,
      agentEmail: ticketData.agentEmail,
      primarySopId: sop.id,
      sopIds: [sop.id],
      sopNames: [sop.name],
      overallScore: result.overall_score,
      criteriaScores: result.criteria_scores as Prisma.InputJsonValue,
      sentiment: result.sentiment?.overall,
      summary: result.summary,
      strengths: result.strengths as Prisma.InputJsonValue,
      improvements: result.improvements as Prisma.InputJsonValue,
      sopViolations: result.sop_violations as Prisma.InputJsonValue,
      accuracyDetail: result.accuracy_detail as Prisma.InputJsonValue,
      rawConversation: JSON.stringify(ticketData.conversation),
      tokensInput: usage.input_tokens,
      tokensOutput: usage.output_tokens,
      tokensCostUsd: usage.cost_usd,
    },
  });

  void dispatchWebhookEvent(organizationId, "review.completed", {
    id: review.id,
    ticketId: review.ticketId,
    agentEmail: review.agentEmail,
    overallScore: review.overallScore,
    sentiment: review.sentiment,
  });

  return review;
}

export async function createReviewAction(formData: FormData) {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;

  const parsed = reviewSchema.parse({
    ticketId: formData.get("ticketId"),
    sopId: formData.get("sopId"),
  });

  const [connection, sop, subscription] = await Promise.all([
    prisma.zendeskConnection.findUnique({ where: { organizationId } }),
    prisma.sopDocument.findUnique({ where: { id: parsed.sopId, organizationId } }),
    prisma.productSubscription.findUnique({ where: { organizationId_product: { organizationId, product: "QA_SENTINEL" } } }),
  ]);

  if (!connection) throw new Error("Connect Zendesk in Settings before running a review");
  if (!sop) throw new Error("SOP not found");
  if (subscription?.reviewQuota != null && subscription.reviewsUsedThisPeriod >= subscription.reviewQuota) {
    throw new Error(
      `You've used all ${subscription.reviewQuota} reviews included in your plan this period. Upgrade in Billing to run more.`,
    );
  }

  const review = await runReview(organizationId, connection, sop, parsed.ticketId);

  if (subscription) {
    await prisma.productSubscription.update({
      where: { id: subscription.id },
      data: { reviewsUsedThisPeriod: { increment: 1 } },
    });
  }

  revalidatePath("/qa/reviews");
  revalidatePath("/qa");
  return { reviewId: review.id };
}

export type BulkReviewSummary = {
  reviewed: number;
  failed: number;
  quotaBlocked: number;
  errors: string[];
};

const MAX_BULK_TICKETS = 100;

/** Runs a review for each ticket ID (newline/comma-separated), stopping once the plan's remaining quota is used up. */
export async function createBulkReviewAction(ticketIdsRaw: string, sopId: string): Promise<BulkReviewSummary> {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;

  const ticketIds = [...new Set(ticketIdsRaw.split(/[\n,]+/).map((t) => t.trim()).filter(Boolean))];
  if (ticketIds.length === 0) throw new Error("No ticket IDs provided");
  if (ticketIds.length > MAX_BULK_TICKETS) {
    throw new Error(`Bulk review is limited to ${MAX_BULK_TICKETS} tickets at a time (got ${ticketIds.length}).`);
  }

  const [connection, sop, subscription] = await Promise.all([
    prisma.zendeskConnection.findUnique({ where: { organizationId } }),
    prisma.sopDocument.findUnique({ where: { id: sopId, organizationId } }),
    prisma.productSubscription.findUnique({ where: { organizationId_product: { organizationId, product: "QA_SENTINEL" } } }),
  ]);
  if (!connection) throw new Error("Connect Zendesk in Settings before running a review");
  if (!sop) throw new Error("SOP not found");

  const remainingQuota =
    subscription?.reviewQuota != null ? Math.max(0, subscription.reviewQuota - subscription.reviewsUsedThisPeriod) : Infinity;

  const summary: BulkReviewSummary = { reviewed: 0, failed: 0, quotaBlocked: 0, errors: [] };

  for (const ticketId of ticketIds) {
    if (summary.reviewed >= remainingQuota) {
      summary.quotaBlocked += 1;
      continue;
    }
    try {
      await runReview(organizationId, connection, sop, ticketId);
      summary.reviewed += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors.push(`Ticket ${ticketId}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }

  if (subscription && summary.reviewed > 0) {
    await prisma.productSubscription.update({
      where: { id: subscription.id },
      data: { reviewsUsedThisPeriod: { increment: summary.reviewed } },
    });
  }

  revalidatePath("/qa/reviews");
  revalidatePath("/qa");
  return summary;
}

export async function saveAuditorCommentAction(reviewId: string, comment: string) {
  const session = await requireOrg();

  await prisma.ticketReview.update({
    where: { id: reviewId, organizationId: session.user.organizationId },
    data: { auditorComment: comment.trim() || null, auditorUpdatedAt: new Date() },
  });

  revalidatePath(`/qa/reviews/${reviewId}`);
}
