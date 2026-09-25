import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/activities/log-activity";
import { onEvent } from "@/lib/journeys/dispatch";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Core stage-move primitive: records history + an audit log entry, updates
 * the client's current stage, and auto-completes the client if the target
 * stage is marked `isTerminal` (see Stage.isTerminal in schema.prisma) —
 * this replaces the old hardcoded KYC+funding+dealer-intro completion check
 * with a generic, per-org-configurable rule.
 */
async function advanceStage(
  clientId: string,
  toStageId: string,
  actorId: string,
  reason?: string,
  auditAction: string = "stage_changed",
) {
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    include: { currentStage: true },
  });
  // Scoped by the client's own org — a stage ID from another tenant must never be reachable here.
  const toStage = await prisma.stage.findUniqueOrThrow({
    where: { id: toStageId, organizationId: client.organizationId },
  });

  await prisma.$transaction([
    prisma.stageHistory.create({
      data: { clientId, fromStageId: client.currentStageId, toStageId, changedById: actorId, reason },
    }),
    prisma.auditLog.create({
      data: {
        organizationId: client.organizationId,
        userId: actorId,
        entity: "Client",
        entityId: clientId,
        action: auditAction,
        oldValue: { stage: client.currentStage.name },
        newValue: { stage: toStage.name },
        reason,
      },
    }),
    prisma.client.update({
      where: { id: clientId },
      data: {
        currentStageId: toStageId,
        stageEnteredAt: new Date(),
        ...(toStage.isTerminal ? { status: "COMPLETED" as const, completedAt: new Date() } : {}),
      },
    }),
  ]);

  await logActivity({
    clientId,
    userId: actorId,
    type: "STAGE_CHANGE",
    payload: {
      message: `Stage changed to ${toStage.name}`,
      fromStage: client.currentStage.name,
      toStage: toStage.name,
    },
  });

  await onEvent("stage_changed", clientId);

  void dispatchWebhookEvent(client.organizationId, "client.stage_changed", {
    clientId,
    fromStage: client.currentStage.name,
    toStage: toStage.name,
    reason: reason ?? null,
  });

  return toStage;
}

/** Manual move to any active stage in the org's pipeline — the generic replacement for the old per-stage submit/complete actions. */
export async function moveToStage(clientId: string, toStageId: string, actorId: string, reason?: string) {
  return advanceStage(clientId, toStageId, actorId, reason);
}

/** Manager/Admin-only: move a client to any stage with a mandatory reason (bypasses normal flow, e.g. correcting a mistake). */
export async function correctStage(clientId: string, toStageId: string, reason: string, actorId: string) {
  if (!reason) throw new Error("A reason is required for a manual stage correction");
  return advanceStage(clientId, toStageId, actorId, reason, "stage_corrected");
}

/** Called right after a Client row is created with currentStageId already set to the org's first stage. */
export async function initializeClient(clientId: string, actorId: string) {
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    include: { currentStage: true },
  });

  await prisma.stageHistory.create({
    data: { clientId, fromStageId: null, toStageId: client.currentStageId, changedById: actorId, reason: "Client created" },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: client.organizationId,
      userId: actorId,
      entity: "Client",
      entityId: clientId,
      action: "created",
      newValue: { stage: client.currentStage.name },
    },
  });

  if (client.assignedToId) {
    await prisma.task.create({
      data: {
        organizationId: client.organizationId,
        clientId,
        assignedToId: client.assignedToId,
        title: "Contact Client",
        dueAt: new Date(Date.now() + client.currentStage.slaHours * 60 * 60 * 1000),
        source: "stage-engine",
      },
    });
    await prisma.notification.create({
      data: {
        organizationId: client.organizationId,
        userId: client.assignedToId,
        type: "new_assignment",
        payload: { clientId, clientName: client.name },
      },
    });
  }

  await logActivity({ clientId, userId: actorId, type: "NOTE", payload: { message: "Client created" } });
  await onEvent("client_created", clientId);
}

/** Logs a sales contact touchpoint — available at any stage, not gated to one specific step of the pipeline. */
export async function recordRmContact(
  clientId: string,
  input: {
    contactMethod: "Phone" | "WhatsApp" | "In-person" | "Email" | "Other";
    contactOutcome: "Connected" | "Call back requested" | "Interested" | "Not interested" | "Unreachable" | "Wrong number";
    notes?: string;
    nextAction?: string;
    nextActionDate?: Date;
  },
  actorId: string,
) {
  const requiresNotes = ["Not interested", "Unreachable", "Wrong number"];
  const requiresNextAction = ["Call back requested", "Interested"];
  if (requiresNotes.includes(input.contactOutcome) && !input.notes) {
    throw new Error(`Notes are required for outcome "${input.contactOutcome}"`);
  }
  if (requiresNextAction.includes(input.contactOutcome) && !input.nextAction) {
    throw new Error(`Next action is required for outcome "${input.contactOutcome}"`);
  }

  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });

  await logActivity({
    clientId,
    userId: actorId,
    type: "NOTE",
    payload: {
      message: `Contacted via ${input.contactMethod}: ${input.contactOutcome}${input.notes ? ` — ${input.notes}` : ""}`,
      contactMethod: input.contactMethod,
      contactOutcome: input.contactOutcome,
    },
  });

  if (input.nextAction && client.assignedToId) {
    await prisma.task.create({
      data: {
        organizationId: client.organizationId,
        clientId,
        assignedToId: client.assignedToId,
        title: input.nextAction,
        dueAt: input.nextActionDate ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
        source: "stage-engine",
      },
    });
  }
}

