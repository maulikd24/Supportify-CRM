import { requireRole } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DeleteOrganizationDialog } from "./delete-organization-dialog";

export default async function DataSettingsPage() {
  const session = await requireRole(["ADMIN"]);

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.user.organizationId },
    select: { name: true },
  });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Export your data</CardTitle>
          <CardDescription>Download a copy of everything stored in Supportify for your organization.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" render={<a href="/api/export/clients" />}>
            Export clients (CSV)
          </Button>
          <Button variant="outline" render={<a href="/api/export/organization" />}>
            Export all data (JSON)
          </Button>
        </CardContent>
      </Card>

      {session.user.orgRole === "OWNER" && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
            <CardDescription>
              Permanently delete {organization.name} and everything in it — clients, tasks, journeys, QA reviews,
              team members, and billing. This cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeleteOrganizationDialog organizationName={organization.name} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
