import { notFound } from "next/navigation";

import { requireProductAccess } from "@/lib/auth/require-role";
import { cxEnabled } from "@/lib/cx/flags";
import { prisma } from "@/lib/db/prisma";
import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import { VerifyEmailBanner } from "@/components/verify-email-banner";
import { PastDueBanner } from "@/components/past-due-banner";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-header";
import { NotificationsBell } from "@/components/notifications-bell";
import { enforceTwoFactorPolicy } from "@/lib/security/enforce";

const CX_NAV_ITEMS: NavItem[] = [
  { href: "/cx", label: "Overview", icon: "dashboard" },
  { href: "/cx/topics", label: "Topics", icon: "reports" },
  { href: "/cx/conversations", label: "Conversations", icon: "reviews" },
  { href: "/cx/sources", label: "Sources", group: "Admin", icon: "developers" },
  { href: "/cx/settings", label: "Settings", group: "Admin", icon: "settings" },
  { href: "/billing/CX_INTELLIGENCE", label: "Billing", group: "Admin", icon: "billing" },
  { href: "/org/security", label: "Security & audit", group: "Organization", icon: "sso" },
  { href: "/org/account", label: "My account", group: "Organization", icon: "account" },
];

export default async function CxLayout({ children }: { children: React.ReactNode }) {
  if (!cxEnabled()) notFound();
  const session = await requireProductAccess("CX_INTELLIGENCE");
  await enforceTwoFactorPolicy(session.user);
  const { id: userId, organizationId } = session.user;
  const isOrgAdmin = session.user.orgRole === "OWNER" || session.user.orgRole === "ADMIN";
  const [user, unreadCount] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerifiedAt: true } }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  const navItems = CX_NAV_ITEMS.filter((item) => isOrgAdmin || (item.group !== "Admin" && item.href !== "/org/security"));

  return (
    <SidebarProvider>
      <AppSidebar user={session.user} navItems={navItems} groupLabel="CX Intelligence" />
      <SidebarInset>
        {!user.emailVerifiedAt && <VerifyEmailBanner />}
        <PastDueBanner organizationId={organizationId} product="CX_INTELLIGENCE" />
        <AppHeader navItems={navItems} fallbackTitle="CX Intelligence">
          <NotificationsBell unreadCount={unreadCount} />
        </AppHeader>
        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
