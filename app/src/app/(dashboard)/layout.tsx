import { requireProductAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import { NotificationsBell } from "@/components/notifications-bell";
import { SlaNotificationPoller } from "@/components/sla-notification-poller";
import { VerifyEmailBanner } from "@/components/verify-email-banner";
import { PastDueBanner } from "@/components/past-due-banner";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-header";
import { HeaderSearch } from "@/components/header-search";
import { Button } from "@/components/ui/button";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import Link from "next/link";
import { Plus } from "lucide-react";
import type { Role } from "@/generated/prisma/client";
import { enforceTwoFactorPolicy } from "@/lib/security/enforce";

const CRM_NAV_ITEMS: (NavItem & { roles: Role[] })[] = [
  { href: "/dashboard", label: "Command center", icon: "dashboard", roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/copilot", label: "Co-pilot", icon: "copilot", roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/clients", label: "Clients", icon: "users", roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/tasks", label: "Tasks", icon: "tasks", roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/journeys", label: "Journeys", icon: "journeys", roles: ["ADMIN", "MANAGER"] },
  { href: "/reports", label: "Reports", icon: "reports", roles: ["ADMIN", "MANAGER"] },
  { href: "/settings/stages", label: "Stages", group: "Admin", icon: "stages", roles: ["ADMIN"] },
  { href: "/settings/custom-fields", label: "Custom Fields", group: "Admin", icon: "custom-fields", roles: ["ADMIN"] },
  { href: "/settings/data", label: "Data & Privacy", group: "Admin", icon: "data", roles: ["ADMIN"] },
  { href: "/settings/templates", label: "Templates", group: "Admin", icon: "templates", roles: ["ADMIN"] },
  { href: "/settings/users", label: "Users", group: "Admin", icon: "user-cog", roles: ["ADMIN"] },
  { href: "/settings/integrations", label: "Settings", group: "Admin", icon: "settings", roles: ["ADMIN"] },
  { href: "/settings/developers", label: "Developers", group: "Admin", icon: "developers", roles: ["ADMIN"] },
  { href: "/billing/CRM", label: "Billing", group: "Admin", icon: "billing", roles: ["ADMIN"] },
  { href: "/org/security", label: "Security & audit", group: "Organization", icon: "sso", roles: ["ADMIN"] },
  { href: "/org/account", label: "My account", group: "Organization", icon: "account", roles: ["ADMIN", "MANAGER", "RM", "DEALER"] },
  { href: "/help", label: "Help", group: "Reference", icon: "help", roles: ["ADMIN", "MANAGER", "RM"] },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireProductAccess("CRM");
  await enforceTwoFactorPolicy(session.user);

  const { id: userId, role, organizationId } = session.user;
  const visibleUserIds = await getVisibleUserIds(userId, role, organizationId);
  const scope = visibleUserIds ? { organizationId, assignedToId: { in: visibleUserIds } } : { organizationId };

  const [unreadCount, user, activeClients, myOpenTasks] = await Promise.all([
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerifiedAt: true } }),
    prisma.client.count({ where: { ...scope, status: "ACTIVE", mergedIntoId: null } }),
    prisma.task.count({ where: { organizationId, assignedToId: userId, status: { in: ["PENDING", "OVERDUE"] } } }),
  ]);

  const badges: Record<string, number> = { "/clients": activeClients, "/tasks": myOpenTasks };
  const navItems = CRM_NAV_ITEMS.filter((item) => item.roles.includes(role)).map((item) => ({
    ...item,
    badge: badges[item.href],
  }));

  return (
    <SidebarProvider>
      <AppSidebar user={session.user} navItems={navItems} groupLabel="CRM" />
      <SidebarInset>
        {!user.emailVerifiedAt && <VerifyEmailBanner />}
        <PastDueBanner organizationId={organizationId} product="CRM" />
        <AppHeader navItems={navItems} fallbackTitle="CRM">
          <SlaNotificationPoller role={role} />
          <HeaderSearch action="/clients" placeholder="Search clients" />
          <NotificationsBell unreadCount={unreadCount} />
          <Button render={<Link href="/clients?new=1" />} className="hidden sm:inline-flex">
            <Plus /> New client
          </Button>
        </AppHeader>
        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
