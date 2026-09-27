import { LOW_SCORE } from "@/lib/qa/score";
import { cn } from "@/lib/utils";

/** QA score (0–100) as a compact tinted chip; red below the coaching threshold. */
export function ScoreChip({ score, className }: { score: number | null; className?: string }) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex min-w-9 justify-center rounded-md px-1.5 py-0.5 font-heading text-xs font-semibold tabular-nums",
        score < LOW_SCORE ? "bg-destructive/10 text-destructive" : "bg-primary/12 text-primary",
        className,
      )}
    >
      {score}
    </span>
  );
}
