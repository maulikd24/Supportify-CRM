import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Card shell used across the app: small uppercase eyebrow, heading, optional
 * header action, body and footer. Sizes follow the Harbor reference
 * (10px eyebrow, 15px Sora title, 13px/11px rows).
 */
export function Panel({
  eyebrow,
  title,
  description,
  action,
  footer,
  tone = "default",
  className,
  bodyClassName,
  children,
}: {
  eyebrow?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  tone?: "default" | "destructive";
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-xl border bg-card text-card-foreground",
        tone === "destructive" ? "border-destructive/40" : "border-border",
        className,
      )}
    >
      {(eyebrow || title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0">
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            {title && (
              <h2 className={cn("mt-0.5 font-heading text-[15px] font-bold", tone === "destructive" && "text-destructive")}>
                {title}
              </h2>
            )}
            {description && <p className="mt-1 max-w-prose text-xs text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
        </header>
      )}
      {children !== undefined && <div className={cn("flex-1", bodyClassName)}>{children}</div>}
      {footer && <footer className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">{footer}</footer>}
    </section>
  );
}

export function Eyebrow({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase", className)}>{children}</p>;
}

/** "All tasks ›" style link used in panel headers. */
export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-0.5 text-[11px] font-bold text-primary hover:underline">
      {children}
      <ChevronRight className="size-3.5" aria-hidden />
    </Link>
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
  href,
  hrefLabel,
}: {
  tone?: "primary" | "muted" | "destructive" | "warning" | "none";
  title: React.ReactNode;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  /** Renders the reference's bordered chevron button linking here. */
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      {tone !== "none" && (
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            tone === "primary" && "bg-primary",
            tone === "muted" && "bg-foreground/20",
            tone === "destructive" && "bg-destructive",
            tone === "warning" && "bg-warning",
          )}
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold">{title}</p>
        {meta && <p className="truncate text-[11px] text-muted-foreground">{meta}</p>}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-3 text-[11px]">{trailing}</div>}
      {href && (
        <Link
          href={href}
          aria-label={hrefLabel ?? "Open"}
          className="grid size-9 shrink-0 place-items-center rounded-md border border-border text-foreground transition-colors hover:bg-mist/60"
        >
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      )}
    </li>
  );
}

export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <p className="border-t border-border px-5 py-8 text-center text-[13px] text-muted-foreground">{children}</p>;
}

/** Small inline action link used in row trailing slots ("Do now", "Open"). */
export function RowLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-[11px] font-bold text-primary hover:underline">
      {children}
    </Link>
  );
}
