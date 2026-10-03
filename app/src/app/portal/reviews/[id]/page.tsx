import { notFound } from "next/navigation";

import { requireAgent } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Badge } from "@/components/ui/badge";
import { Eyebrow, Panel, PanelList } from "@/components/dashboard/panel";
import { ProgressStat } from "@/components/dashboard/progress-stat";
import { agentIdentity, agentReviewsWhere } from "@/lib/qa/portal";
import { reviewCriteria } from "@/lib/qa/scorecard";
import { LOW_SCORE } from "@/lib/qa/score";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { RaiseDisputeDialog } from "@/app/qa/disputes/dispute-dialogs";

export default async function PortalReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAgent();
  const { organizationId } = session.user;
  const { id } = await params;
  const agent = await agentIdentity(session.user.id, organizationId);

  // Only the agent's own reviews: anything else is a 404, not a redirect, so ids can't be probed.
  const review = await prisma.ticketReview.findFirst({
    where: { AND: [{ id, organizationId }, agentReviewsWhere(agent.emails)] },
    include: { disputes: { orderBy: { createdAt: "desc" }, include: { resolvedBy: { select: { name: true } } } } },
  });
  if (!review) notFound();

  const scores = (review.criteriaScores as Record<string, number> | null) ?? {};
  const criteria = reviewCriteria(review.scorecardSnapshot).filter((c) => typeof scores[c.key] === "number");
  const scored = criteria.map((c) => ({ key: c.key, label: c.label, score: scores[c.key] }));
  const findings = [
    { label: "What went well", tone: "bg-primary", items: (review.strengths as string[] | null) ?? [] },
    { label: "To improve", tone: "bg-warning", items: (review.improvements as string[] | null) ?? [] },
    { label: "SOP gaps", tone: "bg-destructive", items: (review.sopViolations as string[] | null) ?? [] },
  ].filter((f) => f.items.length > 0);
  const canDispute = scored.length > 0 && !review.disputes.some((d) => d.status === "OPEN");
  const labelFor = (key: string | null) => (key ? (criteria.find((c) => c.key === key)?.label ?? key) : "Overall score");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-12">
        <section className="flex flex-col justify-between rounded-xl bg-ink p-5 text-ink-foreground lg:col-span-4 xl:col-span-3">
          <p className="text-[10px] font-medium tracking-[0.12em] text-ink-foreground/55 uppercase">Overall score</p>
          <p className="mt-3 font-serif text-7xl leading-[0.85] tabular-nums">
            {review.overallScore ?? "—"}
            {review.overallScore != null && <span className="ml-1 text-2xl text-ink-foreground/55">/100</span>}
          </p>
          {review.autoFailed && <p className="mt-4 text-xs font-semibold text-destructive">Auto-fail: {((review.autoFailReasons as string[] | null) ?? []).join(", ")}</p>}
        </section>
        <section className="rounded-xl border border-border bg-card p-5 lg:col-span-8 xl:col-span-9">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Eyebrow>Ticket #{review.ticketId}</Eyebrow>
              <h2 className="mt-1 font-heading text-[19px] font-extrabold">{review.ticketSubject || "Untitled ticket"}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Reviewed {formatDateTime(review.createdAt)}</p>
            </div>
            {canDispute && <RaiseDisputeDialog reviewId={review.id} criteria={scored} asAgent />}
          </div>
          {review.summary && <p className="mt-4 max-w-prose text-[13px] leading-relaxed">{review.summary}</p>}
        </section>
      </div>

      {criteria.length > 0 && (
        <Panel eyebrow="Breakdown" title="Criteria scores" bodyClassName="grid gap-6 px-5 pt-2 pb-5 sm:grid-cols-2 lg:grid-cols-3">
          {criteria.map((c) => (
            <ProgressStat
              key={c.key}
              label={c.label}
              value={scores[c.key]}
              progress={scores[c.key] / 100}
              hint={c.autoFailBelow != null && scores[c.key] < c.autoFailBelow ? `Critical: below ${c.autoFailBelow}` : scores[c.key] < LOW_SCORE ? "Below target" : c.description || undefined}
            />
          ))}
        </Panel>
      )}

      {findings.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          {findings.map((f) => (
            <Panel key={f.label} eyebrow="Feedback" title={f.label}>
              <PanelList>
                {f.items.map((item, i) => (
                  <li key={i} className="flex gap-3 px-5 py-3">
                    <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", f.tone)} />
                    <p className="text-[13px] leading-relaxed">{item}</p>
                  </li>
                ))}
              </PanelList>
            </Panel>
          ))}
        </div>
      )}

      {review.auditorComment && (
        <Panel eyebrow="From your QA team" title="Reviewer note" bodyClassName="px-5 pb-5">
          <p className="max-w-prose text-[13px] leading-relaxed whitespace-pre-wrap">{review.auditorComment}</p>
        </Panel>
      )}

      {review.disputes.length > 0 && (
        <Panel eyebrow="Appeals" title="Disputes">
          <PanelList>
            {review.disputes.map((d) => (
              <li key={d.id} className="px-5 py-3">
                <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
                  {labelFor(d.criterionKey)}
                  <Badge variant={d.status === "OPEN" ? "warning" : d.status === "ADJUSTED" ? "success" : "secondary"}>
                    {d.status === "OPEN" ? "Waiting for review" : d.status === "ADJUSTED" ? "Score adjusted" : "Score stands"}
                  </Badge>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">Raised {formatDate(d.createdAt)}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap">{d.reason}</p>
                {d.status !== "OPEN" && (
                  <p className="mt-2 border-l-2 border-border pl-3 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{d.resolvedBy?.name ?? "QA team"}:</span> {d.resolutionNote}
                    {d.status === "ADJUSTED" && d.originalScore != null && ` (overall ${d.originalScore} → ${d.adjustedScore})`}
                  </p>
                )}
              </li>
            ))}
          </PanelList>
        </Panel>
      )}
    </div>
  );
}
