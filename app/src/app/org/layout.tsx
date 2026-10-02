import { requireOrg } from "@/lib/auth/require-role";
import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-header";

const MEMBER_NAV: NavItem[] = [{ href: "/org/account", label: "My account", icon: "account" }];
const ADMIN_NAV: NavItem[] = [
  { href: "/org/security", label: "Security", icon: "sso", group: "Organization" },
  { href: "/org/sso", label: "Single sign-on", icon: "account", group: "Organization" },
  { href: "/org/audit-log", label: "Audit log", icon: "audit-log", group: "Organization" },
  { href: "/billing", label: "Billing", icon: "billing", group: "Organization" },
];
const EXIT_NAV: NavItem[] = [{ href: "/", label: "Back to app", icon: "exit-app", group: "Navigate" }];

/**
 * Product-neutral organization area (account, security, audit log) so it works
 * for CRM-only, QA-only and two-product organizations alike. Deliberately does
 * not enforce the 2FA policy, so members can set 2FA up here.
 */
export default async function OrganizationLayout({ children }: { children: React.ReactNode }) {
  const session = await requireOrg();
  const isAdmin = session.user.orgRole === "OWNER" || session.user.orgRole === "ADMIN";
  const navItems = [...MEMBER_NAV, ...(isAdmin ? ADMIN_NAV : []), ...EXIT_NAV];

  return (
    <SidebarProvider>
      <AppSidebar user={session.user} navItems={navItems} groupLabel="Organization" />
      <SidebarInset>
        <AppHeader navItems={navItems} fallbackTitle="Organization" />
        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
