import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelEmpty, PanelList, PanelRow } from "@/components/dashboard/panel";
import { qaGrowthFeaturesAvailable } from "@/lib/qa/plan-features";
import { reviewCriteria } from "@/lib/qa/scorecard";
import { formatDate } from "@/lib/utils/format";
import type { DisputeStatus } from "@/generated/prisma/client";
import { GrowthUpsell } from "../growth-upsell";

const STATUS_BADGE: Record<DisputeStatus, { label: string; variant: "warning" | "secondary" | "success" }> = {
  OPEN: { label: "Open", variant: "warning" },
  UPHELD: { label: "Upheld", variant: "secondary" },
  ADJUSTED: { label: "Adjusted", variant: "success" },
};

export default async function DisputesPage() {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;
  const isAdmin = session.user.orgRole === "OWNER" || session.user.orgRole === "ADMIN";
  // Admins see every dispute; others see the ones they raised.
  const scope = { organizationId, ...(isAdmin ? {} : { raisedById: session.user.id }) };
  const include = {
    raisedBy: { select: { name: true } },
    resolvedBy: { select: { name: true } },
    review: { select: { id: true, ticketId: true, ticketSubject: true, agentName: true, scorecardSnapshot: true } },
  } as const;

  const [available, open, resolved] = await Promise.all([
    qaGrowthFeaturesAvailable(organizationId),
    prisma.reviewDispute.findMany({ where: { ...scope, status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 100, include }),
    prisma.reviewDispute.findMany({ where: { ...scope, status: { not: "OPEN" } }, orderBy: { resolvedAt: "desc" }, take: 50, include }),
  ]);

  const criterionLabel = (d: (typeof open)[number]) =>
    d.criterionKey ? (reviewCriteria(d.review.scorecardSnapshot).find((c) => c.key === d.criterionKey)?.label ?? d.criterionKey) : "Overall score";

  return (
    <div className="flex flex-col gap-4">
      <Panel
        eyebrow="Quality"
        title={isAdmin ? "Disputes to resolve" : "My disputes"}
        description="Anyone on the team can dispute a score from the review page. Owners and admins uphold or adjust it, and every change is kept in the audit log."
      >
        {!available && open.length === 0 && resolved.length === 0 && <GrowthUpsell feature="Score disputes" canUpgrade={isAdmin} />}
        {open.length === 0 ? (
          <PanelEmpty>No open disputes.</PanelEmpty>
        ) : (
          <PanelList>
            {open.map((d) => (
              <PanelRow
                key={d.id}
                tone="warning"
                title={
                  <>
                    {d.review.ticketSubject || `Ticket #${d.review.ticketId}`} <span className="font-normal text-muted-foreground">· {criterionLabel(d)}</span>
                  </>
                }
                meta={`${d.raisedBy.name} · ${formatDate(d.createdAt)} · “${d.reason.length > 120 ? `${d.reason.slice(0, 120)}…` : d.reason}”`}
                trailing={<Badge variant="warning">Open</Badge>}
                href={`/qa/reviews/${d.review.id}#disputes`}
                hrefLabel={isAdmin ? "Review and resolve" : "Open review"}
              />
            ))}
          </PanelList>
        )}
      </Panel>

      {resolved.length > 0 && (
        <Panel eyebrow="History" title="Resolved">
          <PanelList>
            {resolved.map((d) => {
              const badge = STATUS_BADGE[d.status];
              const change = d.status === "ADJUSTED" && d.originalScore != null && d.adjustedScore != null ? ` · ${d.originalScore} → ${d.adjustedScore}` : "";
              return (
                <PanelRow
                  key={d.id}
                  tone="muted"
                  title={
                    <>
                      {d.review.ticketSubject || `Ticket #${d.review.ticketId}`} <span className="font-normal text-muted-foreground">· {criterionLabel(d)}</span>
                    </>
                  }
                  meta={`Raised by ${d.raisedBy.name} · resolved by ${d.resolvedBy?.name ?? "—"}${d.resolvedAt ? ` on ${formatDate(d.resolvedAt)}` : ""}${change}`}
                  trailing={<Badge variant={badge.variant}>{badge.label}</Badge>}
                  href={`/qa/reviews/${d.review.id}#disputes`}
                  hrefLabel="Open review"
                />
              );
            })}
          </PanelList>
        </Panel>
      )}
    </div>
  );
}
