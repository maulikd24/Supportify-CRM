
import { prisma } from "@/lib/db/prisma";
import { Panel, PanelEmpty, PanelLink, PanelList, PanelRow, RowLink } from "@/components/dashboard/panel";
import { addDays, formatAge, formatTime, startOfDay } from "@/lib/utils/date-buckets";
import { formatDate } from "@/lib/utils/format";
import type { Prisma } from "@/generated/prisma/client";
import { NextActions } from "./next-actions";

export async function ActionsRow({ taskFilter }: { taskFilter: Prisma.TaskWhereInput }) {
  const now = new Date();
  const tomorrow = addDays(startOfDay(), 1);
  const openWhere: Prisma.TaskWhereInput = { ...taskFilter, status: { in: ["PENDING", "OVERDUE"] } };
  const clientSelect = { select: { name: true, priority: true } } as const;

  const [upcoming, upcomingTotal, overdue, overdueTotal] = await Promise.all([
    prisma.task.findMany({
      where: { ...openWhere, dueAt: { gte: now } },
      include: { client: clientSelect },
      // Urgent first: high-priority clients, then soonest due.
      orderBy: [{ client: { priority: "desc" } }, { dueAt: "asc" }],
      take: 4,
    }),
    prisma.task.count({ where: { ...openWhere, dueAt: { gte: now } } }),
    prisma.task.findMany({
      where: { ...openWhere, dueAt: { lt: now } },
      include: { client: clientSelect },
      orderBy: { dueAt: "asc" },
      take: 5,
    }),
    prisma.task.count({ where: { ...openWhere, dueAt: { lt: now } } }),
  ]);

  const actions = upcoming.map((t) => ({
    id: t.id,
    title: t.title,
    clientId: t.clientId,
    clientName: t.client.name,
    dueLabel: t.dueAt < tomorrow ? formatTime(t.dueAt) : formatDate(t.dueAt),
    highPriority: t.client.priority === "HIGH",
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <NextActions actions={actions} total={upcomingTotal} />
      <Panel
        eyebrow="Service levels"
        title="Overdue follow-ups"
        action={<PanelLink href="/tasks">Review queue</PanelLink>}
        footer={`${overdueTotal} overdue · oldest first`}
      >
        {overdue.length === 0 ? (
          <PanelEmpty>No overdue follow-ups. Nice work.</PanelEmpty>
        ) : (
          <PanelList>
            {overdue.map((t) => (
              <PanelRow
                key={t.id}
                tone={t.client.priority === "HIGH" ? "destructive" : "primary"}
                title={t.title}
                meta={t.client.name}
                trailing={
                  <>
                    <span className="font-bold text-primary tabular-nums" title={`Due ${formatDate(t.dueAt)}`}>
                      {formatAge(t.dueAt, now)}
                    </span>
                    <RowLink href={`/clients/${t.clientId}`}>Do now</RowLink>
                  </>
                }
              />
            ))}
          </PanelList>
        )}
      </Panel>
    </div>
  );
}

export function ActionsRowSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[0, 1].map((i) => (
        <div key={i} className="flex h-80 flex-col gap-3 rounded-xl border border-border bg-card p-5">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-5 w-40 animate-pulse rounded bg-muted" />
          {Array.from({ length: 4 }).map((_, j) => (
            <div key={j} className="h-10 animate-pulse rounded-md bg-muted/70" />
          ))}
        </div>
      ))}
    </div>
  );
}
