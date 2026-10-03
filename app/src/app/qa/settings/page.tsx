import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { HelpdeskConnection } from "./helpdesk-connection";
import { getHelpdeskSummary } from "@/lib/qa/helpdesk-summary";
import { HELPDESK_PROVIDER_OPTIONS } from "@/lib/qa/helpdesks";
import { NewSopDialog } from "./new-sop-dialog";
import { SopRowActions } from "./sop-row-actions";
import { AutoReviewPanel } from "./auto-review-panel";
import { OveragePanel } from "./overage-panel";
import { Panel } from "@/components/dashboard/panel";
import { StatTile } from "@/components/dashboard/stat-tile";
import { overageAvailability } from "@/lib/qa/usage";
import { customScorecardsAvailable } from "@/lib/qa/scorecard";
import { QA_OVERAGE } from "@/lib/billing/plans";
import { formatDateTime } from "@/lib/utils/format";
import { addDays, startOfDay } from "@/lib/utils/date-buckets";

export default async function QaSettingsPage() {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;
  const canEdit = session.user.orgRole === "OWNER" || session.user.orgRole === "ADMIN";
  const weekAgo = addDays(startOfDay(), -7);

  const [helpdesk, sops, autoConfig, subscription, jobCounts, recentSkip, scorecardsOn] = await Promise.all([
    getHelpdeskSummary(organizationId),
    prisma.sopDocument.findMany({
      where: { organizationId: session.user.organizationId },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.autoReviewConfig.findUnique({ where: { organizationId } }),
    prisma.productSubscription.findUnique({ where: { organizationId_product: { organizationId, product: "QA_SENTINEL" } } }),
    prisma.autoReviewJob.groupBy({
      by: ["status"],
      where: { organizationId, createdAt: { gte: weekAgo } },
      _count: true,
    }),
    prisma.autoReviewJob.findFirst({
      where: { organizationId, status: { in: ["SKIPPED", "FAILED"] }, createdAt: { gte: weekAgo } },
      orderBy: { processedAt: "desc" },
      select: { lastError: true },
    }),
    customScorecardsAvailable(organizationId),
  ]);
  const scorecards = scorecardsOn
    ? await prisma.scorecard.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, isDefault: true } })
    : [];
  const jobs = Object.fromEntries(jobCounts.map((j) => [j.status, j._count])) as Partial<Record<string, number>>;
  const overage = overageAvailability(subscription);

  return (
    <div className="flex flex-col gap-4">
      <Panel
        eyebrow="Integration"
        title="Helpdesk"
        description="Connect the helpdesk your team works in so QA Sentinel can read ticket conversations. Read-only, and credentials are encrypted at rest."
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

      <Panel
        eyebrow="Automation"
        title="Auto-review"
        description={
          autoConfig?.lastPolledAt
            ? `Last checked ${helpdesk?.name ?? "your helpdesk"} ${formatDateTime(autoConfig.lastPolledAt)}. Counts cover the last 7 days.`
            : `Score solved ${helpdesk?.name ?? "helpdesk"} tickets automatically, by your own sampling rules.`
        }
        bodyClassName="flex flex-col gap-5 px-5 pb-5"
      >
        {autoConfig && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Queued" value={(jobs.QUEUED ?? 0) + (jobs.PROCESSING ?? 0)} />
            <StatTile label="Reviewed" value={jobs.DONE ?? 0} tone="success" />
            <StatTile label="Skipped" value={jobs.SKIPPED ?? 0} tone={jobs.SKIPPED ? "warning" : "default"} hint={recentSkip?.lastError ?? undefined} />
            <StatTile label="Failed" value={jobs.FAILED ?? 0} tone={jobs.FAILED ? "destructive" : "default"} />
          </div>
        )}
        <AutoReviewPanel
          initial={{
            enabled: autoConfig?.enabled ?? false,
            sopId: autoConfig?.sopId ?? null,
            scorecardId: autoConfig?.scorecardId ?? null,
            samplePercent: autoConfig?.samplePercent ?? 20,
            alwaysReviewBadCsat: autoConfig?.alwaysReviewBadCsat ?? true,
            includeTags: autoConfig?.includeTags ?? [],
            excludeTags: autoConfig?.excludeTags ?? [],
          }}
          sops={sops.map((sop) => ({ id: sop.id, name: sop.name }))}
          scorecards={scorecards}
          helpdesk={helpdesk ? { name: helpdesk.name, supportsTags: helpdesk.supportsTags, supportsCsat: helpdesk.supportsCsat } : null}
          canEdit={canEdit}
        />
      </Panel>

      <Panel
        eyebrow="Billing"
        title="Overage reviews"
        description={
          subscription?.reviewQuota != null
            ? `This period: ${subscription.reviewsUsedThisPeriod} of ${subscription.reviewQuota} included reviews used${
                subscription.overageReviewsThisPeriod ? `, plus ${subscription.overageReviewsThisPeriod} overage` : ""
              }.`
            : "Your plan has unlimited reviews."
        }
        bodyClassName="px-5 pb-5"
      >
        <OveragePanel
          allowOverage={subscription?.allowOverage ?? false}
          overageCap={subscription?.overageCap ?? null}
          priceLabel={QA_OVERAGE.priceLabel}
          unavailableReason={subscription?.reviewQuota == null ? "Not needed: your plan has no review limit." : overage.reason}
          canEdit={canEdit}
        />
      </Panel>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>SOPs</CardTitle>
            <CardDescription>Standard Operating Procedures reviews are scored against.</CardDescription>
          </div>
          <NewSopDialog />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sops.map((sop) => (
                <TableRow key={sop.id}>
                  <TableCell className="font-medium">{sop.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {sop.category}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <SopRowActions sopId={sop.id} name={sop.name} category={sop.category} content={sop.content} />
                  </TableCell>
                </TableRow>
              ))}
              {sops.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    No SOPs yet. Add one to start running reviews.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
