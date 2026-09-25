import Link from "next/link";
import { Check } from "lucide-react";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { InkStatTile } from "@/components/dashboard/ink-stat-tile";
import { Eyebrow, Panel, PanelEmpty, PanelList, PanelRow } from "@/components/dashboard/panel";
import { ProgressStat } from "@/components/dashboard/progress-stat";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { addDays, bucketize, formatDelta, startOfDay } from "@/lib/utils/date-buckets";
import { formatDate } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

const WEEKS = 8;
const LOW_SCORE = 70;

export default async function QaOverviewPage() {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;
  const trendStart = addDays(startOfDay(), -(WEEKS * 7 - 1));
  const monthAgo = addDays(startOfDay(), -30);

  const [organization, subscription, reviewCount, avgScore, dsatCount, hasZendesk, sopCount, trendReviews, recent, lowScores, recentDsat] =
    await Promise.all([
      prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } }),
      prisma.productSubscription.findUnique({ where: { organizationId_product: { organizationId, product: "QA_SENTINEL" } } }),
      prisma.ticketReview.count({ where: { organizationId } }),
      prisma.ticketReview.aggregate({ where: { organizationId }, _avg: { overallScore: true } }),
      prisma.dsatAnalysis.count({ where: { organizationId } }),
      prisma.zendeskConnection.findUnique({ where: { organizationId } }).then((c) => c?.isValid ?? false),
      prisma.sopDocument.count({ where: { organizationId } }),
      prisma.ticketReview.findMany({ where: { organizationId, createdAt: { gte: trendStart } }, select: { createdAt: true, overallScore: true } }),
      prisma.ticketReview.findMany({
        where: { organizationId },
        select: { id: true, ticketId: true, ticketSubject: true, agentName: true, overallScore: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.ticketReview.findMany({
        where: { organizationId, overallScore: { lt: LOW_SCORE }, createdAt: { gte: monthAgo } },
        select: { id: true, ticketId: true, ticketSubject: true, agentName: true, overallScore: true },
        orderBy: { overallScore: "asc" },
        take: 3,
      }),
      prisma.dsatAnalysis.findMany({
        where: { organizationId },
        select: { id: true, ticketId: true, ticketSubject: true, customerName: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 2,
      }),
    ]);

  const dailyBars = bucketize(trendReviews, (r) => r.createdAt, { count: 10 }).map((b) => b.value);
  const weekly = bucketize(trendReviews, (r) => r.createdAt, { count: WEEKS, bucketDays: 7 });
  const trend = weekly.map((b) => ({
    label: `Week of ${b.start.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
    value: b.value,
  }));
  const thisWeek = weekly[WEEKS - 1].value;
  const delta = formatDelta(thisWeek, weekly[WEEKS - 2].value);
  const avg = avgScore._avg.overallScore != null ? Math.round(avgScore._avg.overallScore) : null;
  const quota = subscription?.reviewQuota ?? null;
  const used = subscription?.reviewsUsedThisPeriod ?? 0;

  const setup = [
    { label: "Connect Zendesk", done: hasZendesk, href: "/qa/settings" },
    { label: "Upload an SOP", done: sopCount > 0, href: "/qa/settings" },
    { label: "Run your first review", done: reviewCount > 0, href: "/qa/reviews" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Quality overview</h1>
        <p className="text-sm text-muted-foreground">
          {organization.name} ·{" "}
          {subscription?.status === "TRIALING" && subscription.trialEndsAt
            ? `Trial active until ${formatDate(subscription.trialEndsAt)}`
            : `Subscription ${(subscription?.status ?? "none").toLowerCase()}`}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4 xl:col-span-3">
          <InkStatTile
            eyebrow="Average QA score"
            value={avg ?? "—"}
            unit={avg != null ? "/100" : undefined}
            caption={`${reviewCount} reviews`}
            detail={`${dsatCount} DSAT cases analysed`}
            bars={dailyBars}
            barsLabel="Reviews run each day over the last 10 days"
            action={{ href: "/qa/reviews", label: "All reviews" }}
          />
        </div>
        <Panel
          className="lg:col-span-8 xl:col-span-9"
          bodyClassName="px-5"
          footer={
            <div className="flex items-center justify-between gap-3">
              <span>Reviewed this week</span>
              <span className="font-heading text-sm font-semibold text-foreground">{thisWeek} tickets</span>
              {delta ? (
                <span className={delta.startsWith("+") ? "font-medium text-primary" : "font-medium text-destructive"}>
                  {delta.startsWith("+") ? "↑" : "↓"} {delta.slice(1)} WoW
                </span>
              ) : (
                <span>&nbsp;</span>
              )}
            </div>
          }
        >
          <div className="pt-5">
            <Eyebrow>Review volume · last {WEEKS} weeks</Eyebrow>
            <p className="mt-1 font-heading text-3xl font-semibold tracking-tight tabular-nums">
              {trendReviews.length} <span className="text-base font-medium text-muted-foreground">tickets</span>
            </p>
          </div>
          <TrendChart data={trend} valueLabel="Reviews" />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          eyebrow="Latest"
          title="Recent reviews"
          action={
            <Link href="/qa/reviews" className="text-xs font-semibold text-primary hover:underline">
              View all
            </Link>
          }
        >
          {recent.length === 0 ? (
            <PanelEmpty>No reviews yet.</PanelEmpty>
          ) : (
            <PanelList>
              {recent.map((r) => (
                <PanelRow
                  key={r.id}
                  tone={r.overallScore != null && r.overallScore < LOW_SCORE ? "destructive" : "primary"}
                  title={r.ticketSubject || `Ticket #${r.ticketId}`}
                  meta={`${r.agentName ?? "Unknown agent"} · ${formatDate(r.createdAt)}`}
                  trailing={
                    <>
                      <ScoreChip score={r.overallScore} />
                      <Link href={`/qa/reviews/${r.id}`} className="font-semibold text-primary hover:underline">
                        Open
                      </Link>
                    </>
                  }
                />
              ))}
            </PanelList>
          )}
        </Panel>

        <Panel eyebrow="Last 30 days" title="Needs attention">
          {lowScores.length === 0 && recentDsat.length === 0 ? (
            <PanelEmpty>Nothing flagged. Every recent review scored {LOW_SCORE}+.</PanelEmpty>
          ) : (
            <PanelList>
              {lowScores.map((r) => (
                <PanelRow
                  key={r.id}
                  tone="destructive"
                  title={r.ticketSubject || `Ticket #${r.ticketId}`}
                  meta={`Low score · ${r.agentName ?? "Unknown agent"}`}
                  trailing={
                    <>
                      <ScoreChip score={r.overallScore} />
                      <Link href={`/qa/reviews/${r.id}`} className="font-semibold text-primary hover:underline">
                        Coach
                      </Link>
                    </>
                  }
                />
              ))}
              {recentDsat.map((d) => (
                <PanelRow
                  key={d.id}
                  tone="muted"
                  title={d.ticketSubject || (d.ticketId ? `Ticket #${d.ticketId}` : "DSAT analysis")}
                  meta={`DSAT · ${d.customerName ?? "Customer"} · ${formatDate(d.createdAt)}`}
                  trailing={
                    <Link href={`/qa/dsat/${d.id}`} className="font-semibold text-primary hover:underline">
                      Review
                    </Link>
                  }
                />
              ))}
            </PanelList>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-7" title="Usage" action={<span className="text-xs text-muted-foreground">This billing period</span>} bodyClassName="grid gap-6 px-5 pt-2 pb-5 sm:grid-cols-3">
          <ProgressStat
            label="AI reviews used"
            value={quota != null ? `${used}/${quota}` : used}
            progress={quota ? used / quota : 0}
            hint={quota != null ? `${Math.max(0, quota - used)} remaining` : "No quota set"}
          />
          <ProgressStat label="SOPs" value={sopCount} progress={sopCount > 0 ? 1 : 0} hint="Rubrics reviews grade against" />
          <ProgressStat label="DSAT cases" value={dsatCount} progress={reviewCount ? Math.min(1, dsatCount / reviewCount) : 0} hint="Root-cause analyses run" />
        </Panel>
        <Panel className="lg:col-span-5" title="Setup" action={<span className="text-xs text-muted-foreground">{setup.filter((s) => s.done).length}/{setup.length} done</span>} bodyClassName="px-3 pb-3">
          <ul className="flex flex-col gap-1">
            {setup.map((s) => (
              <li key={s.label}>
                <Link href={s.href} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/60", !s.done && "bg-mist")}>
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border",
                      s.done ? "border-primary bg-primary text-primary-foreground" : "border-foreground/25",
                    )}
                  >
                    {s.done && <Check className="size-3" />}
                  </span>
                  <span className={cn("text-sm font-medium", s.done && "text-muted-foreground line-through")}>{s.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function ScoreChip({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 font-heading font-semibold tabular-nums",
        score < LOW_SCORE ? "bg-destructive/10 text-destructive" : "bg-primary/12 text-primary",
      )}
    >
      {score}
    </span>
  );
}
