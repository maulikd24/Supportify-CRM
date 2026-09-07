import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils/format";

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

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  function buildPageHref(page: number): string {
    const usp = new URLSearchParams();
    if (params.entity) usp.set("entity", params.entity);
    if (page > 1) usp.set("page", String(page));
    const qs = usp.toString();
    return qs ? `/settings/audit-log?${qs}` : "/settings/audit-log";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit Log</CardTitle>
        <CardDescription>A record of every change made to your organization's data.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
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
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {formatDateTime(entry.timestamp)}
                </TableCell>
                <TableCell className="text-sm">{entry.user.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{entry.entity}</Badge>
                </TableCell>
                <TableCell className="text-sm">{ACTION_LABELS[entry.action] ?? entry.action}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-md">
                  {entry.reason && <div>Reason: {entry.reason}</div>}
                  {entry.oldValue != null && <div>From: {summarizeValue(entry.oldValue)}</div>}
                  {entry.newValue != null && <div>To: {summarizeValue(entry.newValue)}</div>}
                </TableCell>
              </TableRow>
            ))}
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No activity recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <p>
            {totalCount === 0
              ? "0 entries"
              : `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, totalCount)} of ${totalCount}`}
          </p>
          <div className="flex gap-2">
            {currentPage <= 1 ? (
              <Button size="sm" variant="outline" disabled>
                Previous
              </Button>
            ) : (
              <Button size="sm" variant="outline" render={<Link href={buildPageHref(currentPage - 1)} />}>
                Previous
              </Button>
            )}
            {currentPage >= totalPages ? (
              <Button size="sm" variant="outline" disabled>
                Next
              </Button>
            ) : (
              <Button size="sm" variant="outline" render={<Link href={buildPageHref(currentPage + 1)} />}>
                Next
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
