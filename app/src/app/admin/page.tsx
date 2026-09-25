import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PRODUCT_LABELS } from "@/lib/billing/plans";
import { formatDateTime } from "@/lib/utils/format";
import type { SubscriptionStatus } from "@/generated/prisma/client";

function statusVariant(status: SubscriptionStatus | undefined): "default" | "secondary" | "destructive" | "outline" {
  if (!status) return "outline";
  if (status === "ACTIVE") return "default";
  if (status === "TRIALING") return "secondary";
  return "destructive";
}

export default async function AdminOrganizationsPage() {
  const organizations = await prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      subscriptions: true,
      _count: { select: { members: true, clients: true, ticketReviews: true } },
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organizations</CardTitle>
        <CardDescription>
          {organizations.length} organization{organizations.length === 1 ? "" : "s"} · aggregate metrics only, no
          customer data
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organization</TableHead>
              <TableHead>Subscriptions</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Clients</TableHead>
              <TableHead>Reviews</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {organizations.map((org) => (
              <TableRow key={org.id}>
                <TableCell>
                  <Link href={`/admin/organizations/${org.id}`} className="font-medium hover:underline">
                    {org.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">{org.slug}</div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    {org.subscriptions.length === 0 && (
                      <span className="text-xs text-muted-foreground">None</span>
                    )}
                    {org.subscriptions.map((sub) => (
                      <div key={sub.id} className="flex items-center gap-1.5 text-xs">
                        <Badge variant={statusVariant(sub.status)}>
                          {PRODUCT_LABELS[sub.product]} · {sub.status}
                        </Badge>
                        {sub.planId && <span className="text-muted-foreground">{sub.planId}</span>}
                      </div>
                    ))}
                  </div>
                </TableCell>
                <TableCell>{org._count.members}</TableCell>
                <TableCell>{org._count.clients}</TableCell>
                <TableCell>{org._count.ticketReviews}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{formatDateTime(org.createdAt)}</TableCell>
              </TableRow>
            ))}
            {organizations.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No organizations yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
