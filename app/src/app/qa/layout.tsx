import { requireProductAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import { VerifyEmailBanner } from "@/components/verify-email-banner";
import { PastDueBanner } from "@/components/past-due-banner";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-header";
import { HeaderSearch } from "@/components/header-search";
import { NotificationsBell } from "@/components/notifications-bell";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus } from "lucide-react";
import { enforceTwoFactorPolicy } from "@/lib/security/enforce";

const QA_NAV_ITEMS: NavItem[] = [
  { href: "/qa", label: "Overview", icon: "dashboard" },
  { href: "/qa/reviews", label: "Reviews", icon: "reviews" },
  { href: "/qa/calibration", label: "Calibration", icon: "calibration" },
  { href: "/qa/agents", label: "Agents", icon: "users" },
  { href: "/qa/coaching", label: "Coaching", icon: "coaching" },
  { href: "/qa/disputes", label: "Disputes", icon: "disputes" },
  { href: "/qa/dsat", label: "DSAT", icon: "dsat" },
  { href: "/qa/scorecards", label: "Scorecards", group: "Admin", icon: "scorecards" },
  { href: "/qa/settings", label: "Settings", group: "Admin", icon: "settings" },
  { href: "/billing/QA_SENTINEL", label: "Billing", group: "Admin", icon: "billing" },
  { href: "/org/security", label: "Security & audit", group: "Organization", icon: "sso" },
  { href: "/org/account", label: "My account", group: "Organization", icon: "account" },
  { href: "/qa/help", label: "Help", group: "Reference", icon: "help" },
];

export default async function QaLayout({ children }: { children: React.ReactNode }) {
  const session = await requireProductAccess("QA_SENTINEL");
  await enforceTwoFactorPolicy(session.user);
  const { id: userId, organizationId } = session.user;
  const isOrgAdmin = session.user.orgRole === "OWNER" || session.user.orgRole === "ADMIN";
  const [user, unreadCount, awaitingCalibration, myOpenCoaching, openDisputes] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerifiedAt: true } }),
    prisma.notification.count({ where: { userId, readAt: null } }),
    // Open calibration sessions this user hasn't submitted a score for yet.
    prisma.calibrationSession.count({
      where: { organizationId, status: "OPEN", entries: { none: { reviewerId: userId, submittedAt: { not: null } } } },
    }),
    prisma.coachingSession.count({ where: { organizationId, coachId: userId, status: { in: ["ASSIGNED", "ACKNOWLEDGED"] } } }),
    // Admins resolve disputes; everyone else tracks the ones they raised.
    prisma.reviewDispute.count({ where: { organizationId, status: "OPEN", ...(isOrgAdmin ? {} : { raisedById: userId }) } }),
  ]);
  const badges: Record<string, number> = { "/qa/calibration": awaitingCalibration, "/qa/coaching": myOpenCoaching, "/qa/disputes": openDisputes };
  const navItems = QA_NAV_ITEMS.filter((item) => isOrgAdmin || item.href !== "/org/security").map((item) =>
    item.href in badges ? { ...item, badge: badges[item.href] } : item,
  );

  return (
    <SidebarProvider>
      <AppSidebar user={session.user} navItems={navItems} groupLabel="QA Sentinel" />
      <SidebarInset>
        {!user.emailVerifiedAt && <VerifyEmailBanner />}
        <PastDueBanner organizationId={organizationId} product="QA_SENTINEL" />
        <AppHeader navItems={navItems} fallbackTitle="QA Sentinel">
          <HeaderSearch action="/qa/reviews" placeholder="Search reviews" />
          <NotificationsBell unreadCount={unreadCount} />
          <Button render={<Link href="/qa/reviews?new=1" />} className="hidden sm:inline-flex">
            <Plus /> New review
          </Button>
        </AppHeader>
        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
