import { prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";
import { ZendeskClient, type ZendeskCredentials } from "@/lib/qa/zendesk-client";
import { assessTicket } from "@/lib/qa/assessor";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import type { Prisma, SopDocument, ZendeskConnection } from "@/generated/prisma/client";

export type ReviewSource = "manual" | "bulk" | "auto";

/**
 * Core single-ticket review: fetches the conversation, scores it, and stores the
 * result. No quota check — callers claim a slot via lib/qa/usage.ts first.
 * Lives outside the "use server" actions file so the background auto-review
 * worker can call it without exposing it as a public server action.
 */
export async function runReview(
  organizationId: string,
  connection: ZendeskConnection,
  sop: SopDocument,
  ticketId: string,
  options: { source: ReviewSource; isOverage: boolean },
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
      source: options.source,
      isOverage: options.isOverage,
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
