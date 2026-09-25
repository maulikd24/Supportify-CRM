import Link from "next/link";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils/format";

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
    <Card>
      <CardHeader>
        <CardTitle>Calibration Sessions</CardTitle>
        <CardDescription>
          Multiple reviewers independently score the same ticket to check how consistently the team applies your
          SOPs. Start one from any review&apos;s detail page.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
                  <Link href={`/qa/calibration/${s.id}`} className="font-medium hover:underline">
                    #{s.review.ticketId} {s.review.ticketSubject}
                  </Link>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{s.createdBy.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{s._count.entries}</TableCell>
                <TableCell>
                  <Badge variant={s.status === "OPEN" ? "secondary" : "outline"}>{s.status}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{formatDateTime(s.createdAt)}</TableCell>
              </TableRow>
            ))}
            {sessions.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No calibration sessions yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
