import { prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";
import type { MessagingAdapter } from "@/lib/messaging/types";

import { whatsappMetaAdapter } from "@/lib/messaging/adapters/whatsapp-meta";
import { smsExotelAdapter } from "@/lib/messaging/adapters/sms-exotel";
import { whatsappMockAdapter } from "@/lib/messaging/adapters/mock/whatsapp.mock";
import { smsMockAdapter } from "@/lib/messaging/adapters/mock/sms.mock";

const LIVE_ADAPTERS: Record<string, MessagingAdapter> = {
  whatsapp: whatsappMetaAdapter,
  sms: smsExotelAdapter,
};

const MOCK_ADAPTERS: Record<string, MessagingAdapter> = {
  whatsapp: whatsappMockAdapter,
  sms: smsMockAdapter,
};

export const MESSAGING_CHANNELS = Object.keys(LIVE_ADAPTERS) as ("whatsapp" | "sms")[];

/** Provider key used in IntegrationConfig for a channel's live adapter. */
function providerKeyFor(channel: string): string {
  return channel === "whatsapp" ? "whatsapp_meta" : "sms_exotel";
}

/** Always org-scoped — inbound webhooks resolve organizationId from the URL's
 * webhookToken (see src/app/api/webhooks/messaging/[channel]/[token]/route.ts)
 * before calling this. */
export async function getMessagingAdapter(
  channel: "whatsapp" | "sms",
  organizationId: string,
): Promise<MessagingAdapter> {
  const provider = providerKeyFor(channel);
  const config = await prisma.integrationConfig.findUnique({
    where: { organizationId_provider: { organizationId, provider } },
  });
  const mode = config?.mode ?? "mock";

  if (mode !== "live") return MOCK_ADAPTERS[channel];

  const adapter = LIVE_ADAPTERS[channel];
  const credentials = config?.credentials ? decryptJson<Record<string, unknown>>(config.credentials as string) : {};
  const settings = (config?.settings as Record<string, unknown>) ?? {};
  await adapter.configure(credentials, settings);
  return adapter;
}

export function messagingProviderKeyFor(channel: string): string {
  return providerKeyFor(channel);
}
