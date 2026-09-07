import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils/format";
import { PRODUCT_LABELS } from "@/lib/billing/plans";
import { SubscriptionEditor } from "./subscription-editor";

export default async function AdminOrganizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const organization = await prisma.organization.findUnique({
    where: { id },
    include: {
      subscriptions: true,
      members: { select: { id: true, name: true, email: true, role: true, orgRole: true, isActive: true, createdAt: true } },
      _count: { select: { clients: true, ticketReviews: true } },
    },
  });
  if (!organization) notFound();

  const subscriptionsByProduct = new Map(organization.subscriptions.map((s) => [s.product, s]));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{organization.name}</CardTitle>
          <CardDescription>
            {organization.slug} · created {formatDateTime(organization.createdAt)} · {organization._count.clients}{" "}
            clients · {organization._count.ticketReviews} reviews
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {(["QA_SENTINEL", "CRM"] as const).map((product) => (
          <SubscriptionEditor
            key={product}
            organizationId={organization.id}
            product={product}
            productLabel={PRODUCT_LABELS[product]}
            subscription={subscriptionsByProduct.get(product) ?? null}
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>Metadata only — no ticket, client, or message content is shown here.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Org role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organization.members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>{member.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{member.email}</TableCell>
                  <TableCell>{member.role}</TableCell>
                  <TableCell>{member.orgRole}</TableCell>
                  <TableCell>{member.isActive ? "Active" : "Deactivated"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDateTime(member.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
