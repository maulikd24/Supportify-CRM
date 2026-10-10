import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Circle } from "lucide-react";

import { requireProductAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Panel, PanelEmpty, PanelLink } from "@/components/dashboard/panel";
import { StatTile } from "@/components/dashboard/stat-tile";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { formatNumber } from "@/lib/utils/format";
import { breakdown, dailySeries, topMovers, utcDayStart, type DayPoint, type Mover, type Slice } from "@/lib/cx/insights";
import { CHANNEL_LABEL, SOURCE_LABEL, formatChange, formatCsat, formatSentiment, formatShare } from "@/lib/cx/format";
import { periodChange } from "@/lib/cx/impact";

const DAYS = 30;
const DAY_MS = 86_400_000;

function totals(points: DayPoint[]) {
  const n = points.reduce((s, p) => s + p.conversations, 0);
  // Weighted by volume; days with nothing analysed don't pull the average down.
  const weighted = (pick: (p: DayPoint) => number | null) => {
    let sum = 0;
    let weight = 0;
    for (const p of points) {
      const v = pick(p);
      if (v != null) {
        sum += v * p.conversations;
        weight += p.conversations;
      }
    }
    return weight > 0 ? sum / weight : null;
  };
  return { conversations: n, sentiment: weighted((p) => p.sentiment), negativeShare: weighted((p) => p.negativeShare), predictedCsat: weighted((p) => p.predictedCsat) };
}

const shortDay = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

