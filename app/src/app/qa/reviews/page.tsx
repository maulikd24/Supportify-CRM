import Link from "next/link";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewReviewDialog } from "./new-review-dialog";
import { customScorecardsAvailable } from "@/lib/qa/scorecard";
import { Panel } from "@/components/dashboard/panel";
import { Badge } from "@/components/ui/badge";
import { ScoreChip } from "@/components/dashboard/score-chip";
import { formatDate } from "@/lib/utils/format";
import { TableEmpty } from "@/components/page/table-empty";

export default async function QaReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; q?: string; new?: string }>;
}) {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;
  const { agent, q, new: openNew } = await searchParams;
  const query = q?.trim();

  const [reviews, sops, hasZendesk, scorecardsOn] = await Promise.all([
    prisma.ticketReview.findMany({
      where: {
        organizationId,
        ...(agent ? { agentEmail: { equals: agent, mode: "insensitive" } } : {}),
        ...(query
          ? {
              OR: [
                { ticketId: { contains: query, mode: "insensitive" } },
                { ticketSubject: { contains: query, mode: "insensitive" } },
                { agentName: { contains: query, mode: "insensitive" } },
                { agentEmail: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.sopDocument.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    prisma.zendeskConnection.findUnique({ where: { organizationId } }).then(Boolean),
    customScorecardsAvailable(organizationId),
  ]);
  const scorecards = scorecardsOn
    ? await prisma.scorecard.findMany({
        where: { organizationId },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        select: { id: true, name: true, isDefault: true },
      })
    : [];

  return (
    <Panel eyebrow="Quality" title={<>Ticket reviews{agent ? ` — ${agent}` : ""}</>} action={<><NewReviewDialog sops={sops.map((s) => ({ id: s.id, name: s.name }))} scorecards={scorecards} disabled={!hasZendesk} defaultOpen={openNew === "1"} /></>}>
      {(agent || query || !hasZendesk) && (
        <div className="flex flex-col gap-1 px-5 pb-4 text-xs text-muted-foreground">
          {(agent || query) && (
            <p>
              Filtered to <span className="font-semibold text-foreground">{query ? `“${query}”` : agent}</span> ·{" "}
              <Link href="/qa/reviews" className="font-bold text-primary hover:underline">
                Clear filter
              </Link>
            </p>
          )}
          {!hasZendesk && (
            <p>
              Connect Zendesk in{" "}
              <Link href="/qa/settings" className="font-bold text-primary hover:underline">
                Settings
              </Link>{" "}
              to run reviews.
            </p>
          )}
        </div>
      )}
      <div className="overflow-x-auto border-t border-border">
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
                  <Link href={`/qa/reviews/${review.id}`} className="font-semibold hover:underline">
                    #{review.ticketId} {review.ticketSubject}
                  </Link>
                  {review.source === "auto" && (
                    <Badge variant="soft" className="ml-2">
                      Auto
                    </Badge>
                  )}
                  {review.isOverage && (
                    <Badge variant="secondary" className="ml-1">
                      Overage
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{review.agentName}</TableCell>
                <TableCell className="text-muted-foreground">
                  {Array.isArray(review.sopNames) ? (review.sopNames as string[]).join(", ") : ""}
                </TableCell>
                <TableCell>
                  <ScoreChip score={review.overallScore} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(review.createdAt)}
                </TableCell>
              </TableRow>
            ))}
            {reviews.length === 0 && <TableEmpty colSpan={5}>{query || agent ? "No reviews match this filter." : "No reviews yet."}</TableEmpty>}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
