import { Suspense } from "react";

import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { OverviewRow, OverviewRowSkeleton } from "./components/overview-row";
import { ActionsRow, ActionsRowSkeleton } from "./components/actions-row";
import { PerformanceRow, PerformanceRowSkeleton } from "./components/performance-row";

export default async function DashboardPage() {
  const session = await requireUser();
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role, session.user.organizationId);
  const orgFilter = { organizationId: session.user.organizationId };
  const clientFilter = visibleUserIds ? { ...orgFilter, assignedToId: { in: visibleUserIds } } : orgFilter;
  const taskFilter = visibleUserIds ? { ...orgFilter, assignedToId: { in: visibleUserIds } } : orgFilter;

  return (
    <div className="flex flex-col gap-4">
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
