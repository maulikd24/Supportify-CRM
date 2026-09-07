"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  UserCog,
  CheckSquare,
  Workflow,
  BarChart3,
  Settings,
  MessageSquareText,
  SlidersHorizontal,
  LogOut,
  KeyRound,
  Sparkles,
  CreditCard,
  ListPlus,
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
import type { Role } from "@/generated/prisma/client";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/copilot", label: "Co-pilot", icon: Sparkles, roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/clients", label: "Clients", icon: Users, roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/journeys", label: "Journeys", icon: Workflow, roles: ["ADMIN", "MANAGER"] },
  { href: "/reports", label: "Reports", icon: BarChart3, roles: ["ADMIN", "MANAGER"] },
  { href: "/settings/stages", label: "Stages", icon: SlidersHorizontal, roles: ["ADMIN"] },
  { href: "/settings/custom-fields", label: "Custom Fields", icon: ListPlus, roles: ["ADMIN"] },
  { href: "/settings/templates", label: "Templates", icon: MessageSquareText, roles: ["ADMIN"] },
  { href: "/settings/users", label: "Users", icon: UserCog, roles: ["ADMIN"] },
  { href: "/settings/integrations", label: "Settings", icon: Settings, roles: ["ADMIN"] },
  { href: "/billing/CRM", label: "Billing", icon: CreditCard, roles: ["ADMIN"] },
  { href: "/settings/account", label: "Account", icon: KeyRound, roles: ["ADMIN", "MANAGER", "RM"] },
];

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function AppSidebar({ user }: { user: { name: string; email: string; role: Role } }) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground font-heading text-sm font-semibold">
            S
          </div>
          <span className="font-heading text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Supportify
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.filter((item) => item.roles.includes(user.role)).map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link href={item.href} />}
                    isActive={pathname.startsWith(item.href)}
                  >
                    <item.icon className="size-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
                <p className="truncate text-[10px] text-muted-foreground leading-tight">{user.role}</p>
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
