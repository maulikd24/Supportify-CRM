import type { IntegrationAdapter } from "@/lib/integrations/types";

let mockTicketCounter = 1000;

export const freshdeskMockAdapter: IntegrationAdapter = {
  provider: "freshdesk",

  async configure() {},

  async testConnection() {
    return { ok: true, message: "Mock Freshdesk connection OK (no real account required)" };
  },

  async handleWebhook(payload) {
    const body = payload as { ticket_id?: number; status?: string };
    return [
      {
        type: "ticket_updated",
        payload: { ticketId: body.ticket_id ?? mockTicketCounter, status: body.status ?? "open" },
      },
    ];
  },

  actions: {
    async createTicket(client, params) {
      mockTicketCounter += 1;
      return {
        success: true,
        data: {
          ticketId: mockTicketCounter,
          subject: params.subject ?? `Support request for ${client.name}`,
          status: "open",
          mock: true,
        },
      };
    },
  },
};
