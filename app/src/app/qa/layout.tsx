import { requireProductAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import { VerifyEmailBanner } from "@/components/verify-email-banner";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-header";

const QA_NAV_ITEMS: NavItem[] = [
  { href: "/qa", label: "Overview", icon: "dashboard" },
  { href: "/qa/reviews", label: "Reviews", icon: "reviews" },
  { href: "/qa/calibration", label: "Calibration", icon: "calibration" },
  { href: "/qa/agents", label: "Agents", icon: "users" },
  { href: "/qa/dsat", label: "DSAT", icon: "dsat" },
  { href: "/qa/settings", label: "Settings", group: "Admin", icon: "settings" },
  { href: "/billing/QA_SENTINEL", label: "Billing", group: "Admin", icon: "billing" },
  { href: "/qa/help", label: "Help", group: "Reference", icon: "help" },
];

export default async function QaLayout({ children }: { children: React.ReactNode }) {
  const session = await requireProductAccess("QA_SENTINEL");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { emailVerifiedAt: true } });

  return (
    <SidebarProvider>
      <AppSidebar user={session.user} navItems={QA_NAV_ITEMS} groupLabel="QA Sentinel" />
      <SidebarInset>
        {!user.emailVerifiedAt && <VerifyEmailBanner />}
        <AppHeader navItems={QA_NAV_ITEMS} fallbackTitle="QA Sentinel" />
        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
