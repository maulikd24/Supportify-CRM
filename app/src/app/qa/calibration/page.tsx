import Link from "next/link";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils/format";
import { Panel } from "@/components/dashboard/panel";
import { TableEmpty } from "@/components/page/table-empty";

export default async function CalibrationListPage() {
  const session = await requireOrg();

  const sessions = await prisma.calibrationSession.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { createdAt: "desc" },
    include: {
      review: { select: { ticketId: true, ticketSubject: true } },
      createdBy: { select: { name: true } },
      _count: { select: { entries: true } },
    },
  });

  return (
    <Panel eyebrow="Consistency" title="Calibration Sessions" description={<>Multiple reviewers independently score the same ticket to check how consistently the team applies your
          SOPs. Start one from any review&apos;s detail page.</>}>
      <div className="overflow-x-auto border-t border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticket</TableHead>
              <TableHead>Started by</TableHead>
              <TableHead>Reviewers</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link href={`/qa/calibration/${s.id}`} className="font-semibold hover:underline">
                    #{s.review.ticketId} {s.review.ticketSubject}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{s.createdBy.name}</TableCell>
                <TableCell className="text-muted-foreground">{s._count.entries}</TableCell>
                <TableCell>
                  <Badge variant={s.status === "OPEN" ? "warning" : "secondary"}>{s.status === "OPEN" ? "Open" : "Closed"}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDateTime(s.createdAt)}</TableCell>
              </TableRow>
            ))}
            {sessions.length === 0 && (
              <TableEmpty colSpan={5}>No calibration sessions yet.</TableEmpty>
            )}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
