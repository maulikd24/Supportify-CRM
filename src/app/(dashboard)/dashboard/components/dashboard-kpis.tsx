import { prisma } from "@/lib/db/prisma";
import { Card, CardContent } from "@/components/ui/card";
import type { Prisma } from "@/generated/prisma/client";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: "default" | "destructive" | "warning" }) {
  const toneClass =
    tone === "destructive" ? "text-destructive" : tone === "warning" ? "text-amber-600 dark:text-amber-400" : "text-foreground";
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1 px-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`font-heading text-2xl font-semibold ${toneClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

export async function DashboardKpis({ clientFilter, taskFilter }: { clientFilter: Prisma.ClientWhereInput; taskFilter: Prisma.TaskWhereInput }) {
  const today = startOfToday();
  const month = startOfMonth();
  const now = new Date();

  const [activeClients, newToday, completedClients, wonThisMonth, dueToday, overdueTasks, pipelineValue] =
    await Promise.all([
      prisma.client.count({ where: { ...clientFilter, status: "ACTIVE" } }),
      prisma.client.count({ where: { ...clientFilter, createdAt: { gte: today } } }),
      prisma.client.count({ where: { ...clientFilter, status: "COMPLETED" } }),
      prisma.client.count({ where: { ...clientFilter, status: "COMPLETED", completedAt: { gte: month } } }),
      prisma.task.count({ where: { ...taskFilter, status: "PENDING", dueAt: { gte: today, lt: new Date(today.getTime() + 86400000) } } }),
      prisma.task.count({ where: { ...taskFilter, status: { in: ["PENDING", "OVERDUE"] }, dueAt: { lt: now } } }),
      prisma.client.aggregate({ where: { ...clientFilter, status: "ACTIVE" }, _sum: { dealValue: true } }),
    ]);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Kpi label="Active Clients" value={activeClients} />
      <Kpi label="New Today" value={newToday} />
      <Kpi label="Due Today" value={dueToday} tone="warning" />
      <Kpi label="Overdue" value={overdueTasks} tone="destructive" />
      <Kpi label="Pipeline Value" value={formatCurrency(Number(pipelineValue._sum.dealValue ?? 0))} />
      <Kpi label="Won This Month" value={wonThisMonth} />
      <Kpi label="Completed" value={completedClients} />
    </div>
  );
}

export function DashboardKpisSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 7 }).map((_, i) => (
        <Card key={i} size="sm">
          <CardContent className="flex flex-col gap-2 px-4">
            <div className="h-3 w-20 animate-pulse rounded-md bg-muted" />
            <div className="h-7 w-10 animate-pulse rounded-md bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
