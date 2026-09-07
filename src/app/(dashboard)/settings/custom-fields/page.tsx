import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NewCustomFieldDialog } from "./new-custom-field-dialog";
import { CustomFieldRowActions } from "./custom-field-row-actions";

export default async function CustomFieldsSettingsPage() {
  const session = await requireRole(["ADMIN"]);

  const fields = await prisma.customFieldDefinition.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Custom Fields</CardTitle>
          <CardDescription>Extra fields shown on every client, specific to how your team works.</CardDescription>
        </div>
        <NewCustomFieldDialog />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Required</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field) => (
              <TableRow key={field.id}>
                <TableCell className="font-medium">{field.label}</TableCell>
                <TableCell className="text-sm capitalize">{field.fieldType.toLowerCase()}</TableCell>
                <TableCell>
                  <Badge variant={field.required ? "default" : "outline"}>{field.required ? "Required" : "Optional"}</Badge>
                </TableCell>
                <TableCell>
                  <CustomFieldRowActions fieldId={field.id} />
                </TableCell>
              </TableRow>
            ))}
            {fields.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No custom fields yet. Add one to capture something specific to your business.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
