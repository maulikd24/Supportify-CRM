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
} as const;

export type IconKey = keyof typeof ICON_MAP;

export type NavItem = {
  href: string;
  label: string;
  icon: IconKey;
};

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
  groupLabel?: string;
}) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[var(--shadow-xs)] font-heading text-sm font-semibold">
            S
          </div>
          <span className="font-heading text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Supportify
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{groupLabel}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const Icon = ICON_MAP[item.icon];
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      isActive={pathname === item.href || pathname.startsWith(`${item.href}/`)}
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
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2 px-2 py-1">
              <Avatar className="size-6">
                <AvatarFallback className="text-[10px]">{initials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium leading-tight">{user.name}</p>
                <p className="truncate text-[10px] text-muted-foreground leading-tight">{user.orgRole}</p>
              </div>
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <form action={logoutAction}>
              <SidebarMenuButton type="submit">
                <LogOut className="size-4" />
                <span>Sign out</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
