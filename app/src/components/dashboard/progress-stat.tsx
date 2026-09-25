/** Big number with a green progress bar underneath, as in the "RM performance" card. */
export function ProgressStat({ label, value, progress, hint }: { label: string; value: string | number; progress: number; hint?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{value}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-mist">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
