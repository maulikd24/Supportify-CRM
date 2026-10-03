import { requireAgent } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelEmpty, PanelList, PanelRow } from "@/components/dashboard/panel";
import { StatTile } from "@/components/dashboard/stat-tile";
import { ScoreChip } from "@/components/dashboard/score-chip";
import { agentIdentity, agentReviewsWhere } from "@/lib/qa/portal";
import { LOW_SCORE } from "@/lib/qa/score";
import { formatDate } from "@/lib/utils/format";
import { addDays, startOfDay } from "@/lib/utils/date-buckets";

function average(scores: (number | null)[]): number | null {
  const values = scores.filter((s): s is number => s != null);
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

export default async function PortalHomePage() {
  const session = await requireAgent();
  const { organizationId } = session.user;
  const agent = await agentIdentity(session.user.id, organizationId);
  const mine = { organizationId, ...agentReviewsWhere(agent.emails) };
  const today = startOfDay();

  const [reviews, last30, prev30, openCoaching] = await Promise.all([
    prisma.ticketReview.findMany({
      where: mine,
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, ticketId: true, ticketSubject: true, overallScore: true, autoFailed: true, createdAt: true, disputes: { where: { status: "OPEN" }, select: { id: true } } },
    }),
    prisma.ticketReview.findMany({ where: { ...mine, createdAt: { gte: addDays(today, -30) } }, select: { overallScore: true } }),
    prisma.ticketReview.findMany({ where: { ...mine, createdAt: { gte: addDays(today, -60), lt: addDays(today, -30) } }, select: { overallScore: true } }),
    prisma.coachingSession.count({ where: { organizationId, agentEmail: { in: agent.emails }, status: { in: ["ASSIGNED", "ACKNOWLEDGED"] } } }),
  ]);
  const avg30 = average(last30.map((r) => r.overallScore));
  const avgPrev = average(prev30.map((r) => r.overallScore));
  const delta = avg30 != null && avgPrev != null ? avg30 - avgPrev : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Average (30 days)"
          value={avg30 ?? "—"}
          tone={avg30 != null && avg30 < LOW_SCORE ? "warning" : "default"}
          hint={delta != null ? `${delta >= 0 ? "+" : ""}${delta} vs previous 30 days` : undefined}
        />
        <StatTile label="Reviews (30 days)" value={last30.length} />
        <StatTile label="Below target" value={last30.filter((r) => r.overallScore != null && r.overallScore < LOW_SCORE).length} hint={`Under ${LOW_SCORE}`} />
        <StatTile label="Open coaching" value={openCoaching} tone={openCoaching ? "warning" : "default"} />
      </div>

      <Panel eyebrow={`Hi ${agent.name.split(" ")[0]}`} title="My reviews" description="Every QA review of your tickets. Open one to see the breakdown, or dispute a score you think is wrong.">
        {reviews.length === 0 ? (
          <PanelEmpty>No reviews of your tickets yet.</PanelEmpty>
        ) : (
          <PanelList>
            {reviews.map((r) => (
              <PanelRow
                key={r.id}
                tone={r.overallScore != null && r.overallScore < LOW_SCORE ? "destructive" : "muted"}
                title={r.ticketSubject || `Ticket #${r.ticketId}`}
                meta={`Ticket #${r.ticketId} · ${formatDate(r.createdAt)}`}
                trailing={
                  <span className="flex items-center gap-2">
                    {r.disputes.length > 0 && <Badge variant="warning">Disputed</Badge>}
                    {r.autoFailed && <Badge variant="destructive">Auto-fail</Badge>}
                    <ScoreChip score={r.overallScore} />
                  </span>
                }
                href={`/portal/reviews/${r.id}`}
                hrefLabel="Open review"
              />
            ))}
          </PanelList>
        )}
      </Panel>
    </div>
  );
}
