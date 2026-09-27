import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils/format";
import { NewJourneyDialog } from "./new-journey-dialog";
import { JourneyRowActions } from "./journey-row-actions";
import { Panel } from "@/components/dashboard/panel";
import { TableEmpty } from "@/components/page/table-empty";

export default async function JourneysPage() {
  const session = await requireRole(["ADMIN", "MANAGER"]);

  const journeys = await prisma.journey.findMany({
    where: { organizationId: session.user.organizationId },
    include: {
      _count: { select: { runs: true } },
      runs: { where: { status: { in: ["RUNNING", "WAITING"] } }, select: { id: true }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <Panel eyebrow="Automation" title="Journeys" action={<><NewJourneyDialog /></>}>
      <div className="overflow-x-auto border-t border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Enrolled Clients</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {journeys.map((journey) => (
              <TableRow key={journey.id}>
                <TableCell>
                  <Link href={`/journeys/${journey.id}`} className="font-semibold hover:underline">
                    {journey.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={journey.isActive ? "success" : "secondary"}>
                    {journey.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>{journey._count.runs}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(journey.updatedAt)}
                </TableCell>
                <TableCell className="text-right">
                  <JourneyRowActions
                    journeyId={journey.id}
                    journeyName={journey.name}
                    runCount={journey._count.runs}
                    hasInFlightRuns={journey.runs.length > 0}
                  />
                </TableCell>
              </TableRow>
            ))}
            {journeys.length === 0 && (
              <TableEmpty colSpan={5}>No journeys yet. Create one to define how new clients move through your process.</TableEmpty>
            )}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
