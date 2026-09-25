import { Suspense } from "react";

import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { prisma } from "@/lib/db/prisma";
import { addDays, startOfDay } from "@/lib/utils/date-buckets";
import { OverviewRow, OverviewRowSkeleton } from "./components/overview-row";
import { ActionsRow, ActionsRowSkeleton } from "./components/actions-row";
import { PerformanceRow, PerformanceRowSkeleton } from "./components/performance-row";

export default async function DashboardPage() {
  const session = await requireUser();
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role, session.user.organizationId);
  const orgFilter = { organizationId: session.user.organizationId };
  const clientFilter = visibleUserIds ? { ...orgFilter, assignedToId: { in: visibleUserIds } } : orgFilter;
  const taskFilter = visibleUserIds ? { ...orgFilter, assignedToId: { in: visibleUserIds } } : orgFilter;

  const today = startOfDay();
  const dueToday = await prisma.task.count({
    where: { ...taskFilter, status: { in: ["PENDING", "OVERDUE"] }, dueAt: { gte: today, lt: addDays(today, 1) } },
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Command center</h1>
        <p className="text-sm text-muted-foreground">
          {today.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })} · {dueToday} action
          {dueToday === 1 ? "" : "s"} due today
        </p>
      </div>

      <Suspense fallback={<OverviewRowSkeleton />}>
        <OverviewRow clientFilter={clientFilter} taskFilter={taskFilter} />
      </Suspense>
      <Suspense fallback={<ActionsRowSkeleton />}>
        <ActionsRow taskFilter={taskFilter} />
      </Suspense>
      <Suspense fallback={<PerformanceRowSkeleton />}>
        <PerformanceRow clientFilter={clientFilter} taskFilter={taskFilter} />
      </Suspense>
    </div>
  );
}
