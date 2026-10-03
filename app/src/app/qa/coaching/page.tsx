import Link from "next/link";
import { Plus } from "lucide-react";

import { requireOrg } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelEmpty, PanelList } from "@/components/dashboard/panel";
import { StatTile } from "@/components/dashboard/stat-tile";
import { qaGrowthFeaturesAvailable } from "@/lib/qa/plan-features";
import { resolveScorecard } from "@/lib/qa/scorecard";
import { reviewedAgents } from "@/lib/qa/agents";
import { formatDate } from "@/lib/utils/format";
import { addDays, startOfDay } from "@/lib/utils/date-buckets";
import { cn } from "@/lib/utils";
import type { CoachingStatus, Prisma } from "@/generated/prisma/client";
import { GrowthUpsell } from "../growth-upsell";
import { NewCoachingDialog, UpdateCoachingDialog } from "./coaching-dialogs";

const FILTERS = {
  open: { label: "Open", statuses: ["ASSIGNED", "ACKNOWLEDGED"] },
  done: { label: "Completed", statuses: ["COMPLETED"] },
  all: { label: "All", statuses: ["ASSIGNED", "ACKNOWLEDGED", "COMPLETED", "CANCELLED"] },
} satisfies Record<string, { label: string; statuses: CoachingStatus[] }>;

const STATUS_BADGE: Record<CoachingStatus, { label: string; variant: "warning" | "soft" | "success" | "secondary" }> = {
  ASSIGNED: { label: "Assigned", variant: "warning" },
  ACKNOWLEDGED: { label: "Acknowledged", variant: "soft" },
  COMPLETED: { label: "Completed", variant: "success" },
  CANCELLED: { label: "Cancelled", variant: "secondary" },
};

