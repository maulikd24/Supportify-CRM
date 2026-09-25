import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { InkStatTile } from "@/components/dashboard/ink-stat-tile";
import { Eyebrow, Panel } from "@/components/dashboard/panel";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { addDays, bucketize, formatCompact, formatDelta, startOfDay } from "@/lib/utils/date-buckets";
import type { Prisma } from "@/generated/prisma/client";

const WEEKS = 8;

export async function OverviewRow({ clientFilter, taskFilter }: { clientFilter: Prisma.ClientWhereInput; taskFilter: Prisma.TaskWhereInput }) {
  const now = new Date();
  const overdueWhere: Prisma.TaskWhereInput = { ...taskFilter, status: { in: ["PENDING", "OVERDUE"] }, dueAt: { lt: now } };
  const trendStart = addDays(startOfDay(), -(WEEKS * 7 - 1));

  const [overdue, overdueHigh, overdueMedium, recentOverdue, pipeline, added, won] = await Promise.all([
    prisma.task.count({ where: overdueWhere }),
    prisma.task.count({ where: { ...overdueWhere, client: { priority: "HIGH" } } }),
    prisma.task.count({ where: { ...overdueWhere, client: { priority: "MEDIUM" } } }),
    prisma.task.findMany({ where: { ...overdueWhere, dueAt: { lt: now, gte: addDays(startOfDay(), -9) } }, select: { dueAt: true } }),
    prisma.client.aggregate({ where: { ...clientFilter, status: "ACTIVE" }, _sum: { dealValue: true }, _count: true }),
    prisma.client.findMany({ where: { ...clientFilter, createdAt: { gte: trendStart } }, select: { createdAt: true, dealValue: true } }),
    prisma.client.findMany({ where: { ...clientFilter, status: "COMPLETED", completedAt: { gte: trendStart } }, select: { completedAt: true } }),
  ]);

  const overdueBars = bucketize(recentOverdue, (t) => t.dueAt, { count: 10 }).map((b) => b.value);
  const addedWeekly = bucketize(added, (c) => c.createdAt, { count: WEEKS, bucketDays: 7, getValue: (c) => Number(c.dealValue ?? 0) });
  const wonWeekly = bucketize(won, (c) => c.completedAt, { count: WEEKS, bucketDays: 7 });
  const trend = addedWeekly.map((b, i) => ({
    label: `Week of ${b.start.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
    value: b.value,
    bar: wonWeekly[i].value,
  }));
  const thisWeek = addedWeekly[WEEKS - 1].value;
  const delta = formatDelta(thisWeek, addedWeekly[WEEKS - 2].value);

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="lg:col-span-4 xl:col-span-3">
        <InkStatTile
          eyebrow="Overdue"
          value={overdue}
          caption="open items"
          detail={`${overdueHigh} high · ${overdueMedium} medium priority`}
          bars={overdueBars}
          barsLabel="Tasks that fell overdue each day over the last 10 days"
          action={{ href: "/tasks", label: `View all ${overdue}` }}
        />
      </div>
      <Panel
        className="lg:col-span-8 xl:col-span-9"
        bodyClassName="px-5"
        footer={
          <div className="flex items-center justify-between gap-3">
            <span>Won this week</span>
            <span className="font-heading text-sm font-semibold text-foreground">
              {wonWeekly[WEEKS - 1].value} client{wonWeekly[WEEKS - 1].value === 1 ? "" : "s"}
            </span>
            {delta ? (
              <span className={delta.startsWith("+") ? "font-medium text-primary" : "font-medium text-destructive"}>
                {delta.startsWith("+") ? "↑" : "↓"} {delta.slice(1)} added WoW
              </span>
            ) : (
              <span>{formatCompact(thisWeek)} added this week</span>
            )}
          </div>
        }
      >
        <div className="flex flex-wrap items-start justify-between gap-3 pt-5">
          <div>
            <Eyebrow>Active pipeline</Eyebrow>
            <p className="mt-1 font-heading text-3xl font-semibold tracking-tight tabular-nums">
              {formatCompact(Number(pipeline._sum.dealValue ?? 0))}
            </p>
            <p className="text-xs text-muted-foreground">
              across{" "}
              <Link href="/clients" className="underline underline-offset-2 hover:text-foreground">
                {pipeline._count} active clients
              </Link>
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-primary" /> Value added
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-chart-bar" /> Won
            </span>
          </div>
        </div>
        <TrendChart data={trend} valueLabel="Value added" barLabel="Clients won" formatValue={formatCompact} />
      </Panel>
    </div>
  );
}

export function OverviewRowSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="h-64 animate-pulse rounded-xl bg-ink/90 lg:col-span-4 xl:col-span-3" />
      <div className="h-64 animate-pulse rounded-xl border border-border bg-card lg:col-span-8 xl:col-span-9" />
    </div>
  );
}
