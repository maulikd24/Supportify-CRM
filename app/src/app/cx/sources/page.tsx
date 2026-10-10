import { requireProductAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Panel } from "@/components/dashboard/panel";
import { getHelpdeskSummary } from "@/lib/qa/helpdesk-summary";
import { HELPDESK_PROVIDER_OPTIONS } from "@/lib/qa/helpdesks";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { HelpdeskConnection } from "@/app/qa/settings/helpdesk-connection";
import { HelpdeskImport } from "./helpdesk-import";

export default async function CxSourcesPage() {
  const session = await requireProductAccess("CX_INTELLIGENCE");
  const organizationId = session.user.organizationId;
  const canEdit = session.user.orgRole === "OWNER" || session.user.orgRole === "ADMIN";

  const [helpdesk, sources, sub] = await Promise.all([
    getHelpdeskSummary(organizationId),
    prisma.cxSource.findMany({ where: { organizationId, type: "HELPDESK" }, orderBy: { createdAt: "asc" } }),
    prisma.productSubscription.findUnique({
      where: { organizationId_product: { organizationId, product: "CX_INTELLIGENCE" } },
      select: { status: true },
    }),
  ]);
  const counts = async (sourceId: string) => {
    const [conversations, queued, failed] = await Promise.all([
      prisma.conversation.count({ where: { organizationId, sourceId } }),
      prisma.cxIngestJob.count({ where: { sourceId, status: { in: ["QUEUED", "PROCESSING"] } } }),
      prisma.cxIngestJob.count({ where: { sourceId, status: "FAILED" } }),
    ]);
    return { conversations, queued, failed };
  };

  const current = helpdesk ? sources.find((s) => s.provider === helpdesk.id) ?? null : null;
  const earlier = await Promise.all(
    sources.filter((s) => s.id !== current?.id).map(async (s) => ({ ...s, conversations: (await counts(s.id)).conversations })),
  );

  return (
    <div className="flex flex-col gap-4">
      <Panel
        eyebrow="Sources"
        title="Helpdesk"
        description="The same connection QA Sentinel uses, if you have it. Changing it here changes it there. Read-only, and credentials are encrypted at rest."
        bodyClassName="px-5 pb-5"
      >
        <HelpdeskConnection
          providers={HELPDESK_PROVIDER_OPTIONS}
          connection={
            helpdesk
              ? { provider: helpdesk.id, accountLabel: helpdesk.accountLabel, isValid: helpdesk.isValid, lastCheckedLabel: helpdesk.lastCheckedAt ? formatDateTime(helpdesk.lastCheckedAt) : null }
              : null
          }
          canEdit={canEdit}
        />
      </Panel>

      {helpdesk && (
        <Panel eyebrow="Sources" title={`Import from ${helpdesk.name}`}>
          <HelpdeskImport
            helpdeskName={helpdesk.name}
            canEdit={canEdit}
            trial={sub?.status === "TRIALING"}
            source={
              current
                ? {
                    id: current.id,
                    label: current.label,
                    status: current.status,
                    lastError: current.lastError,
                    lastSyncedLabel: current.lastSyncedAt ? formatDateTime(current.lastSyncedAt) : null,
                    backfillFromLabel: current.backfillFrom ? formatDate(current.backfillFrom) : null,
                    ...(await counts(current.id)),
                  }
                : null
            }
          />
        </Panel>
      )}

      {earlier.length > 0 && (
        <Panel eyebrow="Sources" title="Earlier helpdesks">
          <ul className="flex flex-col gap-1 border-t border-border p-5 text-sm">
            {earlier.map((s) => (
              <li key={s.id} className="flex justify-between gap-2">
                <span>{s.label}</span>
                <span className="text-muted-foreground">{s.conversations.toLocaleString("en-IN")} conversations kept, not importing</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel eyebrow="Sources" title="Surveys, reviews, calls and bots">
        <p className="border-t border-border p-5 text-sm text-muted-foreground">
          NPS and CSAT surveys, app store and public reviews, call recordings and chatbot transcripts arrive in a later release.
        </p>
      </Panel>
    </div>
  );
}
