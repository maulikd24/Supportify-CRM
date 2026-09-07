"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireUser, requireRole } from "@/lib/auth/require-role";
import { logActivity } from "@/lib/activities/log-activity";
import { sendMessage } from "@/lib/messaging/send";
import { generateClientCode } from "@/lib/stage-engine/client-code";
import { getFirstStage } from "@/lib/stage-engine/stages";
import { parseCustomFieldsFromFormData } from "@/components/clients/custom-field-inputs";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatch";
import {
  initializeClient,
  recordRmContact,
  addDocument,
  updateDocumentStatus,
  updateClientDetails,
  moveToStage,
  correctStage,
  putOnHold,
  resumeFromHold,
  markNotProceeding,
  reopenClient,
} from "@/lib/stage-engine/transitions";
import type { DocumentStatus, Prisma } from "@/generated/prisma/client";

/**
 * Every action below takes a raw clientId/documentId from the client — this is
 * the actual tenant boundary (stage-engine/transitions.ts trusts its inputs),
 * so every wrapper here must verify the target belongs to the caller's org
 * before doing anything with it.
 */
async function requireClientInOrg(clientId: string, organizationId: string): Promise<void> {
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId }, select: { id: true } });
  if (!client) throw new Error("Client not found");
}

async function requireDocumentInOrg(documentId: string, organizationId: string): Promise<void> {
  const doc = await prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { id: true } });
  if (!doc) throw new Error("Document not found");
}

const createClientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  mobile: z.string().min(1, "Mobile is required"),
  email: z.string().email().optional().or(z.literal("")),
  clientType: z.string().optional().or(z.literal("")),
  leadSource: z.string().optional().or(z.literal("")),
  referralSource: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  dealValue: z.coerce.number().optional(),
  assignedToId: z.string().optional().or(z.literal("")),
  allowDuplicate: z.coerce.boolean().optional(),
});

export async function checkDuplicateClientAction(mobile: string, email: string) {
  const existing = await prisma.client.findFirst({
    where: {
      status: { not: "NOT_PROCEEDING" },
      OR: [{ mobile }, email ? { email } : undefined].filter(Boolean) as object[],
    },
    select: { id: true, name: true, clientCode: true, mobile: true, email: true },
  });
  return existing;
}

