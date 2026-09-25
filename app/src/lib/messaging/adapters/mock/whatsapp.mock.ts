import type { MessagingAdapter } from "@/lib/messaging/types";

export const whatsappMockAdapter: MessagingAdapter = {
  channel: "whatsapp",
  provider: "mock_whatsapp",

  async configure() {},

  async sendMessage() {
    return { externalId: `mock-wa-${Date.now()}`, status: "SENT" };
  },

  async handleInboundWebhook(payload) {
    const body = payload as { from?: string; text?: string; id?: string };
    return [
      {
        externalId: body.id ?? `mock-wa-in-${Date.now()}`,
        fromPhone: body.from ?? "unknown",
        body: body.text ?? "",
        receivedAt: new Date(),
      },
    ];
  },

  async handleStatusWebhook(payload) {
    const body = payload as { id?: string; status?: string };
    return [{ externalId: body.id ?? "", status: (body.status?.toUpperCase() as "DELIVERED" | "READ" | "FAILED") ?? "DELIVERED" }];
  },
};
