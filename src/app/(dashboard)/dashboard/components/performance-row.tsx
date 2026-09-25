import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { Panel, PanelEmpty } from "@/components/dashboard/panel";
import { ProgressStat } from "@/components/dashboard/progress-stat";
import { addDays, formatDelta, formatTime, startOfDay, startOfMonth } from "@/lib/utils/date-buckets";
import { cn } from "@/lib/utils";
import type { Prisma } from "@/generated/prisma/client";

function compare(current: number, previous: number) {
  const delta = formatDelta(current, previous);
  return {
    progress: current / Math.max(1, current, previous),
    hint: delta ? `${delta} vs last month` : previous === 0 && current > 0 ? "New this month" : "Same as last month",
  };
}

export async function PerformanceRow({ clientFilter, taskFilter }: { clientFilter: Prisma.ClientWhereInput; taskFilter: Prisma.TaskWhereInput }) {
  const now = new Date();
  const month = startOfMonth();
  const prevMonth = startOfMonth(addDays(month, -1));
  const today = startOfDay();

  const [doneNow, donePrev, wonNow, wonPrev, newNow, newPrev, schedule] = await Promise.all([
    prisma.task.count({ where: { ...taskFilter, status: "DONE", updatedAt: { gte: month } } }),
    prisma.task.count({ where: { ...taskFilter, status: "DONE", updatedAt: { gte: prevMonth, lt: month } } }),
    prisma.client.count({ where: { ...clientFilter, status: "COMPLETED", completedAt: { gte: month } } }),
    prisma.client.count({ where: { ...clientFilter, status: "COMPLETED", completedAt: { gte: prevMonth, lt: month } } }),
    prisma.client.count({ where: { ...clientFilter, createdAt: { gte: month } } }),
    prisma.client.count({ where: { ...clientFilter, createdAt: { gte: prevMonth, lt: month } } }),
    prisma.task.findMany({
      where: { ...taskFilter, status: { not: "CANCELLED" }, dueAt: { gte: today, lt: addDays(today, 1) } },
      include: { client: { select: { name: true } } },
      orderBy: { dueAt: "asc" },
      take: 6,
    }),
  ]);

  const nextId = schedule.find((t) => t.status !== "DONE" && t.dueAt >= now)?.id;

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <Panel className="lg:col-span-7" title="Performance" action={<span className="text-xs text-muted-foreground">This month</span>} bodyClassName="grid gap-6 px-5 pt-2 pb-5 sm:grid-cols-3">
        <ProgressStat label="Tasks closed" value={doneNow} {...compare(doneNow, donePrev)} />
        <ProgressStat label="Clients won" value={wonNow} {...compare(wonNow, wonPrev)} />
        <ProgressStat label="New clients" value={newNow} {...compare(newNow, newPrev)} />
      </Panel>
      <Panel
        className="lg:col-span-5"
        title="Today’s schedule"
        action={
          <Link href="/tasks" className="text-xs font-semibold text-primary hover:underline">
            All tasks
          </Link>
        }
        bodyClassName="px-3 pb-3"
      >
        {schedule.length === 0 ? (
          <PanelEmpty>Nothing scheduled for today.</PanelEmpty>
        ) : (
          <ul className="flex flex-col gap-1">
            {schedule.map((t) => (
              <li
                key={t.id}
                className={cn(
                  "flex items-center gap-4 rounded-lg px-3 py-2.5",
                  t.id === nextId && "border-l-2 border-primary bg-mist",
                  t.status === "DONE" && "opacity-55",
                )}
              >
                <span className="w-12 shrink-0 font-heading text-sm font-semibold tabular-nums">{formatTime(t.dueAt)}</span>
                <div className="min-w-0">
                  <p className={cn("truncate text-sm font-medium", t.status === "DONE" && "line-through")}>{t.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{t.client.name}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export function PerformanceRowSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="h-44 animate-pulse rounded-xl border border-border bg-card lg:col-span-7" />
      <div className="h-44 animate-pulse rounded-xl border border-border bg-card lg:col-span-5" />
    </div>
  );
}
