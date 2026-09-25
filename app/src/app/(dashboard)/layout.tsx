import { requireProductAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import { NotificationsBell } from "@/components/notifications-bell";
import { SlaNotificationPoller } from "@/components/sla-notification-poller";
import { VerifyEmailBanner } from "@/components/verify-email-banner";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-header";
import type { Role } from "@/generated/prisma/client";

const CRM_NAV_ITEMS: (NavItem & { roles: Role[] })[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/copilot", label: "Co-pilot", icon: "copilot", roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/clients", label: "Clients", icon: "users", roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/tasks", label: "Tasks", icon: "tasks", roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/journeys", label: "Journeys", icon: "journeys", roles: ["ADMIN", "MANAGER"] },
  { href: "/reports", label: "Reports", icon: "reports", roles: ["ADMIN", "MANAGER"] },
  { href: "/settings/stages", label: "Stages", group: "Admin", icon: "stages", roles: ["ADMIN"] },
  { href: "/settings/custom-fields", label: "Custom Fields", group: "Admin", icon: "custom-fields", roles: ["ADMIN"] },
  { href: "/settings/audit-log", label: "Audit Log", group: "Admin", icon: "audit-log", roles: ["ADMIN"] },
  { href: "/settings/data", label: "Data & Privacy", group: "Admin", icon: "data", roles: ["ADMIN"] },
  { href: "/settings/templates", label: "Templates", group: "Admin", icon: "templates", roles: ["ADMIN"] },
  { href: "/settings/users", label: "Users", group: "Admin", icon: "user-cog", roles: ["ADMIN"] },
  { href: "/settings/integrations", label: "Settings", group: "Admin", icon: "settings", roles: ["ADMIN"] },
  { href: "/settings/developers", label: "Developers", group: "Admin", icon: "developers", roles: ["ADMIN"] },
  { href: "/settings/sso", label: "Single Sign-On", group: "Admin", icon: "sso", roles: ["ADMIN"] },
  { href: "/billing/CRM", label: "Billing", group: "Admin", icon: "billing", roles: ["ADMIN"] },
  { href: "/settings/account", label: "Account", group: "Reference", icon: "account", roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/help", label: "Help", group: "Reference", icon: "help", roles: ["ADMIN", "MANAGER", "RM"] },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireProductAccess("CRM");

  const [unreadCount, user] = await Promise.all([
    prisma.notification.count({ where: { userId: session.user.id, readAt: null } }),
    prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { emailVerifiedAt: true } }),
  ]);

  const navItems = CRM_NAV_ITEMS.filter((item) => item.roles.includes(session.user.role));

  return (
    <SidebarProvider>
      <AppSidebar user={session.user} navItems={navItems} groupLabel="CRM" />
      <SidebarInset>
        {!user.emailVerifiedAt && <VerifyEmailBanner />}
        <AppHeader navItems={navItems} fallbackTitle="CRM">
          <SlaNotificationPoller role={session.user.role} />
          <NotificationsBell unreadCount={unreadCount} />
        </AppHeader>
        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
