import Link from "next/link";

/**
 * The dark hero tile from the Harbor reference: a large serif numeral with a
 * caption, and a strip of mini bars underneath.
 */
export function InkStatTile({
  eyebrow,
  value,
  unit,
  caption,
  detail,
  bars,
  barsLabel,
  action,
}: {
  eyebrow: string;
  value: string | number;
  unit?: string;
  caption: string;
  detail?: string;
  bars: number[];
  barsLabel: string;
  action?: { href: string; label: string };
}) {
  const max = Math.max(1, ...bars);
  return (
    <section className="flex min-h-64 flex-col justify-between overflow-hidden rounded-xl bg-ink text-ink-foreground">
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-foreground/55">{eyebrow}</p>
        {action && (
          <Link href={action.href} className="text-xs font-medium underline underline-offset-4 hover:text-ink-foreground/80">
            {action.label}
          </Link>
        )}
      </div>
      <div className="flex items-end gap-3 px-5 pt-2 pb-4">
        <p className="font-serif text-7xl leading-[0.85] tracking-tight tabular-nums">
          {value}
          {unit && <span className="ml-1 text-2xl text-ink-foreground/55">{unit}</span>}
        </p>
        <div className="pb-1">
          <p className="text-sm font-medium">{caption}</p>
          {detail && <p className="text-xs text-ink-foreground/55">{detail}</p>}
        </div>
      </div>
      <div className="border-t border-ink-foreground/10 px-5 pt-4 pb-5">
        <div role="img" aria-label={barsLabel} className="flex h-12 items-end gap-1.5">
          {bars.map((v, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm bg-primary/70"
              style={{ height: `${Math.max(8, (v / max) * 100)}%`, opacity: v === 0 ? 0.35 : 1 }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
