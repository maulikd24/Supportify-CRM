import { notFound } from "next/navigation";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AuditorCommentForm } from "./auditor-comment-form";

function scoreVariant(score: number | null): "default" | "secondary" | "destructive" {
  if (score === null) return "secondary";
  if (score >= 75) return "default";
  if (score >= 50) return "secondary";
  return "destructive";
}

export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrg();
  const { id } = await params;

  const review = await prisma.ticketReview.findUnique({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!review) notFound();

  const criteriaScores = (review.criteriaScores as Record<string, number> | null) ?? {};
  const strengths = (review.strengths as string[] | null) ?? [];
  const improvements = (review.improvements as string[] | null) ?? [];
  const sopViolations = (review.sopViolations as string[] | null) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>
              Ticket #{review.ticketId} — {review.ticketSubject}
            </CardTitle>
            <CardDescription>
              Agent: {review.agentName} ({review.agentEmail}) · Reviewed {review.createdAt.toLocaleString()}
            </CardDescription>
          </div>
          <Badge variant={scoreVariant(review.overallScore)} className="text-lg px-3 py-1">
            {review.overallScore ?? "—"}
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p>{review.summary}</p>

          <div>
            <h3 className="mb-2 text-sm font-medium">Criteria scores</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries(criteriaScores).map(([key, value]) => (
                <div key={key} className="rounded border p-2 text-sm">
                  <div className="text-muted-foreground capitalize">{key.replace(/_/g, " ")}</div>
                  <div className="text-lg font-semibold">{value}</div>
                </div>
              ))}
            </div>
          </div>

          {strengths.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-medium">Strengths</h3>
              <ul className="list-disc pl-5 text-sm">
                {strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {improvements.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-medium">Improvements</h3>
              <ul className="list-disc pl-5 text-sm">
                {improvements.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {sopViolations.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-medium text-destructive">SOP violations</h3>
              <ul className="list-disc pl-5 text-sm">
                {sopViolations.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auditor comment</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditorCommentForm reviewId={review.id} initialComment={review.auditorComment ?? ""} />
        </CardContent>
      </Card>
    </div>
  );
}
