"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { generateApiKey } from "@/lib/security/api-keys";
import { encryptJson } from "@/lib/security/crypto";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/events";
import { withUserErrors } from "@/lib/actions/user-error";
import { recordAudit } from "@/lib/audit/record";

const createKeySchema = z.object({ name: z.string().min(1, "Name is required") });

export const createApiKeyAction = withUserErrors(async function createApiKeyAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);
  const parsed = createKeySchema.parse({ name: formData.get("name") });

  const { raw, keyPrefix, hashedKey } = generateApiKey();

  const key = await prisma.apiKey.create({
    data: {
      organizationId: session.user.organizationId,
      name: parsed.name,
      keyPrefix,
      hashedKey,
      createdById: session.user.id,
    },
  });
  await recordAudit({ organizationId: session.user.organizationId, userId: session.user.id, entity: "ApiKey", entityId: key.id, action: "api_key.created", newValue: { name: parsed.name, prefix: keyPrefix } });

  revalidatePath("/settings/developers");
  return { rawKey: raw };
});

export const revokeApiKeyAction = withUserErrors(async function revokeApiKeyAction(keyId: string) {
  const session = await requireRole(["ADMIN"]);

  await prisma.apiKey.update({
    where: { id: keyId, organizationId: session.user.organizationId },
    data: { revokedAt: new Date() },
  });
  await recordAudit({ organizationId: session.user.organizationId, userId: session.user.id, entity: "ApiKey", entityId: keyId, action: "api_key.revoked" });

  revalidatePath("/settings/developers");
});

const createWebhookSchema = z.object({
  url: z.string().url("Enter a valid URL"),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Select at least one event"),
});

export const createWebhookAction = withUserErrors(async function createWebhookAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);

  const parsed = createWebhookSchema.parse({
    url: formData.get("url"),
    events: formData.getAll("events"),
  });

  const secret = `whsec_${randomBytes(24).toString("hex")}`;

  const webhook = await prisma.webhookEndpoint.create({
    data: {
      organizationId: session.user.organizationId,
      url: parsed.url,
      encryptedSecret: encryptJson(secret),
      events: parsed.events,
    },
  });
  await recordAudit({ organizationId: session.user.organizationId, userId: session.user.id, entity: "WebhookEndpoint", entityId: webhook.id, action: "webhook.created", newValue: { url: parsed.url, events: parsed.events } });

  revalidatePath("/settings/developers");
  return { secret };
});

export const deleteWebhookAction = withUserErrors(async function deleteWebhookAction(webhookId: string) {
  const session = await requireRole(["ADMIN"]);

  await prisma.webhookEndpoint.delete({
    where: { id: webhookId, organizationId: session.user.organizationId },
  });
  await recordAudit({ organizationId: session.user.organizationId, userId: session.user.id, entity: "WebhookEndpoint", entityId: webhookId, action: "webhook.deleted" });

  revalidatePath("/settings/developers");
});

export const toggleWebhookActiveAction = withUserErrors(async function toggleWebhookActiveAction(webhookId: string, isActive: boolean) {
  const session = await requireRole(["ADMIN"]);

  await prisma.webhookEndpoint.update({
    where: { id: webhookId, organizationId: session.user.organizationId },
    data: { isActive },
  });
  await recordAudit({ organizationId: session.user.organizationId, userId: session.user.id, entity: "WebhookEndpoint", entityId: webhookId, action: "webhook.updated", newValue: { isActive } });

  revalidatePath("/settings/developers");
});
