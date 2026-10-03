import Link from "next/link";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NewDsatDialog } from "./new-dsat-dialog";
import { getHelpdeskSummary } from "@/lib/qa/helpdesk-summary";
import { Panel } from "@/components/dashboard/panel";
import { TableEmpty } from "@/components/page/table-empty";
import { probabilityVariant } from "@/lib/qa/score";

export default async function QaDsatPage() {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;

  const [analyses, helpdesk] = await Promise.all([
    prisma.dsatAnalysis.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50 }),
    getHelpdeskSummary(organizationId),
  ]);

  return (
    <Panel eyebrow="Customer recovery" title="DSAT Analyses" action={<><NewDsatDialog helpdesk={helpdesk ? { name: helpdesk.name, ticketLabel: helpdesk.ticketLabel, ticketPlaceholder: helpdesk.ticketPlaceholder } : null} /></>}>
      <div className="overflow-x-auto border-t border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticket</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Recovery</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {analyses.map((analysis) => (
              <TableRow key={analysis.id}>
                <TableCell>
                  <Link href={`/qa/dsat/${analysis.id}`} className="font-semibold hover:underline">
                    {analysis.ticketId ? `#${analysis.ticketId} ` : ""}
                    {analysis.ticketSubject || "Untitled"}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{analysis.agentName || "—"}</TableCell>
                <TableCell>
                  <Badge variant={probabilityVariant(analysis.recoveryProbability)} className="capitalize">
                    {analysis.recoveryProbability || "unknown"}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {analysis.createdAt.toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
            {analyses.length === 0 && (
              <TableEmpty colSpan={4}>No DSAT analyses yet.</TableEmpty>
            )}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
