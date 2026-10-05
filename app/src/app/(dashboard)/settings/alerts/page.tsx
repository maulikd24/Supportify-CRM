import { requireRole } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { slackConfigured } from "@/lib/alerts/slack";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertChannelsPanel } from "./alert-channels-panel";

const SLACK_OUTCOME: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Slack channel connected. It receives SLA breaches; choose more alert types below." },
  cancelled: { ok: false, text: "Slack connection was cancelled." },
  invalid: { ok: false, text: "That Slack connection link expired or wasn't started here. Try Add to Slack again." },
  failed: { ok: false, text: "Slack didn't complete the connection. Try again." },
  unavailable: { ok: false, text: "Slack isn't set up on this Supportify installation yet." },
};

export default async function AlertSettingsPage({ searchParams }: { searchParams: Promise<{ slack?: string }> }) {
  const session = await requireRole(["ADMIN"]);
  const { slack } = await searchParams;
  const outcome = slack ? SLACK_OUTCOME[slack] : undefined;

  const channels = await prisma.alertChannel.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      name: true,
      alertTypes: true,
      isActive: true,
      lastError: true,
      deliveries: {
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { id: true, alertType: true, alertCount: true, success: true, statusCode: true, error: true, createdAt: true },
      },
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">Settings</p>
        <p className="mt-1 max-w-prose text-xs text-muted-foreground">
          Send SLA breaches and other alerts to the Slack or Microsoft Teams channels your team already watches.
          Messages include the client&apos;s name, stage and RM with a link back here, never phone numbers or emails.
        </p>
      </div>

      {outcome && (
        <p role="status" className={outcome.ok ? "text-sm text-emerald-700 dark:text-emerald-400" : "text-sm text-destructive"}>
          {outcome.text}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Team alerts</CardTitle>
          <CardDescription>
            Each channel gets the alert types you tick. When more than five of one type arrive at once, they come as
            a single summary message. A channel that fails three deliveries in a row is switched off and admins are told.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertChannelsPanel
            slackAvailable={slackConfigured()}
            channels={channels.map((c) => ({ ...c, alertTypes: Array.isArray(c.alertTypes) ? (c.alertTypes as string[]) : [] }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
