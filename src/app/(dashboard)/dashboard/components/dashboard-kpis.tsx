import { Users, UserPlus, Clock, AlertTriangle, Wallet, Trophy, CheckCircle2 } from "lucide-react";

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

type Tone = "default" | "destructive" | "warning";

const TONE_STYLES: Record<Tone, { text: string; iconWrap: string }> = {
  default: { text: "text-foreground", iconWrap: "bg-primary/10 text-primary" },
  warning: { text: "text-amber-600 dark:text-amber-400", iconWrap: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  destructive: { text: "text-destructive", iconWrap: "bg-destructive/10 text-destructive" },
};

function Kpi({
  label,
  value,
  tone = "default",
  icon: Icon,
}: {
  label: string;
  value: string | number;
  tone?: Tone;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3 px-4">
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${styles.iconWrap}`}>
          <Icon className="size-4.5" />
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`font-heading text-xl font-semibold leading-none ${styles.text}`}>{value}</p>
        </div>
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
      <Kpi label="Active Clients" value={activeClients} icon={Users} />
      <Kpi label="New Today" value={newToday} icon={UserPlus} />
      <Kpi label="Due Today" value={dueToday} tone="warning" icon={Clock} />
      <Kpi label="Overdue" value={overdueTasks} tone="destructive" icon={AlertTriangle} />
      <Kpi label="Pipeline Value" value={formatCurrency(Number(pipelineValue._sum.dealValue ?? 0))} icon={Wallet} />
      <Kpi label="Won This Month" value={wonThisMonth} icon={Trophy} />
      <Kpi label="Completed" value={completedClients} icon={CheckCircle2} />
    </div>
  );
}

export function DashboardKpisSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 7 }).map((_, i) => (
        <Card key={i} size="sm">
          <CardContent className="flex items-center gap-3 px-4">
            <div className="size-9 shrink-0 animate-pulse rounded-lg bg-muted" />
            <div className="flex flex-col gap-1.5">
              <div className="h-3 w-16 animate-pulse rounded-md bg-muted" />
              <div className="h-5 w-10 animate-pulse rounded-md bg-muted" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
