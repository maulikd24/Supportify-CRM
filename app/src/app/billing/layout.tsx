import { requireOrg } from "@/lib/auth/require-role";
import { firstUsableProductHome } from "@/lib/billing/status";
import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-header";
import { enforceTwoFactorPolicy } from "@/lib/security/enforce";

export default async function BillingLayout({ children }: { children: React.ReactNode }) {
  const session = await requireOrg();
  await enforceTwoFactorPolicy(session.user);

  // "Exit to app" goes to a product the org can open. With none (every trial ended), it would
  // only bounce straight back here, so it's left out until a plan is active.
  const exitHref = await firstUsableProductHome(session.user.organizationId);
  const navItems: NavItem[] = [
    { href: "/billing", label: "Overview", icon: "billing" },
    ...(exitHref ? [{ href: exitHref, label: "Exit to app", icon: "exit-app" } as NavItem] : []),
  ];

  return (
    <SidebarProvider>
      <AppSidebar user={session.user} navItems={navItems} groupLabel="Billing" />
      <SidebarInset>
        <AppHeader navItems={navItems} fallbackTitle="Billing" />
        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