/** Ad-hoc document tracking (proposals, contracts, signed agreements, etc.) — no preset checklist, add whatever's relevant. */
export async function addDocument(
  clientId: string,
  input: { documentType: string; mandatory: boolean },
  actorId: string,
) {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { organizationId: true } });
  const doc = await prisma.document.create({
    data: { organizationId: client.organizationId, clientId, documentType: input.documentType, mandatory: input.mandatory },
  });
  await logActivity({ clientId, userId: actorId, type: "NOTE", payload: { message: `Added document: ${input.documentType}` } });
  return doc;
}

/** Updates a single document's status; notifies the assigned rep on rejection. */
export async function updateDocumentStatus(
  documentId: string,
  input: { status: "PENDING" | "RECEIVED" | "VERIFIED" | "REJECTED" | "NOT_APPLICABLE"; rejectionReason?: string; remarks?: string },
  actorId: string,
) {
  const doc = await prisma.document.update({
    where: { id: documentId },
    data: {
      status: input.status,
      rejectionReason: input.rejectionReason,
      remarks: input.remarks,
      receivedAt: input.status === "RECEIVED" ? new Date() : undefined,
      verifiedAt: input.status === "VERIFIED" ? new Date() : undefined,
    },
  });

  await logActivity({
    clientId: doc.clientId,
    userId: actorId,
    type: "NOTE",
    payload: { message: `Document ${doc.documentType}: ${input.status}` },
  });

  if (input.status === "REJECTED") {
    const client = await prisma.client.findUniqueOrThrow({ where: { id: doc.clientId } });
    if (client.assignedToId) {
      await prisma.notification.create({
        data: {
          organizationId: doc.organizationId,
          userId: client.assignedToId,
          type: "document_rejected",
          payload: { clientId: doc.clientId, clientName: client.name, documentType: doc.documentType, reason: input.rejectionReason },
        },
      });
    }
  }

  return doc;
}

/** Updates the generic deal value and/or org-defined custom fields on a client. */
export async function updateClientDetails(
  clientId: string,
  input: { dealValue?: number | null; customFields?: Record<string, unknown> },
  actorId: string,
) {
  const client = await prisma.client.update({
    where: { id: clientId },
    data: {
      ...(input.dealValue !== undefined ? { dealValue: input.dealValue } : {}),
      ...(input.customFields !== undefined ? { customFields: input.customFields as Prisma.InputJsonValue } : {}),
    },
  });
  await logActivity({ clientId, userId: actorId, type: "NOTE", payload: { message: "Updated client details" } });
  return client;
}

export async function putOnHold(
  clientId: string,
  input: { reason: string; expectedResumeDate?: Date; notes?: string },
  actorId: string,
) {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });

  await prisma.exception.create({
    data: {
      organizationId: client.organizationId,
      clientId,
      stageId: client.currentStageId,
      reason: input.reason,
      notes: input.notes,
      expectedResumeDate: input.expectedResumeDate,
      status: "OPEN",
    },
  });

  await prisma.client.update({ where: { id: clientId }, data: { status: "ON_HOLD" } });

  await prisma.auditLog.create({
    data: {
      organizationId: client.organizationId,
      userId: actorId,
      entity: "Client",
      entityId: clientId,
      action: "hold_started",
      newValue: { reason: input.reason },
      reason: input.reason,
    },
  });

  await logActivity({ clientId, userId: actorId, type: "NOTE", payload: { message: `Put on hold: ${input.reason}` } });

  if (client.assignedToId) {
    await prisma.notification.create({
      data: {
        organizationId: client.organizationId,
        userId: client.assignedToId,
        type: "hold_started",
        payload: { clientId, clientName: client.name, reason: input.reason },
      },
    });
  }
}

export async function resumeFromHold(clientId: string, actorId: string) {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { organizationId: true } });

  const openException = await prisma.exception.findFirst({
    where: { clientId, status: "OPEN" },
    orderBy: { createdAt: "desc" },
  });
  if (openException) {
    await prisma.exception.update({ where: { id: openException.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
  }

  await prisma.client.update({ where: { id: clientId }, data: { status: "ACTIVE" } });

  await prisma.auditLog.create({
    data: { organizationId: client.organizationId, userId: actorId, entity: "Client", entityId: clientId, action: "hold_resolved" },
  });
  await logActivity({ clientId, userId: actorId, type: "NOTE", payload: { message: "Resumed from hold" } });
}

export async function markNotProceeding(clientId: string, input: { reason: string; notes?: string }, actorId: string) {
  const client = await prisma.client.update({ where: { id: clientId }, data: { status: "NOT_PROCEEDING" } });
  await prisma.auditLog.create({
    data: {
      organizationId: client.organizationId,
      userId: actorId,
      entity: "Client",
      entityId: clientId,
      action: "marked_not_proceeding",
      newValue: { reason: input.reason },
      reason: input.reason,
    },
  });
  await logActivity({
    clientId,
    userId: actorId,
    type: "NOTE",
    payload: { message: `Marked not proceeding: ${input.reason}${input.notes ? ` — ${input.notes}` : ""}` },
  });
}

/** Manager/Admin only. */
export async function reopenClient(clientId: string, input: { reason: string }, actorId: string) {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });

  await prisma.client.update({ where: { id: clientId }, data: { status: "ACTIVE" } });
  await prisma.auditLog.create({
    data: { organizationId: client.organizationId, userId: actorId, entity: "Client", entityId: clientId, action: "reopened", reason: input.reason },
  });
  await logActivity({ clientId, userId: actorId, type: "NOTE", payload: { message: `Reopened: ${input.reason}` } });

  if (client.assignedToId) {
    await prisma.notification.create({
      data: {
        organizationId: client.organizationId,
        userId: client.assignedToId,
        type: "client_reopened",
        payload: { clientId, clientName: client.name, reason: input.reason },
      },
    });
  }
}
