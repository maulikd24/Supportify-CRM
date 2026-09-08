import { prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";
import type { IntegrationAdapter, EmailAdapter } from "@/lib/integrations/types";

import { freshdeskAdapter } from "@/lib/integrations/adapters/freshdesk";
import { exotelAdapter } from "@/lib/integrations/adapters/exotel";
import { clevertapAdapter } from "@/lib/integrations/adapters/clevertap";
import { freshdeskMockAdapter } from "@/lib/integrations/adapters/mock/freshdesk.mock";
import { exotelMockAdapter } from "@/lib/integrations/adapters/mock/exotel.mock";
import { clevertapMockAdapter } from "@/lib/integrations/adapters/mock/clevertap.mock";
import { resendEmailAdapter } from "@/lib/integrations/adapters/resend-email";
import { resendEmailMockAdapter } from "@/lib/integrations/adapters/mock/resend-email.mock";

const LIVE_ADAPTERS: Record<string, IntegrationAdapter> = {
  freshdesk: freshdeskAdapter,
  exotel: exotelAdapter,
  clevertap: clevertapAdapter,
};

const MOCK_ADAPTERS: Record<string, IntegrationAdapter> = {
  freshdesk: freshdeskMockAdapter,
  exotel: exotelMockAdapter,
  clevertap: clevertapMockAdapter,
};

export const INTEGRATION_PROVIDERS = Object.keys(LIVE_ADAPTERS);

const EMAIL_PROVIDER = "resend_email";
const LIVE_EMAIL_ADAPTERS: Record<string, EmailAdapter> = { [EMAIL_PROVIDER]: resendEmailAdapter };
const MOCK_EMAIL_ADAPTERS: Record<string, EmailAdapter> = { [EMAIL_PROVIDER]: resendEmailMockAdapter };

export const EMAIL_PROVIDERS = Object.keys(LIVE_EMAIL_ADAPTERS);

/** Looks up an org's IntegrationConfig row for a provider. Always org-scoped —
 * inbound webhooks resolve their organizationId from the URL's webhookToken
 * (see src/app/api/webhooks/[provider]/[token]/route.ts) before calling this. */
async function findIntegrationConfig(provider: string, organizationId: string) {
  return prisma.integrationConfig.findUnique({ where: { organizationId_provider: { organizationId, provider } } });
}

/** Resolves the configured email adapter (mock or live), applying stored credentials. */
export async function getEmailAdapter(organizationId: string): Promise<EmailAdapter> {
  const config = await findIntegrationConfig(EMAIL_PROVIDER, organizationId);
  const mode = config?.mode ?? "mock";

  if (mode !== "live") return MOCK_EMAIL_ADAPTERS[EMAIL_PROVIDER];

  const adapter = LIVE_EMAIL_ADAPTERS[EMAIL_PROVIDER];
  const credentials = config?.credentials ? decryptJson<Record<string, unknown>>(config.credentials as string) : {};
  const settings = (config?.settings as Record<string, unknown>) ?? {};
  await adapter.configure(credentials, settings);
  return adapter;
}

/** Resolves the configured adapter (mock or live) for a provider, applying stored credentials/settings. */
export async function getAdapter(provider: string, organizationId: string): Promise<IntegrationAdapter> {
  const config = await findIntegrationConfig(provider, organizationId);
  const mode = config?.mode ?? "mock";

  if (mode !== "live") {
    return MOCK_ADAPTERS[provider] ?? notFound(provider);
  }

  const adapter = LIVE_ADAPTERS[provider] ?? notFound(provider);
  const credentials = config?.credentials ? decryptJson<Record<string, unknown>>(config.credentials as string) : {};
  const settings = (config?.settings as Record<string, unknown>) ?? {};
  await adapter.configure(credentials, settings);
  return adapter;
}

function notFound(provider: string): never {
  throw new Error(`Unknown integration provider: ${provider}`);
}