export default async function CoachingPage({ searchParams }: { searchParams: Promise<{ status?: string; agent?: string; new?: string }> }) {
  const session = await requireOrg();
  const organizationId = session.user.organizationId;
  const isAdmin = session.user.orgRole === "OWNER" || session.user.orgRole === "ADMIN";
  const params = await searchParams;
  const filterKey = (params.status && params.status in FILTERS ? params.status : "open") as keyof typeof FILTERS;
  const agent = params.agent?.toLowerCase();
  const today = startOfDay();

  const where: Prisma.CoachingSessionWhereInput = {
    organizationId,
    status: { in: FILTERS[filterKey].statuses },
    ...(agent ? { agentEmail: agent } : {}),
  };
  const [available, sessions, agents, scorecard, openCount, overdueCount, completed30] = await Promise.all([
    qaGrowthFeaturesAvailable(organizationId),
    prisma.coachingSession.findMany({
      where,
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 100,
      include: { coach: { select: { id: true, name: true } }, review: { select: { id: true, ticketId: true, overallScore: true } } },
    }),
    reviewedAgents(organizationId),
    resolveScorecard(organizationId),
    prisma.coachingSession.count({ where: { organizationId, status: { in: ["ASSIGNED", "ACKNOWLEDGED"] } } }),
    prisma.coachingSession.count({ where: { organizationId, status: { in: ["ASSIGNED", "ACKNOWLEDGED"] }, dueDate: { lt: today } } }),
    prisma.coachingSession.count({ where: { organizationId, status: "COMPLETED", completedAt: { gte: addDays(today, -30) } } }),
  ]);
  const focusOptions = scorecard.criteria.map((c) => c.label);
  const hasAny = openCount > 0 || sessions.length > 0;

  const tabHref = (key: string) => `/qa/coaching?status=${key}${agent ? `&agent=${encodeURIComponent(agent)}` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      {hasAny && (
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Open" value={openCount} />
          <StatTile label="Overdue" value={overdueCount} tone={overdueCount ? "destructive" : "default"} />
          <StatTile label="Completed (30 days)" value={completed30} tone="success" />
        </div>
      )}
      <Panel
        eyebrow="Quality"
        title={agent ? <>Coaching: {agents.find((a) => a.email === agent)?.name ?? agent}</> : "Coaching"}
        description="Turn low scores into improvement: assign agents focused coaching, record their response, and track it to completion."
        action={
          available ? (
            <NewCoachingDialog
              agents={agents}
              focusOptions={focusOptions}
              defaults={{ agentEmail: agent }}
              defaultOpen={params.new === "1"}
              trigger={
                <Button size="sm" disabled={agents.length === 0}>
                  <Plus /> Assign coaching
                </Button>
              }
            />
          ) : undefined
        }
      >
        {!available && (
          <GrowthUpsell feature="Coaching" canUpgrade={isAdmin}>
            {hasAny ? "Existing sessions can still be completed." : null}
          </GrowthUpsell>
        )}
        <nav className="flex gap-1 px-5 pb-3" aria-label="Filter sessions">
          {Object.entries(FILTERS).map(([key, f]) => (
            <Link
              key={key}
              href={tabHref(key)}
              aria-current={key === filterKey ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-semibold",
                key === filterKey ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {f.label}
            </Link>
          ))}
          {agent && (
            <Link href={`/qa/coaching?status=${filterKey}`} className="ml-auto text-xs text-muted-foreground hover:underline">
              Show all agents
            </Link>
          )}
        </nav>
        {sessions.length === 0 ? (
          <PanelEmpty>
            {filterKey === "open" ? "No open coaching sessions." : "No coaching sessions here yet."}
            {available && agents.length > 0 && filterKey === "open" && " Assign one from a review, or with the button above."}
          </PanelEmpty>
        ) : (
          <PanelList>
            {sessions.map((s) => {
              const focusAreas = (s.focusAreas as string[] | null) ?? [];
              const isOpen = s.status === "ASSIGNED" || s.status === "ACKNOWLEDGED";
              const overdue = isOpen && s.dueDate != null && s.dueDate < today;
              const canUpdate = isOpen && (isAdmin || s.coach.id === session.user.id);
              const badge = STATUS_BADGE[s.status];
              return (
                <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
                      <Link href={`/qa/coaching?status=${filterKey}&agent=${encodeURIComponent(s.agentEmail)}`} className="hover:underline">
                        {s.agentName || s.agentEmail}
                      </Link>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      {overdue && <Badge variant="destructive">Overdue</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Coach {s.coach.name} · Assigned {formatDate(s.createdAt)}
                      {s.dueDate && ` · Due ${formatDate(s.dueDate)}`}
                      {s.review && (
                        <>
                          {" · "}
                          <Link href={`/qa/reviews/${s.review.id}`} className="hover:underline">
                            Ticket #{s.review.ticketId}
                            {s.review.overallScore != null && ` (${s.review.overallScore})`}
                          </Link>
                        </>
                      )}
                    </p>
                    {focusAreas.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {focusAreas.map((f) => (
                          <Badge key={f} variant="outline">
                            {f}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 line-clamp-3 max-w-prose text-[13px] leading-relaxed whitespace-pre-wrap">{s.notes}</p>
                    {s.agentResponse && (
                      <p className="mt-2 max-w-prose border-l-2 border-primary/40 pl-3 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">Agent:</span> {s.agentResponse}
                      </p>
                    )}
                    {s.outcome && (
                      <p className="mt-1 max-w-prose border-l-2 border-success/40 pl-3 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">Outcome:</span> {s.outcome}
                      </p>
                    )}
                  </div>
                  {canUpdate && (
                    <UpdateCoachingDialog
                      id={s.id}
                      status={s.status as "ASSIGNED" | "ACKNOWLEDGED"}
                      agentName={s.agentName || s.agentEmail}
                      notes={s.notes}
                      focusAreas={focusAreas}
                    />
                  )}
                </li>
              );
            })}
          </PanelList>
        )}
      </Panel>
    </div>
  );
}
