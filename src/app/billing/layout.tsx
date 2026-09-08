import { requireOrg } from "@/lib/auth/require-role";
import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

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
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card/60 px-4 backdrop-blur-sm">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="font-heading text-sm font-medium text-muted-foreground">Billing</span>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
