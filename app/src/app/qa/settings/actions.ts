"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireOrg } from "@/lib/auth/require-role";
import { encryptJson, decryptJson } from "@/lib/security/crypto";
import { ZendeskClient, type ZendeskCredentials } from "@/lib/qa/zendesk-client";
import { UserError, withUserErrors } from "@/lib/actions/user-error";
import { recordAudit } from "@/lib/audit/record";

const zendeskSchema = z.object({
  subdomain: z.string().min(1, "Subdomain is required"),
  email: z.string().email("Enter the Zendesk agent email"),
  apiToken: z.string().min(1, "API token is required"),
});

export const connectZendeskAction = withUserErrors(async function connectZendeskAction(formData: FormData) {
  const session = await requireOrg();

  const parsed = zendeskSchema.parse({
    subdomain: formData.get("subdomain"),
    email: formData.get("email"),
    apiToken: formData.get("apiToken"),
  });

  const credentials: ZendeskCredentials = parsed;
  const client = new ZendeskClient(credentials);
  const test = await client.testConnection();

  await prisma.zendeskConnection.upsert({
    where: { organizationId: session.user.organizationId },
    update: {
      subdomain: parsed.subdomain,
      email: parsed.email,
      encryptedToken: encryptJson(credentials),
      isValid: test.ok,
      lastCheckedAt: new Date(),
    },
    create: {
      organizationId: session.user.organizationId,
      subdomain: parsed.subdomain,
      email: parsed.email,
      encryptedToken: encryptJson(credentials),
      isValid: test.ok,
      lastCheckedAt: new Date(),
    },
  });

  await recordAudit({ organizationId: session.user.organizationId, userId: session.user.id, entity: "ZendeskConnection", entityId: session.user.organizationId, action: "zendesk.connected", newValue: { subdomain: parsed.subdomain, valid: test.ok } });
  revalidatePath("/qa/settings");

  if (!test.ok) {
    throw new UserError(test.error ?? "Could not verify the Zendesk connection");
  }
});

export const disconnectZendeskAction = withUserErrors(async function disconnectZendeskAction() {
  const session = await requireOrg();

  await prisma.zendeskConnection.deleteMany({ where: { organizationId: session.user.organizationId } });
  await recordAudit({ organizationId: session.user.organizationId, userId: session.user.id, entity: "ZendeskConnection", entityId: session.user.organizationId, action: "zendesk.disconnected" });

  revalidatePath("/qa/settings");
});

export const retestZendeskConnectionAction = withUserErrors(async function retestZendeskConnectionAction() {
  const session = await requireOrg();

  const connection = await prisma.zendeskConnection.findUnique({
    where: { organizationId: session.user.organizationId },
  });
  if (!connection) throw new UserError("No Zendesk connection to test");

  const credentials = decryptJson<ZendeskCredentials>(connection.encryptedToken);
  const client = new ZendeskClient(credentials);
  const test = await client.testConnection();

  await prisma.zendeskConnection.update({
    where: { organizationId: session.user.organizationId },
    data: { isValid: test.ok, lastCheckedAt: new Date() },
  });

  revalidatePath("/qa/settings");
  if (!test.ok) throw new UserError(test.error ?? "Zendesk connection test failed");
});

const sopSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().min(1).default("general"),
  content: z.string().min(1, "Content is required"),
});

export const createSopAction = withUserErrors(async function createSopAction(formData: FormData) {
  const session = await requireOrg();

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
  const session = await requireOrg();

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
  const session = await requireOrg();

  await prisma.sopDocument.delete({
    where: { id: sopId, organizationId: session.user.organizationId },
  });

  revalidatePath("/qa/settings");
});
