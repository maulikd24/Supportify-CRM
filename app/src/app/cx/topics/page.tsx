import Link from "next/link";

import { requireProductAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Panel, PanelEmpty } from "@/components/dashboard/panel";
import { formatDate, formatNumber } from "@/lib/utils/format";
import { MIN_CONVERSATIONS_FOR_DISCOVERY } from "@/lib/cx/ai/discover";
import { addDays, startOfDay } from "@/lib/utils/date-buckets";
import { AcceptProposal, AddTopicForm } from "./topic-admin";

const DAYS = 30;

export default async function CxTopicsPage() {
  const session = await requireProductAccess("CX_INTELLIGENCE");
  const organizationId = session.user.organizationId;
  const isAdmin = session.user.orgRole === "OWNER" || session.user.orgRole === "ADMIN";
  const since = addDays(startOfDay(), -DAYS);

  const [version, topics, counts, proposals, conversations] = await Promise.all([
    prisma.taxonomyVersion.findFirst({ where: { organizationId }, orderBy: { version: "desc" }, select: { status: true, createdAt: true, updatedAt: true } }),
    prisma.topic.findMany({ where: { organizationId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, description: true, parentId: true } }),
    prisma.conversationTopic.groupBy({ by: ["topicId"], where: { organizationId, startedAt: { gte: since } }, _count: { _all: true } }),
    prisma.conversationAnalysis.groupBy({
      by: ["proposedTopic"],
      where: { conversation: { organizationId, startedAt: { gte: since } }, proposedTopic: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { proposedTopic: "desc" } },
      take: 10,
    }),
    prisma.conversation.count({ where: { organizationId } }),
  ]);
  // A suggestion stays on its conversations until they're re-analysed; hide ones already added.
  const topicNames = new Set(topics.map((t) => t.name.toLowerCase()));
  const suggestions = proposals.filter((p) => p.proposedTopic && !topicNames.has(p.proposedTopic.toLowerCase()));
  const countBy = new Map(counts.map((c) => [c.topicId, c._count._all]));
  const themes = topics.filter((t) => !t.parentId);
  const childrenOf = (id: string) => topics.filter((t) => t.parentId === id).sort((a, b) => (countBy.get(b.id) ?? 0) - (countBy.get(a.id) ?? 0));
  const themeTotal = (id: string) => childrenOf(id).reduce((n, t) => n + (countBy.get(t.id) ?? 0), 0);

  if (!version || version.status !== "active") {
    const message =
      version?.status === "discovering" || version?.status === "merging"
        ? "Reading a sample of your conversations to work out what customers contact you about. This takes a few minutes."
        : version?.status === "failed"
          ? "Building your topic list didn't finish. It will try again automatically within a few hours."
          : conversations < MIN_CONVERSATIONS_FOR_DISCOVERY
            ? `Your topic list is built automatically once ${MIN_CONVERSATIONS_FOR_DISCOVERY} conversations have been imported (${formatNumber(conversations)} so far).`
            : "Your topic list will be built on the next run, within a few minutes.";
    return (
      <Panel eyebrow="CX Intelligence" title="Topics">
        <PanelEmpty>{message}</PanelEmpty>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel
        eyebrow="CX Intelligence"
        title="Topics"
        description={`Found automatically from your conversations on ${formatDate(version.updatedAt)}. Counts are for the last ${DAYS} days; a conversation can have up to three topics.`}
      >
        <div className="grid gap-4 border-t border-border p-5 md:grid-cols-2">
          {themes
            .sort((a, b) => themeTotal(b.id) - themeTotal(a.id))
            .map((theme) => (
              <section key={theme.id} className="rounded-md border p-4">
                <h3 className="flex items-baseline justify-between gap-2 text-sm font-semibold">
                  <Link href={`/cx/topics/${theme.id}`} className="hover:underline">
                    {theme.name}
                  </Link>
                  <span className="text-xs font-normal text-muted-foreground">{formatNumber(themeTotal(theme.id))}</span>
                </h3>
                {theme.description && <p className="mt-0.5 text-xs text-muted-foreground">{theme.description}</p>}
                <ul className="mt-3 flex flex-col gap-1.5 text-sm">
                  {childrenOf(theme.id).map((t) => (
                    <li key={t.id} className="flex items-baseline justify-between gap-2" title={t.description ?? undefined}>
                      <Link href={`/cx/topics/${t.id}`} className="truncate hover:underline">
                        {t.name}
                      </Link>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatNumber(countBy.get(t.id) ?? 0)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
        {isAdmin && <AddTopicForm themes={themes.map((t) => ({ id: t.id, name: t.name }))} />}
      </Panel>

      {suggestions.length > 0 && (
        <Panel eyebrow="Topics" title="Suggested new topics" description="Conversations that didn't fit any topic, by the topic the analysis suggested.">
          <ul className="flex flex-col gap-1 border-t border-border p-5 text-sm">
            {suggestions.map((p) => (
              <li key={p.proposedTopic} className="flex items-center justify-between gap-2">
                <span className="min-w-0">{p.proposedTopic}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-muted-foreground">{formatNumber(p._count._all)}</span>
                  {isAdmin && p.proposedTopic && <AcceptProposal proposed={p.proposedTopic} themes={themes.map((t) => ({ id: t.id, name: t.name }))} />}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
