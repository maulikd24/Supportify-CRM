import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StageFunnelChartLoader } from "./stage-funnel-chart-loader";
import { computeSlaStatus } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import { getStageDurations } from "@/lib/reports/stage-durations";
import type { Prisma } from "@/generated/prisma/client";

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1 px-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-heading text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

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
      : prisma.user.findMany({ where: { organizationId, role: "RM" }, orderBy: { name: "asc" } }),
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total Leads" value={totalLeads} />
        <Kpi label="Active Onboarding" value={activeClients} />
        <Kpi label="Completed" value={completedClients} />
        <Kpi label="Not Proceeding" value={notProceedingClients} />
        <Kpi label="On Hold" value={onHoldClients} />
        <Kpi label="Overdue" value={overdueCount} />
        <Kpi label="SLA Compliance" value={`${slaCompliance}%`} />
        <Kpi label="Avg Onboarding Time" value={avgOnboardingDays > 0 ? `${avgOnboardingDays}d` : "—"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stage Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <StageFunnelChartLoader data={funnelData} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stage Conversion</CardTitle>
          </CardHeader>
          <CardContent>
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
                    <TableCell className="text-sm">{row.stage}</TableCell>
                    <TableCell>{row.reached}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.pct}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bottleneck Analysis</CardTitle>
          </CardHeader>
          <CardContent>
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
                    <TableCell className="text-sm">{row.stageName}</TableCell>
                    <TableCell className={row.avgHours > 72 ? "text-destructive" : ""}>
                      {row.avgHours < 24 ? `${Math.round(row.avgHours)}h` : `${Math.round((row.avgHours / 24) * 10) / 10}d`}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.sampleSize}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lost Reasons</CardTitle>
          </CardHeader>
          <CardContent>
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
                    <TableCell className="text-sm">{row.reason ?? "Unspecified"}</TableCell>
                    <TableCell>{row._count._all}</TableCell>
                  </TableRow>
                ))}
                {lostReasonGroups.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground py-6">
                      No clients marked not proceeding yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Source Performance</CardTitle>
          </CardHeader>
          <CardContent>
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
                    <TableCell className="text-sm">{row.source}</TableCell>
                    <TableCell>{row.total}</TableCell>
                    <TableCell>{row.completed}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.total > 0 ? Math.round((row.completed / row.total) * 100) : 0}%
                    </TableCell>
                  </TableRow>
                ))}
                {sourcePerformance.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      No lead source data yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>RM Performance</CardTitle>
        </CardHeader>
        <CardContent>
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
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No RMs to report on yet.
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
