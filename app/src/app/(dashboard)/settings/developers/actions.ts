"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { generateApiKey } from "@/lib/security/api-keys";
import { encryptJson } from "@/lib/security/crypto";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/events";

const createKeySchema = z.object({ name: z.string().min(1, "Name is required") });

export async function createApiKeyAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);
  const parsed = createKeySchema.parse({ name: formData.get("name") });

  const { raw, keyPrefix, hashedKey } = generateApiKey();

  await prisma.apiKey.create({
    data: {
      organizationId: session.user.organizationId,
      name: parsed.name,
      keyPrefix,
      hashedKey,
      createdById: session.user.id,
    },
  });

  revalidatePath("/settings/developers");
  return { rawKey: raw };
}

export async function revokeApiKeyAction(keyId: string) {
  const session = await requireRole(["ADMIN"]);

  await prisma.apiKey.update({
    where: { id: keyId, organizationId: session.user.organizationId },
    data: { revokedAt: new Date() },
  });

  revalidatePath("/settings/developers");
}

const createWebhookSchema = z.object({
  url: z.string().url("Enter a valid URL"),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Select at least one event"),
});

export async function createWebhookAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);

  const parsed = createWebhookSchema.parse({
    url: formData.get("url"),
    events: formData.getAll("events"),
  });

  const secret = `whsec_${randomBytes(24).toString("hex")}`;

  await prisma.webhookEndpoint.create({
    data: {
      organizationId: session.user.organizationId,
      url: parsed.url,
      encryptedSecret: encryptJson(secret),
      events: parsed.events,
    },
  });

  revalidatePath("/settings/developers");
  return { secret };
}

export async function deleteWebhookAction(webhookId: string) {
  const session = await requireRole(["ADMIN"]);

  await prisma.webhookEndpoint.delete({
    where: { id: webhookId, organizationId: session.user.organizationId },
  });

  revalidatePath("/settings/developers");
}

export async function toggleWebhookActiveAction(webhookId: string, isActive: boolean) {
  const session = await requireRole(["ADMIN"]);

  await prisma.webhookEndpoint.update({
    where: { id: webhookId, organizationId: session.user.organizationId },
    data: { isActive },
  });

  revalidatePath("/settings/developers");
}
