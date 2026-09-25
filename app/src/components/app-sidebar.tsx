"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LogOut,
  LayoutDashboard,
  Sparkles,
  Users,
  CheckSquare,
  Workflow,
  BarChart3,
  SlidersHorizontal,
  ListPlus,
  History,
  Download,
  MessageSquareText,
  UserCog,
  Settings,
  Webhook,
  ShieldCheck,
  CreditCard,
  KeyRound,
  FileSearch,
  Scale,
  Frown,
  Building2,
  ArrowLeftCircle,
  HelpCircle,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/app/(dashboard)/actions";
import type { OrgRole } from "@/generated/prisma/client";

/**
 * Icon components (lucide-react's `forwardRef`-based exports) can't safely
 * cross the server→client prop boundary — not even pre-rendered as elements.
 * So nav items only ever carry a serializable string key, and this registry
 * (which lives entirely in this "use client" file) resolves it to the real
 * component.
 */
const ICON_MAP = {
  dashboard: LayoutDashboard,
  copilot: Sparkles,
  users: Users,
  tasks: CheckSquare,
  journeys: Workflow,
  reports: BarChart3,
  stages: SlidersHorizontal,
  "custom-fields": ListPlus,
  "audit-log": History,
  data: Download,
  templates: MessageSquareText,
  "user-cog": UserCog,
  settings: Settings,
  developers: Webhook,
  sso: ShieldCheck,
  billing: CreditCard,
  account: KeyRound,
  reviews: FileSearch,
  calibration: Scale,
  dsat: Frown,
  organizations: Building2,
  "exit-app": ArrowLeftCircle,
  help: HelpCircle,
} as const;

export type IconKey = keyof typeof ICON_MAP;

export type NavItem = {
  href: string;
  label: string;
  icon: IconKey;
  /** Sidebar section heading; items without one fall under "Workspace". */
  group?: string;
};

const PRODUCTS = [
  { label: "CRM", href: "/dashboard" },
  { label: "QA Sentinel", href: "/qa" },
] as const;

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Shared shell for every product (CRM, QA Sentinel, platform admin) — each
 * caller supplies its own already-permission-filtered nav items so this
 * component stays decoupled from any one product's role model.
 */
export function AppSidebar({
  user,
  navItems,
  groupLabel = "Workspace",
}: {
  user: { name: string; email: string; orgRole: OrgRole };
  navItems: NavItem[];
  /** Product name shown under the wordmark (e.g. "CRM", "QA Sentinel"). */
  groupLabel?: string;
}) {
  const pathname = usePathname();

  // Preserve first-seen order of groups so callers control section order.
  const groups = new Map<string, NavItem[]>();
  for (const item of navItems) {
    const key = item.group ?? "Workspace";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  // Longest matching href wins, so "/qa" isn't also active on "/qa/reviews".
  const activeHref = navItems
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary font-heading text-sm font-bold text-sidebar-primary-foreground">
            S
          </div>
          <div className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
            <p className="font-heading text-[15px] font-semibold tracking-tight">Supportify</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-sidebar-muted">{groupLabel}</p>
          </div>
        </div>
        {/* Switch between products. Links go to each product's home; its layout
            redirects to billing if the org doesn't have access yet. */}
        <nav
          aria-label="Products"
          className="mx-2 grid grid-cols-2 gap-0.5 rounded-md bg-sidebar-accent p-0.5 group-data-[collapsible=icon]:hidden"
        >
          {PRODUCTS.map((product) => {
            const active = product.href === "/qa" ? pathname.startsWith("/qa") : !pathname.startsWith("/qa");
            return (
              <Link
                key={product.href}
                href={product.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-[5px] px-2 py-1.5 text-center text-xs font-medium text-sidebar-muted transition-colors hover:text-sidebar-foreground",
                  active && "bg-sidebar-badge text-sidebar-foreground",
                )}
              >
                {product.label}
              </Link>
            );
          })}
        </nav>
      </SidebarHeader>
      <SidebarContent>
        {[...groups].map(([label, items]) => (
          <SidebarGroup key={label}>
            <SidebarGroupLabel>{label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((item) => {
                  const Icon = ICON_MAP[item.icon];
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        render={<Link href={item.href} />}
                        isActive={item.href === activeHref}
                        tooltip={item.label}
                      >
                        <Icon className="size-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2.5 rounded-lg bg-sidebar-accent p-2 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0">
          <Avatar className="size-8 rounded-md after:rounded-md group-data-[collapsible=icon]:hidden">
            <AvatarFallback className="rounded-md bg-sidebar-badge text-xs font-semibold text-sidebar-foreground">
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-semibold leading-tight">{user.name}</p>
            <p className="truncate text-[11px] capitalize leading-tight text-sidebar-muted">{user.orgRole.toLowerCase()}</p>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="flex size-7 items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-sidebar-badge hover:text-sidebar-foreground"
            >
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
