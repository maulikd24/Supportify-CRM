import { notFound } from "next/navigation";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Badge } from "@/components/ui/badge";
import { AuditorCommentForm } from "./auditor-comment-form";
import { StartCalibrationButton } from "./start-calibration-button";
import { Eyebrow, Panel, PanelList, PanelRow } from "@/components/dashboard/panel";
import { ProgressStat } from "@/components/dashboard/progress-stat";
import { LOW_SCORE } from "@/lib/qa/score";
import { formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { resolveScorecard, reviewCriteria } from "@/lib/qa/scorecard";
import { qaGrowthFeaturesAvailable } from "@/lib/qa/plan-features";
import { formatDate } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { NewCoachingDialog } from "../../coaching/coaching-dialogs";
import { RaiseDisputeDialog, ResolveDisputeDialog } from "../../disputes/dispute-dialogs";

export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrg();
  const { id } = await params;

  const review = await prisma.ticketReview.findUnique({
    where: { id, organizationId: session.user.organizationId },
    include: {
      calibrationSessions: { orderBy: { createdAt: "desc" }, select: { id: true, status: true } },
      disputes: { orderBy: { createdAt: "desc" }, include: { raisedBy: { select: { name: true } }, resolvedBy: { select: { name: true } } } },
      coachingSessions: { orderBy: { createdAt: "desc" }, include: { coach: { select: { name: true } } } },
    },
  });
  if (!review) notFound();
  const [growthFeatures, orgScorecard] = await Promise.all([
    qaGrowthFeaturesAvailable(session.user.organizationId),
    resolveScorecard(session.user.organizationId),
  ]);

  const isAdmin = session.user.orgRole === "OWNER" || session.user.orgRole === "ADMIN";
  const criteriaScores = (review.criteriaScores as Record<string, number> | null) ?? {};
  const scorecardName = (review.scorecardSnapshot as { name?: string } | null)?.name ?? "Standard";
  const criteria = reviewCriteria(review.scorecardSnapshot).filter((c) => typeof criteriaScores[c.key] === "number");
  const weighted = criteria.some((c) => c.weight !== criteria[0]?.weight);
  const autoFailReasons = (review.autoFailReasons as string[] | null) ?? [];
  const scored = criteria.map((c) => ({ key: c.key, label: c.label, score: criteriaScores[c.key] }));
  const hasOpenDispute = review.disputes.some((d) => d.status === "OPEN");
  // Suggested focus areas: criteria that failed or scored below target.
  const weakAreas = criteria.filter((c) => criteriaScores[c.key] < LOW_SCORE || (c.autoFailBelow != null && criteriaScores[c.key] < c.autoFailBelow)).map((c) => c.label);
  const focusOptions = [...new Set([...criteria.map((c) => c.label), ...orgScorecard.criteria.map((c) => c.label)])];
  const labelFor = (key: string | null) => (key ? (criteria.find((c) => c.key === key)?.label ?? key) : "Overall score");
  const strengths = (review.strengths as string[] | null) ?? [];
  const improvements = (review.improvements as string[] | null) ?? [];
  const sopViolations = (review.sopViolations as string[] | null) ?? [];

  const findings: { label: string; tone: "primary" | "warning" | "destructive"; items: string[] }[] = [
    { label: "Strengths", tone: "primary", items: strengths },
    { label: "Improvements", tone: "warning", items: improvements },
    { label: "SOP violations", tone: "destructive", items: sopViolations },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-12">
        <section
          className={cn(
            "flex flex-col justify-between rounded-xl bg-ink p-5 text-ink-foreground lg:col-span-4 xl:col-span-3",
          )}
        >
          <p className="text-[10px] font-medium tracking-[0.12em] text-ink-foreground/55 uppercase">Overall score</p>
          <p className="mt-3 font-serif text-7xl leading-[0.85] tabular-nums">
            {review.overallScore ?? "—"}
            {review.overallScore != null && <span className="ml-1 text-2xl text-ink-foreground/55">/100</span>}
          </p>
          <p
            className={cn(
              "mt-4 text-xs font-semibold",
              review.overallScore != null && review.overallScore < LOW_SCORE ? "text-destructive" : "text-ink-foreground/70",
            )}
          >
            {review.overallScore == null
              ? "Not scored"
              : review.autoFailed
                ? `Auto-fail: ${autoFailReasons.join(", ") || "critical criterion"}`
                : review.overallScore < LOW_SCORE
                  ? "Needs coaching"
                  : "Meets the bar"}
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 lg:col-span-8 xl:col-span-9">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Eyebrow>Ticket #{review.ticketId}</Eyebrow>
              <h2 className="mt-1 font-heading text-[19px] font-extrabold">{review.ticketSubject || "Untitled ticket"}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {review.agentName} ({review.agentEmail}) · Reviewed {formatDateTime(review.createdAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {growthFeatures && review.agentEmail && (
                <NewCoachingDialog
                  agents={[{ email: review.agentEmail.toLowerCase(), name: review.agentName || review.agentEmail }]}
                  focusOptions={focusOptions}
                  defaults={{ agentEmail: review.agentEmail.toLowerCase(), reviewId: review.id, focusAreas: weakAreas }}
                  trigger={<Button size="sm" variant="outline">Coach agent</Button>}
                />
              )}
              {growthFeatures && scored.length > 0 && !hasOpenDispute && <RaiseDisputeDialog reviewId={review.id} criteria={scored} />}
              {isAdmin && <StartCalibrationButton reviewId={review.id} />}
            </div>
          </div>
          {review.summary && <p className="mt-4 max-w-prose text-[13px] leading-relaxed">{review.summary}</p>}
        </section>
      </div>

      {criteria.length > 0 && (
        <Panel
          eyebrow={`Scorecard · ${scorecardName}`}
          title="Criteria scores"
          action={review.autoFailed ? <Badge variant="destructive">Auto-failed</Badge> : undefined}
          bodyClassName="grid gap-6 px-5 pt-2 pb-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {criteria.map((c) => {
            const value = criteriaScores[c.key];
            const failed = c.autoFailBelow != null && value < c.autoFailBelow;
            const notes = [
              weighted ? `Weight ${c.weight}` : null,
              failed ? `Below critical threshold of ${c.autoFailBelow}` : value < LOW_SCORE ? "Below target" : null,
            ].filter(Boolean);
            return (
              <ProgressStat
                key={c.key}
                label={c.label}
                value={value}
                progress={value / 100}
                hint={notes.length > 0 ? notes.join(" · ") : undefined}
              />
            );
          })}
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {findings
          .filter((f) => f.items.length > 0)
          .map((f) => (
            <Panel key={f.label} eyebrow="Findings" title={f.label}>
              <PanelList>
                {f.items.map((item, i) => (
                  <li key={i} className="flex gap-3 px-5 py-3">
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        f.tone === "primary" && "bg-primary",
                        f.tone === "warning" && "bg-warning",
                        f.tone === "destructive" && "bg-destructive",
                      )}
                    />
                    <p className="text-[13px] leading-relaxed">{item}</p>
                  </li>
                ))}
              </PanelList>
            </Panel>
          ))}
      </div>

      {(review.disputes.length > 0 || review.coachingSessions.length > 0) && (
        <div className={cn("grid gap-4", review.disputes.length > 0 && review.coachingSessions.length > 0 && "lg:grid-cols-2")}>
          {review.disputes.length > 0 && (
            <div id="disputes" className="scroll-mt-20">
              <Panel eyebrow="Appeals" title="Disputes">
                <PanelList>
                  {review.disputes.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
                          {labelFor(d.criterionKey)}
                          <Badge variant={d.status === "OPEN" ? "warning" : d.status === "ADJUSTED" ? "success" : "secondary"}>
                            {d.status === "OPEN" ? "Open" : d.status === "ADJUSTED" ? "Adjusted" : "Upheld"}
                          </Badge>
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {d.raisedBy.name} · {formatDate(d.createdAt)}
                        </p>
                        <p className="mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap">{d.reason}</p>
                        {d.status !== "OPEN" && (
                          <p className="mt-2 border-l-2 border-border pl-3 text-xs text-muted-foreground">
                            <span className="font-semibold text-foreground">{d.resolvedBy?.name ?? "Admin"}:</span> {d.resolutionNote}
                            {d.status === "ADJUSTED" && d.originalScore != null && ` (overall ${d.originalScore} → ${d.adjustedScore})`}
                          </p>
                        )}
                      </div>
                      {isAdmin && d.status === "OPEN" && <ResolveDisputeDialog disputeId={d.id} criteria={scored} disputedKey={d.criterionKey} />}
                    </li>
                  ))}
                </PanelList>
              </Panel>
            </div>
          )}
          {review.coachingSessions.length > 0 && (
            <Panel eyebrow="Follow-up" title="Coaching">
              <PanelList>
                {review.coachingSessions.map((c) => (
                  <PanelRow
                    key={c.id}
                    tone={c.status === "COMPLETED" ? "primary" : c.status === "CANCELLED" ? "muted" : "warning"}
                    title={`${c.status.charAt(0)}${c.status.slice(1).toLowerCase()} · coach ${c.coach.name}`}
                    meta={c.notes}
                    href={`/qa/coaching?status=all&agent=${encodeURIComponent(c.agentEmail)}`}
                    hrefLabel="Open coaching"
                  />
                ))}
              </PanelList>
            </Panel>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-12">
        <Panel eyebrow="Notes" title="Auditor comment" className="lg:col-span-8" bodyClassName="px-5 pb-5">
          <AuditorCommentForm reviewId={review.id} initialComment={review.auditorComment ?? ""} />
        </Panel>
        {review.calibrationSessions.length > 0 && (
          <Panel eyebrow="Consistency" title="Calibration sessions" className="lg:col-span-4">
            <PanelList>
              {review.calibrationSessions.map((s) => (
                <PanelRow
                  key={s.id}
                  tone={s.status === "OPEN" ? "warning" : "muted"}
                  title={s.status === "OPEN" ? "Open session" : "Closed session"}
                  trailing={<Badge variant={s.status === "OPEN" ? "warning" : "secondary"}>{s.status === "OPEN" ? "Open" : "Closed"}</Badge>}
                  href={`/qa/calibration/${s.id}`}
                  hrefLabel="Open calibration session"
                />
              ))}
            </PanelList>
          </Panel>
        )}
      </div>
    </div>
  );
}
