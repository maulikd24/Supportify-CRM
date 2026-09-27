import { OverviewRowSkeleton } from "./components/overview-row";
import { ActionsRowSkeleton } from "./components/actions-row";
import { PerformanceRowSkeleton } from "./components/performance-row";

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-4">
      <OverviewRowSkeleton />
      <ActionsRowSkeleton />
      <PerformanceRowSkeleton />
    </div>
  );
}
