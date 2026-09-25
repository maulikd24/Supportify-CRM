import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StageRow } from "./stage-row";
import { NewStageDialog } from "./new-stage-dialog";

export default async function StagesSettingsPage() {
  const session = await requireRole(["ADMIN"]);

  const stages = await prisma.stage.findMany({
    where: { organizationId: session.user.organizationId, isActive: true },
    orderBy: { sequence: "asc" },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Pipeline Stages</CardTitle>
          <CardDescription>
            Your sales pipeline — rename stages, set SLA hours, and mark a stage &quot;Terminal&quot; so clients that
            reach it are automatically marked Completed.
          </CardDescription>
        </div>
        <NewStageDialog />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>SLA (hours)</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Terminal</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stages.map((stage) => (
              <StageRow key={stage.id} stage={stage} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
