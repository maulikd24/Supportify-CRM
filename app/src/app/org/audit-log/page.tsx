import Link from "next/link";
import { Download } from "lucide-react";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Panel } from "@/components/dashboard/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableEmpty } from "@/components/page/table-empty";
import { Pagination } from "@/components/page/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { auditActionLabel } from "@/lib/audit/record";
import { AUDIT_CATEGORIES, auditWhere, summarizeAuditValue, type AuditFilters } from "@/lib/audit/query";
import { enterpriseControlsAvailable } from "@/lib/security/policy";
import { formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
const CATEGORY_TABS = [
  { key: "", label: "All" },
  ...Object.entries(AUDIT_CATEGORIES).map(([key, c]) => ({ key, label: c.label })),
  { key: "records", label: "Records" },
];

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<AuditFilters & { page?: string }> }) {
  const session = await requireOrg(["OWNER", "ADMIN"]);
  const organizationId = session.user.organizationId;
  const params = await searchParams;
  const filters: AuditFilters = { category: params.category, from: params.from, to: params.to, q: params.q };
  const currentPage = Math.max(1, Number(params.page) || 1);
  const where = auditWhere(organizationId, filters);

  const [entries, totalCount, canExport] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { name: true } } },
      orderBy: { timestamp: "desc" },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
    enterpriseControlsAvailable(organizationId),
  ]);

  function href(overrides: Partial<AuditFilters & { page: number }>, base = "/org/audit-log"): string {
    const usp = new URLSearchParams();
    const merged = { ...filters, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) usp.set(k, String(v));
    const qs = usp.toString();
    return qs ? `${base}?${qs}` : base;
  }

  return (
    <Panel
      eyebrow="Compliance"
      title={`${totalCount.toLocaleString("en-IN")} event${totalCount === 1 ? "" : "s"}`}
      description="Every sign-in, permission change, settings change and export in your organization."
      action={
        canExport ? (
          <Button variant="outline" nativeButton={false} render={<a href={href({ page: undefined }, "/org/audit-log/export")} />}>
            <Download /> Export CSV
          </Button>
        ) : (
          <Button variant="outline" nativeButton={false} render={<Link href="/billing" />} title="Available on Scale and Enterprise">
            <Download /> Export CSV · Scale
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-3 px-5 pb-4">
        <nav aria-label="Categories" className="flex flex-wrap gap-1.5">
          {CATEGORY_TABS.map((tab) => {
            const active = (filters.category ?? "") === tab.key;
            return (
              <Link
                key={tab.key || "all"}
                href={href({ category: tab.key || undefined, page: undefined })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors",
                  active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <form className="flex flex-wrap items-end gap-2" action="/org/audit-log">
          {filters.category && <input type="hidden" name="category" value={filters.category} />}
          <label className="flex flex-col gap-1 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
            Person, email or IP
            <Input name="q" defaultValue={filters.q} placeholder="e.g. priya@acme.com" className="w-60 normal-case tracking-normal" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
            From
            <Input type="date" name="from" defaultValue={filters.from} className="w-40" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
            To
            <Input type="date" name="to" defaultValue={filters.to} className="w-40" />
          </label>
          <Button type="submit">Filter</Button>
          {(filters.q || filters.from || filters.to) && (
            <Link href={href({ q: undefined, from: undefined, to: undefined, page: undefined })} className="pb-2 text-[11px] font-bold text-primary hover:underline">
              Clear
            </Link>
          )}
        </form>
      </div>
      <div className="overflow-x-auto border-t border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>IP address</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="text-muted-foreground">{formatDateTime(entry.timestamp)}</TableCell>
                <TableCell>
                  <p className="font-semibold">{entry.user?.name ?? (entry.actorEmail ? "Unknown user" : "System")}</p>
                  {entry.actorEmail && <p className="text-[11px] text-muted-foreground">{entry.actorEmail}</p>}
                </TableCell>
                <TableCell>
                  <Badge variant={entry.action === "auth.login_failed" || entry.action === "auth.login_blocked_sso_required" ? "warning" : "secondary"}>
                    {auditActionLabel(entry.action)}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{entry.entity}</TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">{entry.ipAddress ?? "—"}</TableCell>
                <TableCell className="max-w-md whitespace-normal text-[11px] text-muted-foreground">
                  {entry.reason && <div>Reason: {entry.reason}</div>}
                  {entry.oldValue != null && <div>From: {summarizeAuditValue(entry.oldValue)}</div>}
                  {entry.newValue != null && <div>To: {summarizeAuditValue(entry.newValue)}</div>}
                </TableCell>
              </TableRow>
            ))}
            {entries.length === 0 && <TableEmpty colSpan={6}>No events match these filters.</TableEmpty>}
          </TableBody>
        </Table>
      </div>
      <Pagination page={currentPage} pageSize={PAGE_SIZE} total={totalCount} noun="events" hrefFor={(page) => href({ page })} />
    </Panel>
  );
}
