import Link from "next/link";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

function scoreVariant(score: number | null): "default" | "secondary" | "destructive" {
  if (score === null) return "secondary";
  if (score >= 75) return "default";
  if (score >= 50) return "secondary";
  return "destructive";
}

export default async function QaAgentsPage() {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;

  const [byAgent, recentByAgent] = await Promise.all([
    prisma.ticketReview.groupBy({
      by: ["agentEmail"],
      where: { organizationId, agentEmail: { not: null } },
      _count: { _all: true },
      _avg: { overallScore: true },
      _min: { overallScore: true },
      _max: { overallScore: true },
    }),
    prisma.ticketReview.findMany({
      where: { organizationId, agentEmail: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { agentEmail: true, agentName: true, overallScore: true, createdAt: true },
    }),
  ]);

  const nameByEmail = new Map<string, string>();
  const last30ByAgent = new Map<string, number[]>();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  for (const r of recentByAgent) {
    if (!r.agentEmail) continue;
    if (r.agentName && !nameByEmail.has(r.agentEmail)) nameByEmail.set(r.agentEmail, r.agentName);
    if (r.createdAt >= thirtyDaysAgo && r.overallScore != null) {
      const list = last30ByAgent.get(r.agentEmail) ?? [];
      list.push(r.overallScore);
      last30ByAgent.set(r.agentEmail, list);
    }
  }

  const rows = byAgent
    .map((row) => {
      const email = row.agentEmail as string;
      const last30 = last30ByAgent.get(email) ?? [];
      const last30Avg = last30.length ? Math.round(last30.reduce((a, b) => a + b, 0) / last30.length) : null;
      return {
        email,
        name: nameByEmail.get(email) ?? email,
        totalReviews: row._count._all,
        avgScore: row._avg.overallScore != null ? Math.round(row._avg.overallScore) : null,
        minScore: row._min.overallScore,
        maxScore: row._max.overallScore,
        last30Avg,
        last30Count: last30.length,
      };
    })
    .sort((a, b) => (a.avgScore ?? 0) - (b.avgScore ?? 0));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent Scorecards</CardTitle>
        <CardDescription>Aggregate QA performance per agent, sorted lowest average score first.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Reviews</TableHead>
              <TableHead>Avg Score</TableHead>
              <TableHead>Last 30 Days</TableHead>
              <TableHead>Range</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.email}>
                <TableCell>
                  <Link href={`/qa/reviews?agent=${encodeURIComponent(row.email)}`} className="font-medium hover:underline">
                    {row.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{row.email}</p>
                </TableCell>
                <TableCell className="text-sm">{row.totalReviews}</TableCell>
                <TableCell>
                  <Badge variant={scoreVariant(row.avgScore)}>{row.avgScore ?? "—"}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.last30Count > 0 ? `${row.last30Avg} (${row.last30Count} reviews)` : "No recent reviews"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.minScore ?? "—"} – {row.maxScore ?? "—"}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
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
