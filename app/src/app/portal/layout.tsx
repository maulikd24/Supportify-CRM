import { requireAgent } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-header";
import { NotificationsBell } from "@/components/notifications-bell";
import { Panel } from "@/components/dashboard/panel";
import { enforceTwoFactorPolicy } from "@/lib/security/enforce";
import { getProductAccess } from "@/lib/billing/access";
import { qaGrowthFeaturesAvailable } from "@/lib/qa/plan-features";
import { agentIdentity } from "@/lib/qa/portal";

/** Agent portal: a QA agent's own scores, coaching and disputes. Only orgRole AGENT gets here. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAgent();
  await enforceTwoFactorPolicy(session.user);
  const { organizationId } = session.user;

  const [access, available, unreadCount, agent] = await Promise.all([
    getProductAccess(organizationId, "QA_SENTINEL"),
    qaGrowthFeaturesAvailable(organizationId),
    prisma.notification.count({ where: { userId: session.user.id, readAt: null } }),
    agentIdentity(session.user.id, organizationId),
  ]);
  const openCoaching = await prisma.coachingSession.count({
    where: { organizationId, agentEmail: { in: agent.emails }, status: "ASSIGNED" },
  });
  const navItems: NavItem[] = [
    { href: "/portal", label: "My scores", icon: "dashboard" },
    { href: "/portal/coaching", label: "Coaching", icon: "coaching", badge: openCoaching },
    { href: "/org/account", label: "My account", group: "Account", icon: "account" },
  ];

  return (
    <SidebarProvider>
      <AppSidebar user={session.user} navItems={navItems} groupLabel="Agent portal" />
      <SidebarInset>
        <AppHeader navItems={navItems} fallbackTitle="Agent portal">
          <NotificationsBell unreadCount={unreadCount} />
        </AppHeader>
        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">
          {access.allowed && available ? (
            children
          ) : (
            <Panel eyebrow="Agent portal" title="The portal isn't available right now" bodyClassName="px-5 pb-5">
              <p className="max-w-prose text-[13px] text-muted-foreground">
                Your organization&apos;s QA Sentinel plan doesn&apos;t currently include the agent portal. Ask your QA admin for details.
              </p>
            </Panel>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
