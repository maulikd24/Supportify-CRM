"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireProductAccess } from "@/lib/auth/require-role";
import { encryptJson } from "@/lib/security/crypto";
import { getHelpdeskProvider, helpdeskClient, HelpdeskAuthError, isHelpdeskProvider } from "@/lib/qa/helpdesks";
import { UserError, withUserErrors } from "@/lib/actions/user-error";
import { recordAudit } from "@/lib/audit/record";

const ADMIN_ROLES = ["OWNER", "ADMIN"] as const;

function connectionError(error: unknown, providerName: string): string {
  if (error instanceof HelpdeskAuthError) return error.message;
  if (error instanceof Error) return error.message;
  return `Couldn't verify the ${providerName} connection`;
}

/** Connects (or replaces) the org's helpdesk. Credentials are tested before they're saved. */
export const connectHelpdeskAction = withUserErrors(async function connectHelpdeskAction(providerId: string, values: Record<string, string>) {
  const session = await requireProductAccess("QA_SENTINEL", [...ADMIN_ROLES]);
  const organizationId = session.user.organizationId;
  if (!isHelpdeskProvider(providerId)) throw new UserError("Pick a helpdesk to connect");
  const provider = getHelpdeskProvider(providerId);
  const credentials = provider.schema.parse(values);

  try {
    await provider.createClient(credentials).testConnection();
  } catch (error) {
    // Nothing is saved when the test fails, so a typo never replaces a working connection.
    throw new UserError(connectionError(error, provider.name));
  }

  const previous = await prisma.helpdeskConnection.findUnique({ where: { organizationId }, select: { provider: true } });
  const data = {
    provider: provider.id,
    accountLabel: provider.accountLabel(credentials),
    encryptedCredentials: encryptJson(credentials),
    isValid: true,
    lastCheckedAt: new Date(),
  };
  await prisma.helpdeskConnection.upsert({ where: { organizationId }, update: data, create: { organizationId, ...data } });
  if (previous && previous.provider !== provider.id) {
    // Queued tickets belong to the old helpdesk; start polling the new one from now.
    await prisma.autoReviewJob.updateMany({ where: { organizationId, status: "QUEUED" }, data: { status: "SKIPPED", lastError: "The organization switched helpdesks", processedAt: new Date() } });
    await prisma.autoReviewConfig.updateMany({ where: { organizationId }, data: { lastPolledAt: null } });
  }

  await recordAudit({
    organizationId,
    userId: session.user.id,
    entity: "HelpdeskConnection",
    entityId: organizationId,
    action: "helpdesk.connected",
    oldValue: previous ? { provider: previous.provider } : null,
    newValue: { provider: provider.id, account: data.accountLabel },
  });
  revalidatePath("/qa/settings");
  revalidatePath("/qa");
  return { accountLabel: data.accountLabel };
});

export const disconnectHelpdeskAction = withUserErrors(async function disconnectHelpdeskAction() {
  const session = await requireProductAccess("QA_SENTINEL", [...ADMIN_ROLES]);
  const organizationId = session.user.organizationId;

  const removed = await prisma.helpdeskConnection.findUnique({ where: { organizationId }, select: { provider: true } });
  await prisma.helpdeskConnection.deleteMany({ where: { organizationId } });
  await recordAudit({ organizationId, userId: session.user.id, entity: "HelpdeskConnection", entityId: organizationId, action: "helpdesk.disconnected", oldValue: removed ? { provider: removed.provider } : null });

  revalidatePath("/qa/settings");
  revalidatePath("/qa");
});

export const retestHelpdeskConnectionAction = withUserErrors(async function retestHelpdeskConnectionAction() {
  const session = await requireProductAccess("QA_SENTINEL", [...ADMIN_ROLES]);
  const organizationId = session.user.organizationId;

  const connection = await prisma.helpdeskConnection.findUnique({ where: { organizationId } });
  if (!connection) throw new UserError("No helpdesk is connected");
  const provider = getHelpdeskProvider(connection.provider);

  let error: string | null = null;
  try {
    await helpdeskClient(connection).testConnection();
  } catch (e) {
    error = connectionError(e, provider.name);
  }
  await prisma.helpdeskConnection.update({ where: { organizationId }, data: { isValid: error === null, lastCheckedAt: new Date() } });

  revalidatePath("/qa/settings");
  if (error) throw new UserError(error);
});

const sopSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().min(1).default("general"),
  content: z.string().min(1, "Content is required"),
});

export const createSopAction = withUserErrors(async function createSopAction(formData: FormData) {
  const session = await requireProductAccess("QA_SENTINEL");

  const parsed = sopSchema.parse({
    name: formData.get("name"),
    category: formData.get("category") || "general",
    content: formData.get("content"),
  });

  try {
    await prisma.sopDocument.create({
      data: { organizationId: session.user.organizationId, ...parsed },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      throw new UserError(`A SOP named "${parsed.name}" already exists`);
    }
    throw error;
  }

  revalidatePath("/qa/settings");
});

export const updateSopAction = withUserErrors(async function updateSopAction(sopId: string, formData: FormData) {
  const session = await requireProductAccess("QA_SENTINEL");

  const parsed = sopSchema.parse({
    name: formData.get("name"),
    category: formData.get("category") || "general",
    content: formData.get("content"),
  });

  await prisma.sopDocument.update({
    where: { id: sopId, organizationId: session.user.organizationId },
    data: parsed,
  });

  revalidatePath("/qa/settings");
});

export const deleteSopAction = withUserErrors(async function deleteSopAction(sopId: string) {
  const session = await requireProductAccess("QA_SENTINEL");

  await prisma.sopDocument.delete({
    where: { id: sopId, organizationId: session.user.organizationId },
  });

  revalidatePath("/qa/settings");
});
