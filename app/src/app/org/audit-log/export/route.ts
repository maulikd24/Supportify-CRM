import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { auditActionLabel, recordAudit } from "@/lib/audit/record";
import { auditWhere, summarizeAuditValue } from "@/lib/audit/query";
import { enterpriseControlsAvailable } from "@/lib/security/policy";

const MAX_ROWS = 50_000;

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  // Quote everything; neutralise spreadsheet formulas (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** CSV export of the audit log, honouring the same filters as the page. Scale/Enterprise only. */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.orgRole !== "OWNER" && session.user.orgRole !== "ADMIN") {
    return NextResponse.json({ error: "Only owners and admins can export the audit log" }, { status: 403 });
  }
  const organizationId = session.user.organizationId;
  if (!(await enterpriseControlsAvailable(organizationId))) {
    return NextResponse.json({ error: "Audit log export is available on Scale and Enterprise plans" }, { status: 403 });
  }

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const entries = await prisma.auditLog.findMany({
    where: auditWhere(organizationId, params),
    include: { user: { select: { name: true } } },
    orderBy: { timestamp: "desc" },
    take: MAX_ROWS,
  });

  const header = ["Timestamp (UTC)", "Actor", "Actor email", "Action", "Action code", "Record type", "Record ID", "IP address", "User agent", "Reason", "From", "To"];
  const lines = [header.map(csvCell).join(",")];
  for (const e of entries) {
    lines.push(
      [
        e.timestamp.toISOString(),
        e.user?.name ?? (e.actorEmail ? "" : "System"),
        e.actorEmail,
        auditActionLabel(e.action),
        e.action,
        e.entity,
        e.entityId,
        e.ipAddress,
        e.userAgent,
        e.reason,
        summarizeAuditValue(e.oldValue),
        summarizeAuditValue(e.newValue),
      ]
        .map(csvCell)
        .join(","),
    );
  }

  await recordAudit({
    organizationId,
    userId: session.user.id,
    entity: "AuditLog",
    entityId: organizationId,
    action: "data.export_audit_log",
    newValue: { rows: entries.length, filters: params },
  });

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
