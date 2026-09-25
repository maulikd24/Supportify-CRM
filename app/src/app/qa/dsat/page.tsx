import Link from "next/link";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NewDsatDialog } from "./new-dsat-dialog";

function probabilityVariant(prob: string | null): "default" | "secondary" | "destructive" {
  if (prob === "high") return "default";
  if (prob === "medium") return "secondary";
  return "destructive";
}

export default async function QaDsatPage() {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;

  const [analyses, hasZendesk] = await Promise.all([
    prisma.dsatAnalysis.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.zendeskConnection.findUnique({ where: { organizationId } }).then(Boolean),
  ]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>DSAT Analyses</CardTitle>
        <NewDsatDialog hasZendesk={hasZendesk} />
      </CardHeader>
      <CardContent>
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
                  <Link href={`/qa/dsat/${analysis.id}`} className="font-medium hover:underline">
                    {analysis.ticketId ? `#${analysis.ticketId} ` : ""}
                    {analysis.ticketSubject || "Untitled"}
                  </Link>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{analysis.agentName || "—"}</TableCell>
                <TableCell>
                  <Badge variant={probabilityVariant(analysis.recoveryProbability)} className="capitalize">
                    {analysis.recoveryProbability || "unknown"}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {analysis.createdAt.toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
            {analyses.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No DSAT analyses yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
