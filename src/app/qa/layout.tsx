import { requireProductAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import { VerifyEmailBanner } from "@/components/verify-email-banner";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

const QA_NAV_ITEMS: NavItem[] = [
  { href: "/qa", label: "Overview", icon: "dashboard" },
  { href: "/qa/reviews", label: "Reviews", icon: "reviews" },
  { href: "/qa/calibration", label: "Calibration", icon: "calibration" },
  { href: "/qa/agents", label: "Agents", icon: "users" },
  { href: "/qa/dsat", label: "DSAT", icon: "dsat" },
  { href: "/qa/settings", label: "Settings", icon: "settings" },
  { href: "/billing/QA_SENTINEL", label: "Billing", icon: "billing" },
];

export default async function QaLayout({ children }: { children: React.ReactNode }) {
  const session = await requireProductAccess("QA_SENTINEL");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { emailVerifiedAt: true } });

  return (
    <SidebarProvider>
      <AppSidebar user={session.user} navItems={QA_NAV_ITEMS} groupLabel="QA Sentinel" />
      <SidebarInset>
        {!user.emailVerifiedAt && <VerifyEmailBanner />}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card/60 px-4 backdrop-blur-sm">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="font-heading text-sm font-medium text-muted-foreground">QA Sentinel</span>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
