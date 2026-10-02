import { prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";
import { ZendeskClient, type ZendeskCredentials } from "@/lib/qa/zendesk-client";
import { assessTicket } from "@/lib/qa/assessor";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { computeScore, DEFAULT_SCORECARD, type ResolvedScorecard } from "@/lib/qa/scorecard";
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
  options: { source: ReviewSource; isOverage: boolean; scorecard?: ResolvedScorecard },
) {
  const scorecard = options.scorecard ?? DEFAULT_SCORECARD;
  const credentials = decryptJson<ZendeskCredentials>(connection.encryptedToken);
  const zendesk = new ZendeskClient(credentials);
  const ticketData = await zendesk.getTicketWithConversation(ticketId);

  const ticket = ticketData.ticket as { subject?: string; status?: string; priority?: string };
  const { result, usage } = await assessTicket({
    ticket,
    conversation: ticketData.conversation,
    sops: [{ name: sop.name, content: sop.content }],
    criteria: scorecard.criteria,
  });

  // Keep only this scorecard's criteria, then compute the weighted overall ourselves.
  const criteriaScores = Object.fromEntries(
    scorecard.criteria.map((c) => [c.key, result.criteria_scores?.[c.key]]).filter(([, v]) => typeof v === "number"),
  ) as Record<string, number>;
  const score = computeScore(scorecard.criteria, criteriaScores);

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
      overallScore: score.overall,
      criteriaScores: criteriaScores as Prisma.InputJsonValue,
      scorecardId: scorecard.id,
      scorecardSnapshot: { name: scorecard.name, criteria: scorecard.criteria } as unknown as Prisma.InputJsonValue,
      autoFailed: score.autoFailed,
      autoFailReasons: score.autoFailed ? (score.autoFailReasons as Prisma.InputJsonValue) : undefined,
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
