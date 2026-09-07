import { requireProductAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationsBell } from "@/components/notifications-bell";
import { SlaNotificationPoller } from "@/components/sla-notification-poller";
import { VerifyEmailBanner } from "@/components/verify-email-banner";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireProductAccess("CRM");

  const [unreadCount, user] = await Promise.all([
    prisma.notification.count({ where: { userId: session.user.id, readAt: null } }),
    prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { emailVerifiedAt: true } }),
  ]);

  return (
    <SidebarProvider>
      <AppSidebar user={session.user} />
      <SidebarInset>
        {!user.emailVerifiedAt && <VerifyEmailBanner />}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="ml-auto">
            <SlaNotificationPoller role={session.user.role} />
            <NotificationsBell unreadCount={unreadCount} />
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
