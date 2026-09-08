import { requireProductAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import { NotificationsBell } from "@/components/notifications-bell";
import { SlaNotificationPoller } from "@/components/sla-notification-poller";
import { VerifyEmailBanner } from "@/components/verify-email-banner";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import type { Role } from "@/generated/prisma/client";

const CRM_NAV_ITEMS: (NavItem & { roles: Role[] })[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/copilot", label: "Co-pilot", icon: "copilot", roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/clients", label: "Clients", icon: "users", roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/tasks", label: "Tasks", icon: "tasks", roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/journeys", label: "Journeys", icon: "journeys", roles: ["ADMIN", "MANAGER"] },
  { href: "/reports", label: "Reports", icon: "reports", roles: ["ADMIN", "MANAGER"] },
  { href: "/settings/stages", label: "Stages", icon: "stages", roles: ["ADMIN"] },
  { href: "/settings/custom-fields", label: "Custom Fields", icon: "custom-fields", roles: ["ADMIN"] },
  { href: "/settings/audit-log", label: "Audit Log", icon: "audit-log", roles: ["ADMIN"] },
  { href: "/settings/data", label: "Data & Privacy", icon: "data", roles: ["ADMIN"] },
  { href: "/settings/templates", label: "Templates", icon: "templates", roles: ["ADMIN"] },
  { href: "/settings/users", label: "Users", icon: "user-cog", roles: ["ADMIN"] },
  { href: "/settings/integrations", label: "Settings", icon: "settings", roles: ["ADMIN"] },
  { href: "/settings/developers", label: "Developers", icon: "developers", roles: ["ADMIN"] },
  { href: "/settings/sso", label: "Single Sign-On", icon: "sso", roles: ["ADMIN"] },
  { href: "/billing/CRM", label: "Billing", icon: "billing", roles: ["ADMIN"] },
  { href: "/settings/account", label: "Account", icon: "account", roles: ["ADMIN", "MANAGER", "RM"] },
  { href: "/help", label: "Help", icon: "help", roles: ["ADMIN", "MANAGER", "RM"] },
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
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card/60 px-4 backdrop-blur-sm">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="ml-auto flex items-center gap-1">
            <SlaNotificationPoller role={session.user.role} />
            <NotificationsBell unreadCount={unreadCount} />
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
