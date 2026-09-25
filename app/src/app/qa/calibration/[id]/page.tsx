import { notFound } from "next/navigation";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ALL_CRITERIA, type ConversationTurn } from "@/lib/qa/assessor";
import { CloseSessionButton } from "./close-session-button";
import { ScoringForm } from "./scoring-form";
import { ComparisonTable } from "./comparison-table";

export default async function CalibrationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrg();
  const { id } = await params;

  const calibration = await prisma.calibrationSession.findUnique({
    where: { id, organizationId: session.user.organizationId },
    include: {
      review: { include: { primarySop: { select: { name: true } } } },
      entries: { include: { reviewer: { select: { id: true, name: true } } } },
    },
  });
  if (!calibration) notFound();

  const isAdmin = session.user.orgRole === "OWNER" || session.user.orgRole === "ADMIN";
  const myEntry = calibration.entries.find((e) => e.reviewerId === session.user.id);
  const hasSubmitted = Boolean(myEntry?.submittedAt);
  const canSeeResults = calibration.status === "CLOSED" || isAdmin || hasSubmitted;

  const conversation = calibration.review.rawConversation
    ? (JSON.parse(calibration.review.rawConversation) as ConversationTurn[])
    : [];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>
              Ticket #{calibration.review.ticketId} — {calibration.review.ticketSubject}
            </CardTitle>
            <CardDescription>
              Agent: {calibration.review.agentName} · SOP: {calibration.review.primarySop?.name ?? "—"}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={calibration.status === "OPEN" ? "secondary" : "outline"}>{calibration.status}</Badge>
            {isAdmin && calibration.status === "OPEN" && <CloseSessionButton sessionId={calibration.id} />}
          </div>
        </CardHeader>
        <CardContent>
          <details>
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
              Show conversation ({conversation.length} messages)
            </summary>
            <div className="mt-3 flex max-h-96 flex-col gap-2 overflow-y-auto rounded-md border p-3">
              {conversation.map((turn, i) => (
                <div key={i} className={`rounded-md p-2 text-sm ${turn.role === "agent" ? "bg-muted/60" : "bg-muted/20"}`}>
                  <div className="mb-1 text-xs font-medium text-muted-foreground capitalize">
                    {turn.role}
                    {turn.author ? ` — ${turn.author}` : ""}
                  </div>
                  <div className="whitespace-pre-wrap">{turn.body}</div>
                </div>
              ))}
              {conversation.length === 0 && (
                <p className="text-sm text-muted-foreground">No conversation snapshot available.</p>
              )}
            </div>
          </details>
        </CardContent>
      </Card>

      {canSeeResults ? (
        <ComparisonTable
          aiReview={{
            overallScore: calibration.review.overallScore,
            criteriaScores: (calibration.review.criteriaScores as Record<string, number> | null) ?? {},
          }}
          entries={calibration.entries.map((e) => ({
            id: e.id,
            reviewerName: e.reviewer.name,
            overallScore: e.overallScore,
            criteriaScores: (e.criteriaScores as Record<string, number> | null) ?? {},
            notes: e.notes,
            submitted: Boolean(e.submittedAt),
          }))}
          criteria={ALL_CRITERIA}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Score this ticket</CardTitle>
            <CardDescription>
              Score independently — other reviewers&apos; scores (and the AI&apos;s) stay hidden until you submit
              yours, or the session is closed. {calibration.entries.length} reviewer(s) have submitted so far.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScoringForm sessionId={calibration.id} criteria={ALL_CRITERIA} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
