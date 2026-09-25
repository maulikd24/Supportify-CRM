import { cn } from "@/lib/utils";

/**
 * Card shell used across the dashboards: small uppercase eyebrow, heading, optional
 * header action, body and footer. Matches the Harbor "command center" cards.
 */
export function Panel({
  eyebrow,
  title,
  action,
  footer,
  className,
  bodyClassName,
  children,
}: {
  eyebrow?: string;
  title?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border border-border bg-card text-card-foreground", className)}>
      {(eyebrow || title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0">
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            {title && <h2 className="mt-1 font-heading text-base font-semibold tracking-tight">{title}</h2>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn("flex-1", bodyClassName)}>{children}</div>
      {footer && <footer className="border-t border-border px-5 py-3 text-xs text-muted-foreground">{footer}</footer>}
    </section>
  );
}

export function Eyebrow({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <p className={cn("text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground", className)}>
      {children}
    </p>
  );
}

/** Divided list rows inside a Panel. */
export function PanelList({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-border border-t border-border">{children}</ul>;
}

export function PanelRow({
  tone = "muted",
  title,
  meta,
  trailing,
}: {
  tone?: "primary" | "muted" | "destructive";
  title: React.ReactNode;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          tone === "primary" && "bg-primary",
          tone === "muted" && "bg-foreground/20",
          tone === "destructive" && "bg-destructive",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        {meta && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-3 text-xs">{trailing}</div>}
    </li>
  );
}

export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <p className="border-t border-border px-5 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}
