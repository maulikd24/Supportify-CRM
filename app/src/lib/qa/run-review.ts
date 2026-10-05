import { prisma } from "@/lib/db/prisma";
import { helpdeskClient } from "@/lib/qa/helpdesks";
import { assessTicket } from "@/lib/qa/assessor";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import { routeAlerts } from "@/lib/alerts/route";
import { LOW_SCORE } from "@/lib/qa/score";
import { computeScore, DEFAULT_SCORECARD, type ResolvedScorecard } from "@/lib/qa/scorecard";
import type { HelpdeskConnection, Prisma, SopDocument } from "@/generated/prisma/client";

export type ReviewSource = "manual" | "bulk" | "auto";

/**
 * Core single-ticket review: fetches the conversation from the org's helpdesk, scores it, and stores the
 * result. No quota check — callers claim a slot via lib/qa/usage.ts first.
 * Lives outside the "use server" actions file so the background auto-review
 * worker can call it without exposing it as a public server action.
 */
export async function runReview(
  organizationId: string,
  connection: HelpdeskConnection,
  sop: SopDocument,
  ticketId: string,
  options: { source: ReviewSource; isOverage: boolean; scorecard?: ResolvedScorecard },
) {
  const scorecard = options.scorecard ?? DEFAULT_SCORECARD;
  const ticketData = await helpdeskClient(connection).getTicket(ticketId);
  if (ticketData.conversation.length === 0) throw new Error(`Ticket ${ticketId} has no messages to review.`);

  const { result, usage } = await assessTicket({
    ticket: { subject: ticketData.subject, status: ticketData.status, priority: ticketData.priority },
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
      ticketId: ticketData.id || ticketId,
      helpdesk: connection.provider,
      ticketSubject: ticketData.subject,
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

  if (review.overallScore != null && review.overallScore < LOW_SCORE) {
    await routeAlerts([
      { organizationId, type: "qa_low_score", reviewId: review.id, ticketId: review.ticketId, agentName: review.agentName, score: review.overallScore },
    ]);
  }

  return review;
}
