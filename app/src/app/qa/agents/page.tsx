import Link from "next/link";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel } from "@/components/dashboard/panel";
import { TableEmpty } from "@/components/page/table-empty";
import { ScoreChip } from "@/components/dashboard/score-chip";
import { Badge } from "@/components/ui/badge";
import { addDays, startOfDay } from "@/lib/utils/date-buckets";
import { Button } from "@/components/ui/button";
import { agentSeatLimit } from "@/lib/qa/plan-features";
import { InviteAgentDialog, PortalAccessMenu } from "./portal-access";

export default async function QaAgentsPage() {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;

  const isAdmin = session.user.orgRole === "OWNER" || session.user.orgRole === "ADMIN";
  const [byAgent, recentByAgent, openCoaching, agentUsers, seatLimit] = await Promise.all([
    prisma.ticketReview.groupBy({
      by: ["agentEmail"],
      where: { organizationId, agentEmail: { not: null } },
      _count: { _all: true, overallScore: true },
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
    prisma.coachingSession.groupBy({
      by: ["agentEmail"],
      where: { organizationId, status: { in: ["ASSIGNED", "ACKNOWLEDGED"] } },
      _count: { _all: true },
    }),
    prisma.user.findMany({
      where: { organizationId, orgRole: "AGENT" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, helpdeskEmail: true, isActive: true },
    }),
    agentSeatLimit(organizationId),
  ]);
  const portalByEmail = new Map<string, (typeof agentUsers)[number]>();
  for (const u of agentUsers) {
    portalByEmail.set(u.email.toLowerCase(), u);
    if (u.helpdeskEmail) portalByEmail.set(u.helpdeskEmail.toLowerCase(), u);
  }
  const reviewedEmails = new Set(byAgent.map((r) => (r.agentEmail as string).toLowerCase()));
  // Portal logins with no reviews yet (e.g. invited before their first review) still need managing.
  const unmatched = agentUsers.filter((u) => !reviewedEmails.has(u.email.toLowerCase()) && !(u.helpdeskEmail && reviewedEmails.has(u.helpdeskEmail.toLowerCase())));
  const seatsUsed = agentUsers.filter((u) => u.isActive).length;
  const portalAvailable = seatLimit !== 0;
  const canInvite = isAdmin && portalAvailable && (seatLimit == null || seatsUsed < seatLimit);
  const coachingByAgent = new Map(openCoaching.map((c) => [c.agentEmail, c._count._all]));

  const nameByEmail = new Map<string, string>();
  const last30ByAgent = new Map<string, number[]>();
  const thirtyDaysAgo = addDays(startOfDay(), -30);
  for (const r of recentByAgent) {
    if (!r.agentEmail) continue;
    const key = r.agentEmail.toLowerCase();
    if (r.agentName && !nameByEmail.has(key)) nameByEmail.set(key, r.agentName);
    if (r.createdAt >= thirtyDaysAgo && r.overallScore != null) {
      const list = last30ByAgent.get(key) ?? [];
      list.push(r.overallScore);
      last30ByAgent.set(key, list);
    }
  }

  // Helpdesks don't always keep email casing consistent, so merge agents case-insensitively.
  const merged = new Map<string, { total: number; scored: number; scoreSum: number; min: number | null; max: number | null }>();
  for (const row of byAgent) {
    const key = (row.agentEmail as string).toLowerCase();
    const m = merged.get(key) ?? { total: 0, scored: 0, scoreSum: 0, min: null, max: null };
    m.total += row._count._all;
    m.scored += row._count.overallScore;
    m.scoreSum += (row._avg.overallScore ?? 0) * row._count.overallScore;
    if (row._min.overallScore != null) m.min = m.min == null ? row._min.overallScore : Math.min(m.min, row._min.overallScore);
    if (row._max.overallScore != null) m.max = m.max == null ? row._max.overallScore : Math.max(m.max, row._max.overallScore);
    merged.set(key, m);
  }

  const rows = [...merged]
    .map(([email, m]) => {
      const last30 = last30ByAgent.get(email) ?? [];
      const last30Avg = last30.length ? Math.round(last30.reduce((a, b) => a + b, 0) / last30.length) : null;
      return {
        email,
        name: nameByEmail.get(email) ?? email,
        totalReviews: m.total,
        avgScore: m.scored > 0 ? Math.round(m.scoreSum / m.scored) : null,
        minScore: m.min,
        maxScore: m.max,
        last30Avg,
        last30Count: last30.length,
        openCoaching: coachingByAgent.get(email) ?? 0,
      };
    })
    .sort((a, b) => (a.avgScore ?? 0) - (b.avgScore ?? 0));

  return (
    <Panel
      eyebrow="Team"
      title="Agent Scorecards"
      description={
        <>
          Aggregate QA performance per agent, sorted lowest average score first.
          {portalAvailable
            ? ` Agent portal logins: ${seatsUsed} of ${seatLimit ?? "unlimited"} used.`
            : " Agents can see their own scores and coaching in the agent portal on Growth plans and above."}
        </>
      }
      action={
        canInvite ? (
          <InviteAgentDialog trigger={<Button size="sm" variant="outline">Invite agent</Button>} />
        ) : undefined
      }
    >
      <div className="overflow-x-auto border-t border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Reviews</TableHead>
              <TableHead>Avg Score</TableHead>
              <TableHead>Last 30 Days</TableHead>
              <TableHead>Range</TableHead>
              <TableHead>Coaching</TableHead>
              {isAdmin && portalAvailable && <TableHead>Portal</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.email}>
                <TableCell>
                  <Link href={`/qa/reviews?agent=${encodeURIComponent(row.email)}`} className="font-semibold hover:underline">
                    {row.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{row.email}</p>
                </TableCell>
                <TableCell>{row.totalReviews}</TableCell>
                <TableCell>
                  <ScoreChip score={row.avgScore} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.last30Count > 0 ? `${row.last30Avg} (${row.last30Count} reviews)` : "No recent reviews"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.minScore ?? "—"} – {row.maxScore ?? "—"}
                </TableCell>
                <TableCell>
                  <Link href={`/qa/coaching?status=all&agent=${encodeURIComponent(row.email.toLowerCase())}`} className="hover:underline">
                    {row.openCoaching > 0 ? <Badge variant="warning">{row.openCoaching} open</Badge> : <span className="text-xs text-muted-foreground">History</span>}
                  </Link>
                </TableCell>
                {isAdmin && portalAvailable && (
                  <TableCell>
                    {portalByEmail.get(row.email.toLowerCase()) ? (
                      <PortalAccessMenu
                        userId={portalByEmail.get(row.email.toLowerCase())!.id}
                        name={row.name}
                        isActive={portalByEmail.get(row.email.toLowerCase())!.isActive}
                      />
                    ) : canInvite ? (
                      <InviteAgentDialog
                        defaults={{ name: row.name === row.email ? "" : row.name, helpdeskEmail: row.email.toLowerCase() }}
                        trigger={<Button size="sm" variant="ghost">Invite</Button>}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">No seats left</span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableEmpty colSpan={isAdmin && portalAvailable ? 7 : 6}>No reviews yet.</TableEmpty>
            )}
          </TableBody>
        </Table>
      </div>
      {isAdmin && unmatched.length > 0 && (
        <div className="border-t border-border px-5 py-4">
          <p className="text-xs font-semibold text-muted-foreground">Portal logins without reviews yet</p>
          <ul className="mt-2 flex flex-col gap-2">
            {unmatched.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span>
                  <span className="font-semibold">{u.name}</span> <span className="text-xs text-muted-foreground">{u.helpdeskEmail ?? u.email}</span>
                </span>
                <PortalAccessMenu userId={u.id} name={u.name} isActive={u.isActive} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
