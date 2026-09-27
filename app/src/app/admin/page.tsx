import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PRODUCT_LABELS } from "@/lib/billing/plans";
import { formatDateTime } from "@/lib/utils/format";
import type { SubscriptionStatus } from "@/generated/prisma/client";
import { Panel } from "@/components/dashboard/panel";
import { TableEmpty } from "@/components/page/table-empty";

function statusVariant(status: SubscriptionStatus | undefined): "success" | "warning" | "destructive" | "secondary" {
  if (!status) return "secondary";
  if (status === "ACTIVE") return "success";
  if (status === "TRIALING") return "warning";
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
    <Panel eyebrow="Platform" title="Organizations" description={<>{organizations.length} organization{organizations.length === 1 ? "" : "s"} · aggregate metrics only, no
          customer data</>}>
      <div className="overflow-x-auto border-t border-border">
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
                  <Link href={`/admin/organizations/${org.id}`} className="font-semibold hover:underline">
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
                <TableCell className="text-muted-foreground">{formatDateTime(org.createdAt)}</TableCell>
              </TableRow>
            ))}
            {organizations.length === 0 && (
              <TableEmpty colSpan={6}>No organizations yet.</TableEmpty>
            )}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
