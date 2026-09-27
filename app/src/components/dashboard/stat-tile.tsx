import { cn } from "@/lib/utils";

/** Compact KPI tile: eyebrow label over a Sora number, optional hint and tone. */
export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "warning" | "destructive" | "success";
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card px-5 py-4", className)}>
      <p className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">{label}</p>
      <p
        className={cn(
          "mt-1 font-heading text-2xl font-bold tabular-nums",
          tone === "warning" && "text-warning",
          tone === "destructive" && "text-destructive",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
