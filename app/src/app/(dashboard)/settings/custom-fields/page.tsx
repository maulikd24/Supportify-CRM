import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NewCustomFieldDialog } from "./new-custom-field-dialog";
import { CustomFieldRowActions } from "./custom-field-row-actions";
import { Panel } from "@/components/dashboard/panel";
import { TableEmpty } from "@/components/page/table-empty";

export default async function CustomFieldsSettingsPage() {
  const session = await requireRole(["ADMIN"]);

  const fields = await prisma.customFieldDefinition.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <Panel eyebrow="Configuration" title="Custom Fields" description={<>Extra fields shown on every client, specific to how your team works.</>} action={<><NewCustomFieldDialog /></>}>
      <div className="overflow-x-auto border-t border-border">
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
              <TableEmpty colSpan={4}>No custom fields yet. Add one to capture something specific to your business.</TableEmpty>
            )}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
