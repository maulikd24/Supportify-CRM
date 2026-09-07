import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NewTemplateDialog } from "./new-template-dialog";
import { TemplateRowActions } from "./template-row-actions";

export default async function TemplatesSettingsPage() {
  const session = await requireRole(["ADMIN"]);

  const templates = await prisma.messageTemplate.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Message Templates</CardTitle>
        <NewTemplateDialog />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Body</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((template) => (
              <TableRow key={template.id}>
                <TableCell className="font-medium">{template.name}</TableCell>
                <TableCell className="text-sm capitalize">{template.channel}</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{template.body}</TableCell>
                <TableCell>
                  <Badge variant={template.approved ? "default" : "outline"}>
                    {template.approved ? "Approved" : "Draft"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <TemplateRowActions templateId={template.id} approved={template.approved} />
                </TableCell>
              </TableRow>
            ))}
            {templates.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No templates yet. WhatsApp requires pre-approved templates registered with your provider
                  — mark them approved here once registered.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
