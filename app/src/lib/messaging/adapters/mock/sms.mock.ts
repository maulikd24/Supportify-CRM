import type { MessagingAdapter } from "@/lib/messaging/types";

export const smsMockAdapter: MessagingAdapter = {
  channel: "sms",
  provider: "mock_sms",

  async configure() {},

  async sendMessage() {
    return { externalId: `mock-sms-${Date.now()}`, status: "SENT" };
  },

  async handleInboundWebhook(payload) {
    const body = payload as { From?: string; Body?: string; SmsSid?: string };
    return [
      {
        externalId: body.SmsSid ?? `mock-sms-in-${Date.now()}`,
        fromPhone: body.From ?? "unknown",
        body: body.Body ?? "",
        receivedAt: new Date(),
      },
    ];
  },

  async handleStatusWebhook(payload) {
    const body = payload as { SmsSid?: string; Status?: string };
    return [{ externalId: body.SmsSid ?? "", status: (body.Status?.toUpperCase() as "DELIVERED" | "FAILED") ?? "DELIVERED" }];
  },
};