export async function searchClientsForMergeAction(query: string, excludeId: string) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (!query.trim()) return [];

  return prisma.client.findMany({
    where: {
      organizationId: session.user.organizationId,
      id: { not: excludeId },
      mergedIntoId: null,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { mobile: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
        { clientCode: { contains: query, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, clientCode: true, mobile: true, email: true },
    take: 8,
  });
}

export async function createClientAction(formData: FormData) {
  const session = await requireUser();

  const parsed = createClientSchema.parse({
    name: formData.get("name"),
    mobile: formData.get("mobile"),
    email: formData.get("email"),
    clientType: formData.get("clientType"),
    leadSource: formData.get("leadSource"),
    referralSource: formData.get("referralSource"),
    notes: formData.get("notes"),
    dealValue: formData.get("dealValue") || undefined,
    assignedToId: formData.get("assignedToId"),
    allowDuplicate: formData.get("allowDuplicate") || undefined,
  });

  if (!parsed.allowDuplicate) {
    const duplicate = await checkDuplicateClientAction(parsed.mobile, parsed.email || "");
    if (duplicate) {
      return { duplicate };
    }
  }

  const [clientCode, stage1, customFieldDefs] = await Promise.all([
    generateClientCode(),
    getFirstStage(session.user.organizationId),
    prisma.customFieldDefinition.findMany({ where: { organizationId: session.user.organizationId } }),
  ]);
  const customFields = parseCustomFieldsFromFormData(formData, customFieldDefs);

  const client = await prisma.client.create({
    data: {
      organizationId: session.user.organizationId,
      clientCode,
      name: parsed.name,
      mobile: parsed.mobile,
      email: parsed.email || null,
      clientType: parsed.clientType || null,
      leadSource: parsed.leadSource || "manual",
      referralSource: parsed.referralSource || null,
      notes: parsed.notes || null,
      dealValue: parsed.dealValue ?? null,
      customFields: Object.keys(customFields).length > 0 ? (customFields as Prisma.InputJsonValue) : undefined,
      // Defaults to the creating user regardless of role — intentional, not RM-only.
      assignedToId: parsed.assignedToId || session.user.id,
      currentStageId: stage1.id,
    },
  });

  await initializeClient(client.id, session.user.id);

  void dispatchWebhookEvent(session.user.organizationId, "client.created", {
    id: client.id,
    clientCode: client.clientCode,
    name: client.name,
    email: client.email,
    mobile: client.mobile,
    leadSource: client.leadSource,
    dealValue: client.dealValue ? client.dealValue.toString() : null,
  });

  revalidatePath("/clients");
  return { client: { id: client.id, clientCode: client.clientCode, name: client.name } };
}

export async function reassignClientAction(clientId: string, assignedToId: string) {
  const session = await requireUser();
  await requireClientInOrg(clientId, session.user.organizationId);

  const newOwner = await prisma.user.findFirst({
    where: { id: assignedToId, organizationId: session.user.organizationId },
  });
  if (!newOwner) throw new Error("User not found");

  await prisma.client.update({ where: { id: clientId }, data: { assignedToId } });

  await logActivity({
    clientId,
    userId: session.user.id,
    type: "NOTE",
    payload: { message: `Reassigned to ${newOwner?.name ?? assignedToId}` },
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
}

export async function addClientNoteAction(clientId: string, note: string) {
  const session = await requireUser();
  await requireClientInOrg(clientId, session.user.organizationId);

  await logActivity({ clientId, userId: session.user.id, type: "NOTE", payload: { message: note } });

  revalidatePath(`/clients/${clientId}`);
}

export async function sendClientMessageAction(
  clientId: string,
  channel: "whatsapp" | "sms",
  templateId: string,
  variables: Record<string, string>,
) {
  const session = await requireUser();
  await requireClientInOrg(clientId, session.user.organizationId);

  const message = await sendMessage({ clientId, channel, templateId, variables });

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/copilot");
  return message;
}

// --- Stage Engine wrapper actions -------------------------------------------------

function revalidateClient(clientId: string) {
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
}

export async function recordRmContactAction(
  clientId: string,
  input: {
    contactMethod: "Phone" | "WhatsApp" | "In-person" | "Email" | "Other";
    contactOutcome: "Connected" | "Call back requested" | "Interested" | "Not interested" | "Unreachable" | "Wrong number";
    notes?: string;
    nextAction?: string;
    nextActionDate?: string;
  },
) {
  const session = await requireUser();
  await requireClientInOrg(clientId, session.user.organizationId);
  await recordRmContact(
    clientId,
    { ...input, nextActionDate: input.nextActionDate ? new Date(input.nextActionDate) : undefined },
    session.user.id,
  );
  revalidateClient(clientId);
}

export async function addDocumentAction(clientId: string, documentType: string, mandatory: boolean) {
  const session = await requireUser();
  await requireClientInOrg(clientId, session.user.organizationId);
  await addDocument(clientId, { documentType, mandatory }, session.user.id);
  revalidateClient(clientId);
}

export async function updateDocumentStatusAction(
  documentId: string,
  input: { status: DocumentStatus; rejectionReason?: string; remarks?: string },
) {
  const session = await requireUser();
  await requireDocumentInOrg(documentId, session.user.organizationId);
  const doc = await updateDocumentStatus(documentId, input, session.user.id);
  revalidateClient(doc.clientId);
}

export async function updateClientDetailsAction(
  clientId: string,
  input: { dealValue?: number | null; customFields?: Record<string, unknown> },
) {
  const session = await requireUser();
  await requireClientInOrg(clientId, session.user.organizationId);
  await updateClientDetails(clientId, input, session.user.id);
  revalidateClient(clientId);
}

export async function moveToStageAction(clientId: string, toStageId: string) {
  const session = await requireUser();
  await requireClientInOrg(clientId, session.user.organizationId);
  await moveToStage(clientId, toStageId, session.user.id);
  revalidateClient(clientId);
}

export async function correctStageAction(clientId: string, toStageId: string, reason: string) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  await requireClientInOrg(clientId, session.user.organizationId);
  await correctStage(clientId, toStageId, reason, session.user.id);
  revalidateClient(clientId);
}

export async function putOnHoldAction(
  clientId: string,
  input: { reason: string; expectedResumeDate?: string; notes?: string },
) {
  const session = await requireUser();
  await requireClientInOrg(clientId, session.user.organizationId);
  await putOnHold(
    clientId,
    { ...input, expectedResumeDate: input.expectedResumeDate ? new Date(input.expectedResumeDate) : undefined },
    session.user.id,
  );
  revalidateClient(clientId);
}

export async function resumeFromHoldAction(clientId: string) {
  const session = await requireUser();
  await requireClientInOrg(clientId, session.user.organizationId);
  await resumeFromHold(clientId, session.user.id);
  revalidateClient(clientId);
}

export async function markNotProceedingAction(clientId: string, input: { reason: string; notes?: string }) {
  const session = await requireUser();
  await requireClientInOrg(clientId, session.user.organizationId);
  await markNotProceeding(clientId, input, session.user.id);
  revalidateClient(clientId);
}

export async function reopenClientAction(clientId: string, input: { reason: string }) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  await requireClientInOrg(clientId, session.user.organizationId);
  await reopenClient(clientId, input, session.user.id);
  revalidateClient(clientId);
}

// --- Merge -------------------------------------------------------------------------

export async function mergeClientsAction(primaryId: string, duplicateId: string) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (primaryId === duplicateId) throw new Error("Cannot merge a client into itself");
  await requireClientInOrg(primaryId, session.user.organizationId);
  await requireClientInOrg(duplicateId, session.user.organizationId);

  await prisma.$transaction([
    prisma.document.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }),
    prisma.task.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }),
    prisma.activity.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } }),
    prisma.client.update({
      where: { id: duplicateId },
      data: { mergedIntoId: primaryId, status: "NOT_PROCEEDING" },
    }),
    prisma.auditLog.create({
      data: {
        organizationId: session.user.organizationId,
        userId: session.user.id,
        entity: "Client",
        entityId: duplicateId,
        action: "merged",
        newValue: { mergedIntoId: primaryId },
      },
    }),
  ]);

  revalidatePath("/clients");
  revalidatePath(`/clients/${primaryId}`);
}
