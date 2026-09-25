import type { IntegrationAdapter } from "@/lib/integrations/types";

export const clevertapMockAdapter: IntegrationAdapter = {
  provider: "clevertap",

  async configure() {},

  async testConnection() {
    return { ok: true, message: "Mock Clevertap connection OK (no real account required)" };
  },

  async handleWebhook(payload) {
    const body = payload as { identity?: string; eventName?: string; eventProps?: Record<string, unknown> };
    return [
      {
        type: "campaign_event",
        clientEmail: body.identity,
        payload: { eventName: body.eventName ?? "campaign_clicked", props: body.eventProps ?? {} },
      },
    ];
  },

  actions: {
    async syncProfile(client) {
      return {
        success: true,
        data: { identity: client.email ?? client.mobile ?? client.id, synced: true, mock: true },
      };
    },
  },
};
