"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CLIENT_STATUS_VARIANT, PRIORITY_VARIANT, SLA_VARIANT, humanize } from "@/lib/crm/badges";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import type { SlaStatus } from "@/lib/stage-engine/sla-status";
import type { Priority, ClientStatus } from "@/generated/prisma/client";

export function ClientRow({
  id,
  clientCode,
  name,
  mobile,
  stageName,
  ageHours,
  priority,
  nextActionTitle,
  nextActionDueAt,
  slaStatus,
  status,
  assignedToName,
  createdAt,
  lastActivityAt,
}: {
  id: string;
  clientCode: string;
  name: string;
  mobile: string;
  stageName: string;
  ageHours: number;
  priority: Priority;
  nextActionTitle: string | null;
  nextActionDueAt: Date | null;
  slaStatus: SlaStatus;
  status: ClientStatus;
  assignedToName: string | null;
  createdAt: Date;
  lastActivityAt: Date | null;
}) {
  const router = useRouter();

  return (
    <TableRow
      onClick={() => router.push(`/clients/${id}`)}
      className="cursor-pointer"
    >
      <TableCell>
        <Link
          href={`/clients/${id}`}
          className="font-semibold hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {name}
        </Link>
        <p className="font-mono text-[11px] text-muted-foreground">{clientCode}</p>
      </TableCell>
      <TableCell>{mobile}</TableCell>
      <TableCell>{stageName}</TableCell>
      <TableCell className="text-muted-foreground">
        {ageHours < 24 ? `${Math.round(ageHours)}h` : `${Math.round(ageHours / 24)}d`}
      </TableCell>
      <TableCell>
        <Badge variant={PRIORITY_VARIANT[priority]}>{humanize(priority)}</Badge>
      </TableCell>
      <TableCell className="max-w-40 truncate">{nextActionTitle ?? "—"}</TableCell>
      <TableCell className="text-muted-foreground">
        {nextActionDueAt ? formatDateTime(nextActionDueAt) : "—"}
      </TableCell>
      <TableCell>
        <Badge variant={SLA_VARIANT[slaStatus]}>{humanize(slaStatus)}</Badge>
      </TableCell>
      <TableCell>
        <Badge variant={CLIENT_STATUS_VARIANT[status]}>{humanize(status)}</Badge>
      </TableCell>
      <TableCell>{assignedToName ?? "Unassigned"}</TableCell>
      <TableCell className="text-muted-foreground">{formatDate(createdAt)}</TableCell>
      <TableCell className="text-muted-foreground">
        {lastActivityAt ? formatDateTime(lastActivityAt) : "—"}
      </TableCell>
    </TableRow>
  );
}
