import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ZendeskConnectionForm } from "./zendesk-connection-form";
import { NewSopDialog } from "./new-sop-dialog";
import { SopRowActions } from "./sop-row-actions";

export default async function QaSettingsPage() {
  const session = await requireOrg();

  const [connection, sops] = await Promise.all([
    prisma.zendeskConnection.findUnique({ where: { organizationId: session.user.organizationId } }),
    prisma.sopDocument.findMany({
      where: { organizationId: session.user.organizationId },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Zendesk connection</CardTitle>
          <CardDescription>
            Connect your Zendesk account so reviews can pull real tickets. Your API token is encrypted at rest.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ZendeskConnectionForm
            connected={Boolean(connection)}
            subdomain={connection?.subdomain}
            email={connection?.email}
            isValid={connection?.isValid ?? false}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>SOPs</CardTitle>
            <CardDescription>Standard Operating Procedures reviews are scored against.</CardDescription>
          </div>
          <NewSopDialog />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sops.map((sop) => (
                <TableRow key={sop.id}>
                  <TableCell className="font-medium">{sop.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {sop.category}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <SopRowActions sopId={sop.id} name={sop.name} category={sop.category} content={sop.content} />
                  </TableCell>
                </TableRow>
              ))}
              {sops.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    No SOPs yet. Add one to start running reviews.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
