import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils/format";
import { NewJourneyDialog } from "./new-journey-dialog";
import { JourneyRowActions } from "./journey-row-actions";

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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Journeys</CardTitle>
        <NewJourneyDialog />
      </CardHeader>
      <CardContent>
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
                  <Link href={`/journeys/${journey.id}`} className="font-medium hover:underline">
                    {journey.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={journey.isActive ? "default" : "outline"}>
                    {journey.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{journey._count.runs}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
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
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No journeys yet. Create one to define how new clients move through your process.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
