import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Badge } from "@/components/ui/badge";
import { Eyebrow, Panel, PanelEmpty, PanelList } from "@/components/dashboard/panel";
import { CLIENT_STATUS_VARIANT, PRIORITY_VARIANT, humanize } from "@/lib/crm/badges";
import { ActivityTimeline } from "@/components/timeline/activity-timeline";
import { StageTracker } from "@/components/stage-tracker";
import { ClientActionsPanel } from "./client-actions-panel";
import { ClientTasksPanel } from "./client-tasks-panel";
import { SendMessagePanel } from "./send-message-panel";
import { StageActionCard } from "./stage-action-card";
import { ClientCopilotPanel } from "./client-copilot-panel";
import { AddDocumentForm } from "./add-document-form";
import { DocumentRowActions } from "./document-row-actions";
import { formatDateTime } from "@/lib/utils/format";
import { computeSlaStatus, stageAgeHours } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import { computePriorityScore, computeHealthStatus } from "@/lib/copilot/scoring";
import { getNextBestAction } from "@/lib/copilot/next-best-action";
import { getMilestoneChecklist } from "@/lib/copilot/milestones";
import { suggestMessageTemplate } from "@/lib/copilot/message-suggestion";
import type { CopilotClient } from "@/lib/copilot/types";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireUser();
  const { id } = await params;

  const [client, visibleUserIds, users, templates, stages, exceptions, customFieldDefinitions] = await Promise.all([
    prisma.client.findUnique({
      where: { id, organizationId: session.user.organizationId },
      include: {
        assignedTo: true,
        currentStage: true,
        documents: { orderBy: { createdAt: "asc" }, take: 50 },
        activities: { include: { user: true }, orderBy: { createdAt: "desc" }, take: 50 },
        tasks: { orderBy: { dueAt: "asc" }, take: 50 },
      },
    }),
    getVisibleUserIds(session.user.id, session.user.role, session.user.organizationId),
    prisma.user.findMany({
      where: { organizationId: session.user.organizationId, isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.messageTemplate.findMany({ where: { organizationId: session.user.organizationId, approved: true } }),
    prisma.stage.findMany({
      where: { organizationId: session.user.organizationId, isActive: true },
      orderBy: { sequence: "asc" },
    }),
    prisma.exception.findMany({ where: { clientId: id }, select: { stageId: true, createdAt: true, resolvedAt: true } }),
    prisma.customFieldDefinition.findMany({
      where: { organizationId: session.user.organizationId },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  if (!client) notFound();
  if (visibleUserIds && (!client.assignedToId || !visibleUserIds.includes(client.assignedToId))) {
    notFound();
  }

  const now = new Date();
  const heldMs = exceptions
    .filter((e) => e.stageId === client.currentStageId)
    .reduce((sum, e) => sum + Math.max(0, (e.resolvedAt ?? now).getTime() - e.createdAt.getTime()), 0);
  const effectiveEnteredAt = effectiveStageEnteredAt(client.stageEnteredAt, heldMs);
  const slaStatus = computeSlaStatus(effectiveEnteredAt, client.currentStage.slaHours, now);
  const ageHours = stageAgeHours(effectiveEnteredAt, now);
  const daysSinceLastActivity = client.activities[0]
    ? Math.floor((now.getTime() - client.activities[0].createdAt.getTime()) / (1000 * 60 * 60 * 24))
    : Math.floor((now.getTime() - client.createdAt.getTime()) / (1000 * 60 * 60 * 24));
  const overdueTaskCount = client.tasks.filter((t) => t.status === "OVERDUE").length;

  const copilotClient: CopilotClient = client;
  const priorityScore = computePriorityScore({
    priority: client.priority,
    slaStatus,
    overdueTaskCount,
    daysSinceLastActivity,
    clientStatus: client.status,
  });
  const healthResult = computeHealthStatus({
    slaStatus,
    stageAgeHours: ageHours,
    benchmarkAvgHours: null,
    daysSinceLastActivity,
  });
  const nba = getNextBestAction(copilotClient, daysSinceLastActivity);
  const milestones = getMilestoneChecklist(copilotClient, stages);
  const messageSuggestion = suggestMessageTemplate(nba, { ...copilotClient, assignedTo: client.assignedTo }, templates);
  const suggestedFollowUp = { title: nba.label, dueAtIso: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString() };

  // Prisma's Decimal fields aren't plain-serializable across the Server->Client Component
  // boundary — convert to plain numbers before passing down to any "use client" component.
  const serializedClient = {
    ...client,
    dealValue: client.dealValue ? Number(client.dealValue) : null,
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Eyebrow>Client · {client.clientCode}</Eyebrow>
            <h2 className="mt-1 truncate font-heading text-[19px] font-extrabold">{client.name}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {client.mobile} · {client.email ?? "no email"} · {client.assignedTo?.name ?? "Unassigned"}
            </p>
          </div>
          <div className="flex gap-2">
            <Badge variant={PRIORITY_VARIANT[client.priority]}>{humanize(client.priority)} priority</Badge>
            <Badge variant={CLIENT_STATUS_VARIANT[client.status]}>{humanize(client.status)}</Badge>
          </div>
        </div>
        <div className="mt-5">
          <StageTracker stages={stages} currentSequence={client.currentStage.sequence} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <StageActionCard client={serializedClient} stages={stages} customFieldDefinitions={customFieldDefinitions} />

          <Panel eyebrow="Onboarding" title="Documents">
            {client.documents.length === 0 ? (
              <PanelEmpty>No documents yet.</PanelEmpty>
            ) : (
              <PanelList>
                {client.documents.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span className="text-[13px] font-semibold">{doc.documentType}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={doc.status === "REJECTED" ? "destructive" : doc.status === "VERIFIED" ? "success" : "secondary"}>
                        {humanize(doc.status)}
                      </Badge>
                      <DocumentRowActions documentId={doc.id} status={doc.status} />
                    </div>
                  </li>
                ))}
              </PanelList>
            )}
            <div className="border-t border-border px-5 py-4">
              <AddDocumentForm clientId={client.id} />
            </div>
          </Panel>

          <Panel eyebrow="History" title="Activity timeline" bodyClassName="px-5 pb-5">
            <ActivityTimeline activities={client.activities} clientId={client.id} />
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <ClientActionsPanel client={serializedClient} users={users} currentUserRole={session.user.role} />
          <ClientCopilotPanel
            clientId={client.id}
            assignedToId={client.assignedToId}
            priority={priorityScore}
            health={healthResult}
            nba={nba}
            milestones={milestones}
            messageSuggestion={messageSuggestion}
            suggestedFollowUp={suggestedFollowUp}
            users={users}
          />
          <SendMessagePanel clientId={client.id} templates={templates} />
          <ClientTasksPanel client={serializedClient} tasks={client.tasks} users={users} />
          <p className="px-1 text-[11px] text-muted-foreground">
            Created {formatDateTime(client.createdAt)} by stage engine
          </p>
        </div>
      </div>
    </div>
  );
}
