"use client";

import { usePathname } from "next/navigation";

import { SidebarTrigger } from "@/components/ui/sidebar";
import type { NavItem } from "@/components/app-sidebar";

/**
 * Top bar shared by every product shell. The title is derived from whichever
 * nav item matches the current route, so layouts (which can't see the page)
 * don't need per-page wiring.
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

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border/70 px-4 md:px-6">
      <SidebarTrigger className="-ml-1" />
      <p className="truncate font-heading text-sm font-semibold text-foreground">
        {active?.label ?? fallbackTitle}
      </p>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </header>
  );
}
