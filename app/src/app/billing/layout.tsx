import { requireOrg } from "@/lib/auth/require-role";
import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-header";

const BILLING_NAV_ITEMS: NavItem[] = [
  { href: "/billing", label: "Overview", icon: "billing" },
  { href: "/", label: "Exit to app", icon: "exit-app" },
];

export default async function BillingLayout({ children }: { children: React.ReactNode }) {
  const session = await requireOrg();

  return (
    <SidebarProvider>
      <AppSidebar user={session.user} navItems={BILLING_NAV_ITEMS} groupLabel="Billing" />
      <SidebarInset>
        <AppHeader navItems={BILLING_NAV_ITEMS} fallbackTitle="Billing" />
        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
