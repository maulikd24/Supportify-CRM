import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils/format";
import { Panel } from "@/components/dashboard/panel";
import { Pagination } from "@/components/page/pagination";
import { TableEmpty } from "@/components/page/table-empty";

const PAGE_SIZE = 50;

const ACTION_LABELS: Record<string, string> = {
  created: "Created",
  stage_changed: "Stage changed",
  stage_corrected: "Stage corrected",
  hold_started: "Put on hold",
  hold_resolved: "Resumed from hold",
  marked_not_proceeding: "Marked not proceeding",
  reopened: "Reopened",
  merged: "Merged",
  auto_completed: "Auto-completed",
};

function summarizeValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
  }
  return String(value);
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; entity?: string }>;
}) {
  const session = await requireRole(["ADMIN"]);
  const params = await searchParams;
  const currentPage = Math.max(1, Number(params.page) || 1);

  const where = {
    organizationId: session.user.organizationId,
    ...(params.entity ? { entity: params.entity } : {}),
  };

  const [entries, totalCount, entities] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { name: true } } },
      orderBy: { timestamp: "desc" },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where: { organizationId: session.user.organizationId },
      distinct: ["entity"],
      select: { entity: true },
    }),
  ]);


  function buildPageHref(page: number): string {
    const usp = new URLSearchParams();
    if (params.entity) usp.set("entity", params.entity);
    if (page > 1) usp.set("page", String(page));
    const qs = usp.toString();
    return qs ? `/settings/audit-log?${qs}` : "/settings/audit-log";
  }

  return (
    <Panel eyebrow="Compliance" title="Audit Log" description={<>A record of every change made to your organization&apos;s data.</>}>
      <div className="flex flex-wrap gap-2 px-5 pb-4">
          <Button size="sm" variant={!params.entity ? "default" : "outline"} render={<Link href="/settings/audit-log" />}>
            All
          </Button>
          {entities.map((e) => (
            <Button
              key={e.entity}
              size="sm"
              variant={params.entity === e.entity ? "default" : "outline"}
              render={<Link href={`/settings/audit-log?entity=${e.entity}`} />}
            >
              {e.entity}
            </Button>
          ))}
      </div>
      <div className="overflow-x-auto border-t border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(entry.timestamp)}
                </TableCell>
                <TableCell>{entry.user.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{entry.entity}</Badge>
                </TableCell>
                <TableCell>{ACTION_LABELS[entry.action] ?? entry.action}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-md">
                  {entry.reason && <div>Reason: {entry.reason}</div>}
                  {entry.oldValue != null && <div>From: {summarizeValue(entry.oldValue)}</div>}
                  {entry.newValue != null && <div>To: {summarizeValue(entry.newValue)}</div>}
                </TableCell>
              </TableRow>
            ))}
            {entries.length === 0 && (
              <TableEmpty colSpan={5}>No activity recorded yet.</TableEmpty>
            )}
          </TableBody>
        </Table>

      </div>
      <Pagination page={currentPage} pageSize={PAGE_SIZE} total={totalCount} noun="entries" hrefFor={buildPageHref} />
    </Panel>
  );
}