function MoverList({ movers, names, direction }: { movers: Mover[]; names: Map<string, string>; direction: "up" | "down" }) {
  if (movers.length === 0) return <p className="px-5 py-3 text-xs text-muted-foreground">Nothing {direction === "up" ? "rising" : "falling"} noticeably.</p>;
  const Icon = direction === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <ul className="divide-y divide-border">
      {movers.map((m) => (
        <li key={m.topicId} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
          <Link href={`/cx/topics/${m.topicId}`} className="min-w-0 truncate hover:underline">
            {names.get(m.topicId) ?? "Removed topic"}
          </Link>
          <span className={direction === "up" ? "flex shrink-0 items-center gap-1 text-xs text-destructive" : "flex shrink-0 items-center gap-1 text-xs text-success"}>
            <Icon className="size-3.5" aria-hidden />
            {formatNumber(m.previous)} → {formatNumber(m.current)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SliceTable({ slices, labels }: { slices: Slice[]; labels: Record<string, string> }) {
  const total = slices.reduce((n, s) => n + s.conversations, 0);
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-[11px] text-muted-foreground">
        <tr className="border-t border-border">
          <th className="px-5 py-2 font-medium">Name</th>
          <th className="px-2 py-2 text-right font-medium">Share</th>
          <th className="px-2 py-2 text-right font-medium">Sentiment</th>
          <th className="px-5 py-2 text-right font-medium">Predicted CSAT</th>
        </tr>
      </thead>
      <tbody>
        {slices.map((s) => (
          <tr key={s.id} className="border-t border-border">
            <td className="px-5 py-2">{labels[s.id] ?? s.id}</td>
            <td className="px-2 py-2 text-right tabular-nums">{formatShare(total ? s.conversations / total : null)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{formatSentiment(s.sentiment)}</td>
            <td className="px-5 py-2 text-right tabular-nums">{formatCsat(s.predictedCsat)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function CxOverviewPage() {
  const session = await requireProductAccess("CX_INTELLIGENCE");
  const organizationId = session.user.organizationId;
  const end = new Date(utcDayStart().getTime() + DAY_MS); // through the end of today (UTC)
  const from = new Date(end.getTime() - DAYS * DAY_MS);
  const previousFrom = new Date(from.getTime() - DAYS * DAY_MS);

  const [sub, costSettings, teamCount, conversationCount, byStatus, series, previousSeries, channels, sources, movers, topics] = await Promise.all([
    prisma.productSubscription.findUnique({
      where: { organizationId_product: { organizationId, product: "CX_INTELLIGENCE" } },
      select: { analysesUsedThisPeriod: true, analysisQuota: true },
    }),
    prisma.cxCostSettings.findUnique({ where: { organizationId }, select: { costPerContact: true } }),
    prisma.team.count({ where: { organizationId } }),
    prisma.conversation.count({ where: { organizationId } }),
    prisma.conversation.groupBy({ by: ["analysisStatus"], where: { organizationId }, _count: { _all: true } }),
    dailySeries(organizationId, "all", "", from, DAYS),
    dailySeries(organizationId, "all", "", previousFrom, DAYS),
    breakdown(organizationId, "channel", from, end),
    breakdown(organizationId, "source", from, end),
    topMovers(organizationId, end),
    prisma.topic.findMany({ where: { organizationId }, select: { id: true, name: true } }),
  ]);
  const status = Object.fromEntries(byStatus.map((s) => [s.analysisStatus, s._count._all])) as Partial<Record<string, number>>;
  const waiting = (status.PENDING ?? 0) + (status.QUEUED ?? 0);
  const costsSet = Object.values((costSettings?.costPerContact ?? {}) as Record<string, number | null>).some((v) => v != null);
  const now = totals(series);
  const before = totals(previousSeries);
  const names = new Map(topics.map((t) => [t.id, t.name]));
  const vsBefore = (c: number | null, p: number | null) => {
    const change = formatChange(periodChange(c, p));
    return change ? `${change} vs previous ${DAYS} days` : `Last ${DAYS} days`;
  };

  const steps = [
    { done: costsSet, label: "Set what a support contact costs", hint: "So every problem can be priced.", href: "/cx/settings" },
    { done: teamCount > 0, label: "Add your teams and BPO partners", hint: "To compare them and route issues to the team that fixes them.", href: "/cx/settings" },
    { done: conversationCount > 0, label: "Connect your helpdesk", hint: "Every solved ticket is imported, with personal details removed first.", href: "/cx/sources" },
  ];
  const setupDone = steps.every((s) => s.done);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-[19px] font-extrabold">CX Intelligence</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Every customer conversation, read and sorted into what customers contact you about, why, and what it costs, with
          early warnings when something starts breaking.
        </p>
      </div>

      {!setupDone && (
        <Panel eyebrow="Get started" title="Set up CX Intelligence">
          <ol className="flex flex-col divide-y divide-border border-t border-border">
            {steps.map((step) => (
              <li key={step.label} className="flex items-start gap-3 px-5 py-3">
                {step.done ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Done" />
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="To do" />
                )}
                <div className="min-w-0">
                  <Link href={step.href} className="text-sm font-medium hover:underline">
                    {step.label}
                  </Link>
                  <p className="text-xs text-muted-foreground">{step.hint}</p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Conversations" value={formatNumber(now.conversations)} hint={vsBefore(now.conversations, before.conversations)} />
        <StatTile label="Average sentiment" value={formatSentiment(now.sentiment)} hint="From −100 (angry) to +100 (delighted)" />
        <StatTile label="Negative conversations" value={formatShare(now.negativeShare)} hint={vsBefore(now.negativeShare, before.negativeShare)} />
        <StatTile label="Predicted CSAT" value={formatCsat(now.predictedCsat)} hint="Out of 5, for every conversation, surveyed or not" />
      </div>

      {now.conversations === 0 ? (
        <Panel eyebrow="Trends" title="Last 30 days">
          <PanelEmpty>Trends appear here once conversations from the last {DAYS} days have been imported and analysed.</PanelEmpty>
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel eyebrow="Trend" title="Conversations per day" description={`Last ${DAYS} days, by the day the conversation started (UTC).`}>
              <div className="px-5 pb-4">
                <TrendChart data={series.map((p) => ({ label: shortDay(p.day), value: p.conversations }))} valueLabel="Conversations" valueFormat="compact" />
              </div>
            </Panel>
            <Panel eyebrow="Trend" title="Negative conversations per day" description="Share of analysed conversations with negative sentiment (%), over daily volume.">
              <div className="px-5 pb-4">
                <TrendChart
                  data={series.map((p) => ({ label: shortDay(p.day), value: p.negativeShare == null ? 0 : Math.round(p.negativeShare * 100), bar: p.conversations }))}
                  valueLabel="Negative %"
                  barLabel="Conversations"
                />
              </div>
            </Panel>
          </div>

          <Panel eyebrow="Top movers" title="What changed this week" description="Topics by change in conversations, last 7 days against the 7 before." action={<PanelLink href="/cx/topics">All topics</PanelLink>}>
            <div className="grid border-t border-border md:grid-cols-2 md:divide-x md:divide-border">
              <div>
                <p className="px-5 pt-3 text-xs font-semibold">Rising</p>
                <MoverList movers={movers.rising} names={names} direction="up" />
              </div>
              <div>
                <p className="px-5 pt-3 text-xs font-semibold">Falling</p>
                <MoverList movers={movers.falling} names={names} direction="down" />
              </div>
            </div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel eyebrow="Breakdown" title="By channel" description={`Last ${DAYS} days.`}>
              <SliceTable slices={channels} labels={CHANNEL_LABEL} />
            </Panel>
            <Panel eyebrow="Breakdown" title="By source" description={`Last ${DAYS} days.`}>
              <SliceTable slices={sources} labels={SOURCE_LABEL} />
            </Panel>
          </div>
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Conversations stored" value={formatNumber(conversationCount)} />
        <StatTile
          label="Analysed this period"
          value={formatNumber(sub?.analysesUsedThisPeriod ?? 0)}
          hint={sub?.analysisQuota != null ? `of ${formatNumber(sub.analysisQuota)} included` : "Unlimited"}
        />
        <StatTile
          label="Waiting for analysis"
          value={formatNumber(waiting)}
          hint={status.SKIPPED_QUOTA ? `${formatNumber(status.SKIPPED_QUOTA)} over this month's allowance` : "Analysed in batches within a few hours"}
          tone={status.SKIPPED_QUOTA ? "warning" : "default"}
        />
      </div>
    </div>
  );
}
