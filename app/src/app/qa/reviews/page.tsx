import Link from "next/link";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NewReviewDialog } from "./new-review-dialog";

function scoreVariant(score: number | null): "default" | "secondary" | "destructive" {
  if (score === null) return "secondary";
  if (score >= 75) return "default";
  if (score >= 50) return "secondary";
  return "destructive";
}

export default async function QaReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;
  const { agent } = await searchParams;

  const [reviews, sops, hasZendesk] = await Promise.all([
    prisma.ticketReview.findMany({
      where: { organizationId, ...(agent ? { agentEmail: agent } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.sopDocument.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    prisma.zendeskConnection.findUnique({ where: { organizationId } }).then(Boolean),
  ]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Ticket Reviews{agent ? ` — ${agent}` : ""}</CardTitle>
        <NewReviewDialog sops={sops.map((s) => ({ id: s.id, name: s.name }))} disabled={!hasZendesk} />
      </CardHeader>
      <CardContent>
        {agent && (
          <p className="mb-4 text-sm">
            Filtered to {agent} ·{" "}
            <Link href="/qa/reviews" className="underline">
              Clear filter
            </Link>
          </p>
        )}
        {!hasZendesk && (
          <p className="mb-4 text-sm text-muted-foreground">
            Connect Zendesk in <Link href="/qa/settings" className="underline">Settings</Link> to run reviews.
          </p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticket</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>SOP</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reviews.map((review) => (
              <TableRow key={review.id}>
                <TableCell>
                  <Link href={`/qa/reviews/${review.id}`} className="font-medium hover:underline">
                    #{review.ticketId} {review.ticketSubject}
                  </Link>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{review.agentName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {Array.isArray(review.sopNames) ? (review.sopNames as string[]).join(", ") : ""}
                </TableCell>
                <TableCell>
                  <Badge variant={scoreVariant(review.overallScore)}>{review.overallScore ?? "—"}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {review.createdAt.toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
            {reviews.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No reviews yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
