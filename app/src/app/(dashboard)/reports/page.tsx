import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { StatTile } from "@/components/dashboard/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StageFunnelChartLoader } from "./stage-funnel-chart-loader";
import { computeSlaStatus } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import { getStageDurations } from "@/lib/reports/stage-durations";
import type { Prisma } from "@/generated/prisma/client";
import { Panel } from "@/components/dashboard/panel";
import { TableEmpty } from "@/components/page/table-empty";
import { firstResponseByRm } from "@/lib/inbox/inbox";
import { formatDuration } from "@/lib/utils/format";

export default async function ReportsPage() {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role, session.user.organizationId);
  const organizationId = session.user.organizationId;
  const clientFilter: Prisma.ClientWhereInput = visibleUserIds
    ? { organizationId, assignedToId: { in: visibleUserIds } }
    : { organizationId };
  const now = new Date();

  const [
    stages,
    clientsByStage,
    rms,
    totalLeads,
    activeClients,
    completedClients,
    notProceedingClients,
    onHoldClients,
    activeClientRows,
    completedDurations,
    stageHistoryRows,
    lostReasonRows,
    sourceRows,
    sourceCompletedRows,
    overdueTasksByRm,
  ] = await Promise.all([
    prisma.stage.findMany({ where: { organizationId, isActive: true }, orderBy: { sequence: "asc" } }),
    prisma.client.groupBy({ by: ["currentStageId"], where: clientFilter, _count: { _all: true } }),
    visibleUserIds
      ? prisma.user.findMany({ where: { id: { in: visibleUserIds }, role: "RM" }, orderBy: { name: "asc" } })
      : prisma.user.findMany({ where: { orgRole: { not: "AGENT" }, organizationId, role: "RM" }, orderBy: { name: "asc" } }),
    prisma.client.count({ where: clientFilter }),
    prisma.client.count({ where: { ...clientFilter, status: "ACTIVE" } }),
    prisma.client.count({ where: { ...clientFilter, status: "COMPLETED" } }),
    prisma.client.count({ where: { ...clientFilter, status: "NOT_PROCEEDING" } }),
    prisma.client.count({ where: { ...clientFilter, status: "ON_HOLD" } }),
    prisma.client.findMany({
      where: { ...clientFilter, status: "ACTIVE" },
      select: { id: true, assignedToId: true, currentStageId: true, stageEnteredAt: true, currentStage: { select: { slaHours: true } } },
    }),
    prisma.client.findMany({
      where: { ...clientFilter, status: "COMPLETED", completedAt: { not: null } },
      select: { assignedToId: true, createdAt: true, completedAt: true },
    }),
    prisma.stageHistory.findMany({ where: { client: clientFilter }, select: { toStageId: true, clientId: true } }),
    prisma.client.findMany({ where: { ...clientFilter, status: "NOT_PROCEEDING" }, select: { id: true } }),
    prisma.client.groupBy({ by: ["leadSource"], where: clientFilter, _count: { _all: true } }),
    prisma.client.groupBy({ by: ["leadSource"], where: { ...clientFilter, status: "COMPLETED" }, _count: { _all: true } }),
    prisma.task.groupBy({
      by: ["assignedToId"],
      where: {
        organizationId,
        ...(visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {}),
        status: { in: ["PENDING", "OVERDUE"] },
        dueAt: { lt: now },
      },
      _count: { _all: true },
    }),
  ]);

  const overdueTaskCountByRm = new Map(overdueTasksByRm.map((row) => [row.assignedToId, row._count._all]));

  const [exceptionsForActive, stageDurations] = await Promise.all([
    activeClientRows.length
      ? prisma.exception.findMany({
          where: { clientId: { in: activeClientRows.map((c) => c.id) } },
          select: { clientId: true, stageId: true, createdAt: true, resolvedAt: true },
        })
      : Promise.resolve([]),
    getStageDurations(clientFilter, stages),
  ]);

  const overdueCount = activeClientRows.filter((client) => {
    const heldMs = exceptionsForActive
      .filter((e) => e.clientId === client.id && e.stageId === client.currentStageId)
      .reduce((sum, e) => sum + Math.max(0, (e.resolvedAt ?? now).getTime() - e.createdAt.getTime()), 0);
    const status = computeSlaStatus(effectiveStageEnteredAt(client.stageEnteredAt, heldMs), client.currentStage.slaHours, now);
    return status === "OVERDUE";
  }).length;

  const slaCompliance = activeClientRows.length > 0 ? Math.round(((activeClientRows.length - overdueCount) / activeClientRows.length) * 100) : 100;

  const avgOnboardingDays =
    completedDurations.length > 0
      ? Math.round(
          (completedDurations.reduce((sum, c) => sum + (c.completedAt!.getTime() - c.createdAt.getTime()), 0) /
            completedDurations.length /
            (1000 * 60 * 60 * 24)) *
            10,
        ) / 10
      : 0;

  const countByStageId = new Map(clientsByStage.map((row) => [row.currentStageId, row._count._all]));
  const funnelData = stages.map((stage) => ({ stage: stage.name, count: countByStageId.get(stage.id) ?? 0 }));

  const reachedByStage = new Map<string, Set<string>>();
  for (const row of stageHistoryRows) {
    const set = reachedByStage.get(row.toStageId) ?? new Set<string>();
    set.add(row.clientId);
    reachedByStage.set(row.toStageId, set);
  }
  const stage1ReachedCount = stages[0] ? (reachedByStage.get(stages[0].id)?.size ?? 0) : 0;
  const conversionData = stages.map((stage) => {
    const reached = reachedByStage.get(stage.id)?.size ?? 0;
    return {
      stage: stage.name,
      reached,
      pct: stage1ReachedCount > 0 ? Math.round((reached / stage1ReachedCount) * 100) : 0,
    };
  });

  const lostClientIds = lostReasonRows.map((c) => c.id);
  const lostReasonGroups = lostClientIds.length
    ? await prisma.auditLog.groupBy({
        by: ["reason"],
        where: { entity: "Client", action: "marked_not_proceeding", entityId: { in: lostClientIds } },
        _count: { _all: true },
      })
    : [];

  const completedBySource = new Map(sourceCompletedRows.map((r) => [r.leadSource, r._count._all]));
  const sourcePerformance = sourceRows
    .map((r) => ({
      source: r.leadSource ?? "Unknown",
      total: r._count._all,
      completed: completedBySource.get(r.leadSource) ?? 0,
    }))
    .sort((a, b) => b.total - a.total);

  const responseStats = await firstResponseByRm(session.user, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
  const responders = await prisma.user.findMany({
    where: { organizationId, id: { in: responseStats.flatMap((r) => (r.userId ? [r.userId] : [])) } },
    select: { id: true, name: true },
  });
  const responderName = new Map(responders.map((u) => [u.id, u.name]));
  const responseRows = responseStats
    .map((r) => ({ ...r, name: r.userId ? (responderName.get(r.userId) ?? "Former user") : "Unassigned" }))
    .sort((a, b) => b.waitingNow - a.waitingNow || (b.medianMs ?? 0) - (a.medianMs ?? 0));

  const rmPerformance = rms.map((rm) => {
    const rmActiveRows = activeClientRows.filter((c) => c.assignedToId === rm.id);
    const rmCompleted = completedDurations.filter((c) => c.assignedToId === rm.id);
    const overdueTasks = overdueTaskCountByRm.get(rm.id) ?? 0;

    const rmOverdue = rmActiveRows.filter((client) => {
      const heldMs = exceptionsForActive
        .filter((e) => e.clientId === client.id && e.stageId === client.currentStageId)
        .reduce((sum, e) => sum + Math.max(0, (e.resolvedAt ?? now).getTime() - e.createdAt.getTime()), 0);
      const status = computeSlaStatus(effectiveStageEnteredAt(client.stageEnteredAt, heldMs), client.currentStage.slaHours, now);
      return status === "OVERDUE";
    }).length;
    const rmSlaPct = rmActiveRows.length > 0 ? Math.round(((rmActiveRows.length - rmOverdue) / rmActiveRows.length) * 100) : 100;
    const rmAvgDays =
      rmCompleted.length > 0
        ? Math.round(
            (rmCompleted.reduce((sum, c) => sum + (c.completedAt!.getTime() - c.createdAt.getTime()), 0) / rmCompleted.length / (1000 * 60 * 60 * 24)) * 10,
          ) / 10
        : 0;
    return { rm, active: rmActiveRows.length, completed: rmCompleted.length, overdueTasks, rmOverdue, rmSlaPct, rmAvgDays };
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Total leads" value={totalLeads} />
        <StatTile label="Active onboarding" value={activeClients} />
        <StatTile label="Completed" tone="success" value={completedClients} />
        <StatTile label="Not proceeding" value={notProceedingClients} />
        <StatTile label="On hold" value={onHoldClients} />
        <StatTile label="Overdue" tone="destructive" value={overdueCount} />
        <StatTile label="SLA compliance" value={`${slaCompliance}%`} />
        <StatTile label="Avg onboarding time" value={avgOnboardingDays > 0 ? `${avgOnboardingDays}d` : "—"} />
      </div>

      <Panel eyebrow="Pipeline" title="Stage Funnel">

        <div className="px-5 pb-5">
          <StageFunnelChartLoader data={funnelData} />

        </div>

      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel eyebrow="Conversion" title="Stage Conversion">
          <div className="overflow-x-auto border-t border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead>Reached</TableHead>
                  <TableHead>% of Stage 1</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conversionData.map((row) => (
                  <TableRow key={row.stage}>
                    <TableCell>{row.stage}</TableCell>
                    <TableCell>{row.reached}</TableCell>
                    <TableCell className="text-muted-foreground">{row.pct}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>

        <Panel eyebrow="Bottlenecks" title="Bottleneck Analysis">

          <div className="overflow-x-auto border-t border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead>Avg Time in Stage</TableHead>
                  <TableHead>Sample</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stageDurations.map((row) => (
                  <TableRow key={row.stageId}>
                    <TableCell>{row.stageName}</TableCell>
                    <TableCell className={row.avgHours > 72 ? "text-destructive" : ""}>
                      {row.avgHours < 24 ? `${Math.round(row.avgHours)}h` : `${Math.round((row.avgHours / 24) * 10) / 10}d`}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.sampleSize}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

          </div>

        </Panel>

        <Panel eyebrow="Losses" title="Lost Reasons">

          <div className="overflow-x-auto border-t border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reason</TableHead>
                  <TableHead>Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lostReasonGroups.map((row) => (
                  <TableRow key={row.reason ?? "unspecified"}>
                    <TableCell>{row.reason ?? "Unspecified"}</TableCell>
                    <TableCell>{row._count._all}</TableCell>
                  </TableRow>
                ))}
                {lostReasonGroups.length === 0 && (
                  <TableEmpty colSpan={2}>No clients marked not proceeding yet.</TableEmpty>
                )}
              </TableBody>
            </Table>

          </div>

        </Panel>

        <Panel eyebrow="Sources" title="Source Performance">

          <div className="overflow-x-auto border-t border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Conv. %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sourcePerformance.map((row) => (
                  <TableRow key={row.source}>
                    <TableCell>{row.source}</TableCell>
                    <TableCell>{row.total}</TableCell>
                    <TableCell>{row.completed}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.total > 0 ? Math.round((row.completed / row.total) * 100) : 0}%
                    </TableCell>
                  </TableRow>
                ))}
                {sourcePerformance.length === 0 && (
                  <TableEmpty colSpan={4}>No lead source data yet.</TableEmpty>
                )}
              </TableBody>
            </Table>

          </div>

        </Panel>
      </div>

      <Panel
        eyebrow="Inbox"
        title="First response time"
        description="Last 30 days: how long clients waited for a reply after writing in, by assigned RM."
      >
        <div className="overflow-x-auto border-t border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Assigned to</TableHead>
                <TableHead>Median first response</TableHead>
                <TableHead>Replies</TableHead>
                <TableHead>Waiting now</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {responseRows.map((r) => (
                <TableRow key={r.userId ?? "unassigned"}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.medianMs === null ? "—" : formatDuration(r.medianMs)}</TableCell>
                  <TableCell>{r.answered}</TableCell>
                  <TableCell className={r.waitingNow > 0 ? "text-destructive" : ""}>{r.waitingNow}</TableCell>
                </TableRow>
              ))}
              {responseRows.length === 0 && <TableEmpty colSpan={4}>No client messages in the last 30 days.</TableEmpty>}
            </TableBody>
          </Table>
        </div>
      </Panel>

      <Panel eyebrow="Team" title="RM Performance">

        <div className="overflow-x-auto border-t border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>RM</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead>Overdue Tasks</TableHead>
                <TableHead>SLA %</TableHead>
                <TableHead>Avg Onboarding Days</TableHead>
                <TableHead>Capacity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rmPerformance.map(({ rm, active, completed, overdueTasks, rmSlaPct, rmAvgDays }) => (
                <TableRow key={rm.id}>
                  <TableCell className="font-medium">{rm.name}</TableCell>
                  <TableCell>
                    {active}
                    {rm.capacity ? <span className="text-muted-foreground">/{rm.capacity}</span> : null}
                  </TableCell>
                  <TableCell>{completed}</TableCell>
                  <TableCell className={overdueTasks > 0 ? "text-destructive" : ""}>{overdueTasks}</TableCell>
                  <TableCell className={rmSlaPct < 80 ? "text-destructive" : ""}>{rmSlaPct}%</TableCell>
                  <TableCell>{rmAvgDays > 0 ? `${rmAvgDays}d` : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{rm.capacity ?? "—"}</TableCell>
                </TableRow>
              ))}
              {rmPerformance.length === 0 && (
                <TableEmpty colSpan={7}>No RMs to report on yet.</TableEmpty>
              )}
            </TableBody>
          </Table>

        </div>

      </Panel>
    </div>
  );
}
