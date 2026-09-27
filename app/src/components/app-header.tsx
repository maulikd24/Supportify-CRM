"use client";

import { usePathname } from "next/navigation";

import { SidebarTrigger } from "@/components/ui/sidebar";
import type { NavItem } from "@/components/app-sidebar";

/**
 * Sticky top bar shared by every product shell (Harbor reference: 19px Sora
 * title over a date line, actions on the right). The title comes from the nav
 * item matching the current route, so layouts need no per-page wiring.
 */
export function AppHeader({
  navItems,
  fallbackTitle,
  children,
}: {
  navItems: NavItem[];
  fallbackTitle: string;
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = navItems
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <header className="sticky top-0 z-20 flex h-[65px] shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur-sm md:px-6">
      <SidebarTrigger className="-ml-1" />
      <div className="min-w-0">
        <h1 className="truncate font-heading text-[19px] leading-tight font-extrabold">{active?.label ?? fallbackTitle}</h1>
        <p className="hidden text-xs text-muted-foreground sm:block" suppressHydrationWarning>
          {today}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </header>
  );
}
