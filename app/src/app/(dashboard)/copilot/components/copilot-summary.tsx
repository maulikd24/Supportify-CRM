import { StatTile } from "@/components/dashboard/stat-tile";
import type { WorklistSummary } from "@/lib/copilot/worklist";

export function CopilotSummary({ summary }: { summary: WorklistSummary }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatTile label="Critical" value={summary.critical} tone="destructive" hint="Need action today" />
      <StatTile label="At risk" value={summary.atRisk} tone="warning" hint="Slipping on SLA or health" />
      <StatTile label="Disengaged" value={summary.disengaged} tone="warning" hint="No recent activity" />
    </div>
  );
}

export function CopilotSummarySkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl border border-border bg-card px-5 py-4">
          <div className="h-3 w-20 animate-pulse rounded-md bg-muted" />
          <div className="h-7 w-10 animate-pulse rounded-md bg-muted" />
        </div>
      ))}
    </div>
  );
}
