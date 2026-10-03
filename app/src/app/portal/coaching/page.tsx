import Link from "next/link";

import { requireAgent } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelEmpty, PanelList } from "@/components/dashboard/panel";
import { agentIdentity } from "@/lib/qa/portal";
import { formatDate } from "@/lib/utils/format";
import { startOfDay } from "@/lib/utils/date-buckets";
import type { CoachingStatus } from "@/generated/prisma/client";
import { AcknowledgeCoachingDialog } from "./acknowledge-dialog";

const STATUS: Record<CoachingStatus, { label: string; variant: "warning" | "soft" | "success" | "secondary" }> = {
  ASSIGNED: { label: "New", variant: "warning" },
  ACKNOWLEDGED: { label: "In progress", variant: "soft" },
  COMPLETED: { label: "Completed", variant: "success" },
  CANCELLED: { label: "Cancelled", variant: "secondary" },
};

export default async function PortalCoachingPage() {
  const session = await requireAgent();
  const { organizationId } = session.user;
  const agent = await agentIdentity(session.user.id, organizationId);
  const today = startOfDay();

  const sessions = await prisma.coachingSession.findMany({
    where: { organizationId, agentEmail: { in: agent.emails }, status: { not: "CANCELLED" } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
    include: { coach: { select: { name: true } }, review: { select: { id: true, ticketId: true } } },
  });

  return (
    <Panel eyebrow="From your QA team" title="My coaching" description="Coaching from your QA team. Acknowledge new sessions to let your coach know you've read them.">
      {sessions.length === 0 ? (
        <PanelEmpty>No coaching sessions yet.</PanelEmpty>
      ) : (
        <PanelList>
          {sessions.map((s) => {
            const focusAreas = (s.focusAreas as string[] | null) ?? [];
            const overdue = (s.status === "ASSIGNED" || s.status === "ACKNOWLEDGED") && s.dueDate != null && s.dueDate < today;
            return (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
                    From {s.coach.name}
                    <Badge variant={STATUS[s.status].variant}>{STATUS[s.status].label}</Badge>
                    {overdue && <Badge variant="destructive">Overdue</Badge>}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDate(s.createdAt)}
                    {s.dueDate && ` · Due ${formatDate(s.dueDate)}`}
                    {s.review && (
                      <>
                        {" · "}
                        <Link href={`/portal/reviews/${s.review.id}`} className="hover:underline">
                          Ticket #{s.review.ticketId}
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
                  <p className="mt-2 max-w-prose text-[13px] leading-relaxed whitespace-pre-wrap">{s.notes}</p>
                  {s.agentResponse && (
                    <p className="mt-2 max-w-prose border-l-2 border-primary/40 pl-3 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">You:</span> {s.agentResponse}
                    </p>
                  )}
                  {s.outcome && (
                    <p className="mt-1 max-w-prose border-l-2 border-success/40 pl-3 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">Outcome:</span> {s.outcome}
                    </p>
                  )}
                </div>
                {s.status === "ASSIGNED" && <AcknowledgeCoachingDialog id={s.id} coachName={s.coach.name} />}
              </li>
            );
          })}
        </PanelList>
      )}
    </Panel>
  );
}
