import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StageRow } from "./stage-row";
import { NewStageDialog } from "./new-stage-dialog";
import { Panel } from "@/components/dashboard/panel";

export default async function StagesSettingsPage() {
  const session = await requireRole(["ADMIN"]);

  const stages = await prisma.stage.findMany({
    where: { organizationId: session.user.organizationId, isActive: true },
    orderBy: { sequence: "asc" },
  });

  return (
    <Panel eyebrow="Pipeline" title="Pipeline Stages" description={<>Your sales pipeline — rename stages, set SLA hours, and mark a stage &quot;Terminal&quot; so clients that
            reach it are automatically marked Completed.</>} action={<><NewStageDialog /></>}>
      <div className="overflow-x-auto border-t border-border">
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
      </div>
    </Panel>
  );
}
