import { Card, CardContent } from "@/components/ui/card";
import type { WorklistSummary } from "@/lib/copilot/worklist";

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "default" | "destructive" | "warning" }) {
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

export function CopilotSummary({ summary }: { summary: WorklistSummary }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <Kpi label="Critical" value={summary.critical} tone="destructive" />
      <Kpi label="At Risk" value={summary.atRisk} tone="warning" />
      <Kpi label="Disengaged" value={summary.disengaged} tone="warning" />
    </div>
  );
}

export function CopilotSummarySkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
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
