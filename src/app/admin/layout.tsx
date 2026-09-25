import { requirePlatformAdmin } from "@/lib/auth/require-role";
import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-header";

const ADMIN_NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Organizations", icon: "organizations" },
  { href: "/dashboard", label: "Exit to app", icon: "exit-app" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePlatformAdmin();

  return (
    <SidebarProvider>
      <AppSidebar user={session.user} navItems={ADMIN_NAV_ITEMS} groupLabel="Platform Admin" />
      <SidebarInset>
        <AppHeader navItems={ADMIN_NAV_ITEMS} fallbackTitle="Platform Admin" />
        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
