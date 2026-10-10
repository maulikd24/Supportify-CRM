import Link from "next/link";
import { notFound } from "next/navigation";

import { requireProductAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Panel, PanelEmpty, PanelLink } from "@/components/dashboard/panel";
import { StatTile } from "@/components/dashboard/stat-tile";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/lib/utils/format";
import { dailySeries, utcDayStart } from "@/lib/cx/insights";
import { formatChange, formatCsat, formatSentiment, formatShare } from "@/lib/cx/format";
import { periodChange } from "@/lib/cx/impact";
import { TopicEditor } from "./topic-editor";
import { IssuesPanel } from "./issues-panel";

const DAYS = 30;
const DAY_MS = 86_400_000;

export default async function CxTopicPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireProductAccess("CX_INTELLIGENCE");
  const organizationId = session.user.organizationId;
  const isAdmin = session.user.orgRole === "OWNER" || session.user.orgRole === "ADMIN";
  const canTrack = isAdmin || session.user.orgRole === "MEMBER";
  const { id } = await params;

  const topic = await prisma.topic.findFirst({
    where: { id, organizationId },
    include: { parent: { select: { id: true, name: true } }, ownerTeam: { select: { id: true, name: true } } },
  });
  if (!topic) notFound();
  if (topic.status === "MERGED" && topic.mergedIntoId) {
    const into = await prisma.topic.findFirst({ where: { id: topic.mergedIntoId, organizationId }, select: { id: true, name: true } });
    return (
      <Panel eyebrow="Topic" title={topic.name}>
        <PanelEmpty>
          This topic was merged into {into ? <Link href={`/cx/topics/${into.id}`} className="font-medium underline">{into.name}</Link> : "another topic"}.
        </PanelEmpty>
      </Panel>
    );
  }

  const end = new Date(utcDayStart().getTime() + DAY_MS);
  const from = new Date(end.getTime() - DAYS * DAY_MS);
  const isTheme = !topic.parentId;
  // A theme's figures are its topics' figures together.
  const children = isTheme ? await prisma.topic.findMany({ where: { organizationId, parentId: topic.id, status: "ACTIVE" }, select: { id: true, name: true } }) : [];
  const topicIds = isTheme ? children.map((c) => c.id) : [topic.id];

  const [series, previous, rootCauses, recent, issues, teams, themes, siblings] = await Promise.all([
    Promise.all(topicIds.map((t) => dailySeries(organizationId, "topic", t, from, DAYS))),
    prisma.cxMetricBucket.aggregate({
      where: { organizationId, dimension: "topic", dimensionId: { in: topicIds }, day: { gte: new Date(from.getTime() - DAYS * DAY_MS), lt: from } },
      _sum: { conversations: true },
    }),
    prisma.conversationAnalysis.groupBy({
      by: ["rootCause"],
      where: { rootCause: { not: null }, conversation: { organizationId, startedAt: { gte: from }, topics: { some: { topicId: { in: topicIds } } } } },
      _count: { _all: true },
      orderBy: { _count: { rootCause: "desc" } },
      take: 8,
    }),
    prisma.conversationTopic.findMany({
      where: { organizationId, topicId: { in: topicIds } },
      orderBy: { startedAt: "desc" },
      take: 15,
      select: { evidence: true, startedAt: true, conversation: { select: { id: true, subject: true, analysis: { select: { sentiment: true } } } } },
    }),
    prisma.topicIssue.findMany({
      where: { organizationId, topicId: topic.id },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: { ownerTeam: { select: { name: true } } },
    }),
    prisma.team.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.topic.findMany({ where: { organizationId, parentId: null, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.topic.findMany({ where: { organizationId, parentId: { not: null }, status: "ACTIVE", id: { not: topic.id } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  // Sum the per-topic series day by day (a conversation under two of the theme's topics counts twice).
  const days = series[0]?.map((p, i) => {
    const pts = series.map((s) => s[i]);
    const n = pts.reduce((a, p2) => a + p2.conversations, 0);
    const w = (pick: (p: (typeof pts)[number]) => number | null) => {
      let sum = 0;
      let weight = 0;
      for (const q of pts) {
        const v = pick(q);
        if (v != null) {
          sum += v * q.conversations;
          weight += q.conversations;
        }
      }
      return weight ? sum / weight : null;
    };
    return { day: p.day, conversations: n, sentiment: w((q) => q.sentiment), negativeShare: w((q) => q.negativeShare), predictedCsat: w((q) => q.predictedCsat) };
  }) ?? [];
  const total = days.reduce((n, d) => n + d.conversations, 0);
  const weighted = (pick: (d: (typeof days)[number]) => number | null) => {
    const withValue = days.filter((d) => pick(d) != null);
    const weight = withValue.reduce((n, d) => n + d.conversations, 0);
    return weight ? withValue.reduce((n, d) => n + pick(d)! * d.conversations, 0) / weight : null;
  };
  const latest = recent.filter((r, i, all) => all.findIndex((x) => x.conversation.id === r.conversation.id) === i);
  const change = formatChange(periodChange(total, previous._sum.conversations ?? 0));
  const shortDay = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            <Link href="/cx/topics" className="hover:underline">Topics</Link>
            {topic.parent && (
              <>
                {" › "}
                <Link href={`/cx/topics/${topic.parent.id}`} className="hover:underline">{topic.parent.name}</Link>
              </>
            )}
          </p>
          <h2 className="mt-0.5 flex flex-wrap items-center gap-2 font-heading text-[19px] font-extrabold">
            {topic.name}
            {isTheme && <Badge variant="secondary">Theme</Badge>}
            {topic.status === "ARCHIVED" && <Badge variant="outline">Archived</Badge>}
          </h2>
          {topic.description && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{topic.description}</p>}
          <p className="mt-1 text-xs text-muted-foreground">Owned by {topic.ownerTeam?.name ?? "no team yet"}</p>
        </div>
        {isAdmin && topic.status === "ACTIVE" && (
          <TopicEditor
            topic={{ id: topic.id, name: topic.name, description: topic.description, parentId: topic.parentId, ownerTeamId: topic.ownerTeamId }}
            themes={themes}
            teams={teams}
            mergeTargets={isTheme ? [] : siblings}
          />
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Conversations" value={formatNumber(total)} hint={change ? `${change} vs previous ${DAYS} days` : `Last ${DAYS} days`} />
        <StatTile label="Average sentiment" value={formatSentiment(weighted((d) => d.sentiment))} />
        <StatTile label="Negative conversations" value={formatShare(weighted((d) => d.negativeShare))} />
        <StatTile label="Predicted CSAT" value={formatCsat(weighted((d) => d.predictedCsat))} hint="Out of 5" />
      </div>

      <Panel eyebrow="Trend" title="Conversations per day" description={`Last ${DAYS} days (UTC).`}>
        <div className="px-5 pb-4">
          <TrendChart data={days.map((d) => ({ label: shortDay(d.day), value: d.conversations }))} valueLabel="Conversations" valueFormat="compact" />
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel eyebrow="Why" title="Root causes" description={`The underlying reason the analysis gave, most common first, last ${DAYS} days.`}>
          {rootCauses.length === 0 ? (
            <PanelEmpty>No analysed conversations in the last {DAYS} days.</PanelEmpty>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {rootCauses.map((r) => (
                <li key={r.rootCause} className="flex items-baseline justify-between gap-3 px-5 py-2.5 text-sm">
                  <span className="min-w-0">{r.rootCause}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatNumber(r._count._all)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <IssuesPanel
          topicId={topic.id}
          canEdit={canTrack}
          teams={teams}
          defaultTeamId={topic.ownerTeamId}
          issues={issues.map((i) => ({
            id: i.id,
            title: i.title,
            note: i.note,
            status: i.status,
            teamName: i.ownerTeam?.name ?? null,
            createdLabel: formatDate(i.createdAt),
            resolvedLabel: i.resolvedAt ? formatDate(i.resolvedAt) : null,
          }))}
        />
      </div>

      {isTheme && children.length > 0 && (
        <Panel eyebrow="Theme" title="Topics in this theme">
          <ul className="divide-y divide-border border-t border-border">
            {children.map((c) => (
              <li key={c.id} className="px-5 py-2.5 text-sm">
                <Link href={`/cx/topics/${c.id}`} className="hover:underline">{c.name}</Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        eyebrow="Evidence"
        title="Recent conversations"
        action={!isTheme && <PanelLink href={`/cx/conversations?topic=${topic.id}`}>All conversations</PanelLink>}
      >
        {latest.length === 0 ? (
          <PanelEmpty>No conversations under this topic yet.</PanelEmpty>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {latest.map((r) => (
              <li key={r.conversation.id} className="px-5 py-2.5 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <Link href={`/cx/conversations/${r.conversation.id}`} className="min-w-0 truncate font-medium hover:underline">
                    {r.conversation.subject || "(no subject)"}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDate(r.startedAt)} · {formatSentiment(r.conversation.analysis?.sentiment ?? null)}
                  </span>
                </div>
                {r.evidence && <p className="mt-0.5 truncate text-xs text-muted-foreground">“{r.evidence}”</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
