"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { encryptJson } from "@/lib/security/crypto";
import { getAdapter } from "@/lib/integrations/registry";
import { recordAudit } from "@/lib/audit/record";

export async function setIntegrationModeAction(provider: string, mode: "mock" | "live") {
  const session = await requireRole(["ADMIN"]);

  await prisma.integrationConfig.upsert({
    where: { organizationId_provider: { organizationId: session.user.organizationId, provider } },
    update: { mode },
    create: { organizationId: session.user.organizationId, provider, mode },
  });
  await recordAudit({ organizationId: session.user.organizationId, userId: session.user.id, entity: "IntegrationConfig", entityId: provider, action: "integration.updated", newValue: { mode } });

  revalidatePath("/settings/integrations");
}

export async function saveIntegrationCredentialsAction(provider: string, credentials: Record<string, string>) {
  const session = await requireRole(["ADMIN"]);

  const encrypted = encryptJson(credentials);

  await prisma.integrationConfig.upsert({
    where: { organizationId_provider: { organizationId: session.user.organizationId, provider } },
    update: { credentials: encrypted, isEnabled: true },
    create: { organizationId: session.user.organizationId, provider, credentials: encrypted, isEnabled: true },
  });
  // Never log the credentials themselves — only that they changed.
  await recordAudit({ organizationId: session.user.organizationId, userId: session.user.id, entity: "IntegrationConfig", entityId: provider, action: "integration.updated", newValue: { credentialsUpdated: true } });

  revalidatePath("/settings/integrations");
}

export async function testIntegrationConnectionAction(provider: string) {
  const session = await requireRole(["ADMIN"]);

  const adapter = await getAdapter(provider, session.user.organizationId);
  return adapter.testConnection();
}
