import { notFound } from "next/navigation";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CommentForm } from "./comment-form";

function probabilityVariant(prob: string | null): "default" | "secondary" | "destructive" {
  if (prob === "high") return "default";
  if (prob === "medium") return "secondary";
  return "destructive";
}

export default async function DsatDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrg();
  const { id } = await params;

  const analysis = await prisma.dsatAnalysis.findUnique({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!analysis) notFound();

  const rootCauses = (analysis.rootCauses as { issue: string; severity: string; category: string }[] | null) ?? [];
  const recommendations =
    (analysis.csatRecoveryRecommendations as
      | { action: string; priority: string; owner: string; rationale: string }[]
      | null) ?? [];
  const preventionTips = (analysis.preventionTips as string[] | null) ?? [];
  const followUp = (analysis.followUpResponse as { subject: string; body: string } | null) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{analysis.ticketSubject || "DSAT Analysis"}</CardTitle>
            <CardDescription>
              {analysis.ticketId ? `Ticket #${analysis.ticketId} · ` : ""}
              {analysis.customerName ? `${analysis.customerName} · ` : ""}
              {analysis.createdAt.toLocaleString()}
            </CardDescription>
          </div>
          <Badge variant={probabilityVariant(analysis.recoveryProbability)} className="capitalize">
            {analysis.recoveryProbability || "unknown"} recovery
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <h3 className="mb-1 text-sm font-medium">What went wrong</h3>
            <p className="text-sm">{analysis.whatWentWrong}</p>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-medium">Customer impact</h3>
            <p className="text-sm">{analysis.customerImpact}</p>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-medium">Recovery rationale</h3>
            <p className="text-sm">{analysis.recoveryRationale}</p>
          </div>

          {rootCauses.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">Root causes</h3>
              <ul className="flex flex-col gap-2">
                {rootCauses.map((rc, i) => (
                  <li key={i} className="rounded border p-2 text-sm">
                    <span className="font-medium">{rc.issue}</span>{" "}
                    <span className="text-muted-foreground">
                      ({rc.severity} · {rc.category.replace(/_/g, " ")})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {recommendations.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">Recovery recommendations</h3>
              <ul className="flex flex-col gap-2">
                {recommendations.map((rec, i) => (
                  <li key={i} className="rounded border p-2 text-sm">
                    <div className="font-medium">{rec.action}</div>
                    <div className="text-muted-foreground">
                      {rec.priority} · owner: {rec.owner}
                    </div>
                    <div>{rec.rationale}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preventionTips.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-medium">Prevention tips</h3>
              <ul className="list-disc pl-5 text-sm">
                {preventionTips.map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </ul>
            </div>
          )}

          {followUp && (
            <div>
              <h3 className="mb-1 text-sm font-medium">Suggested follow-up</h3>
              <div className="rounded border p-3 text-sm">
                <div className="font-medium">{followUp.subject}</div>
                <p className="mt-1 whitespace-pre-wrap">{followUp.body}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Improvement notes</CardTitle>
        </CardHeader>
        <CardContent>
          <CommentForm analysisId={analysis.id} initialComment={analysis.improvementsComment ?? ""} />
        </CardContent>
      </Card>
    </div>
  );
}
