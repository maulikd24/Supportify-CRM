import { OverviewRowSkeleton } from "./components/overview-row";
import { ActionsRowSkeleton } from "./components/actions-row";
import { PerformanceRowSkeleton } from "./components/performance-row";

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded-md bg-muted" />
      </div>
      <OverviewRowSkeleton />
      <ActionsRowSkeleton />
      <PerformanceRowSkeleton />
    </div>
  );
}
