import type { IntegrationAdapter } from "@/lib/integrations/types";

interface FreshdeskCredentials {
  domain: string; // e.g. "yourcompany" for yourcompany.freshdesk.com
  apiKey: string;
}

let creds: FreshdeskCredentials | null = null;

function baseUrl(): string {
  if (!creds) throw new Error("Freshdesk adapter not configured");
  return `https://${creds.domain}.freshdesk.com/api/v2`;
}

function authHeader(): string {
  if (!creds) throw new Error("Freshdesk adapter not configured");
  return "Basic " + Buffer.from(`${creds.apiKey}:X`).toString("base64");
}

export const freshdeskAdapter: IntegrationAdapter = {
  provider: "freshdesk",

  async configure(credentials) {
    creds = {
      domain: String(credentials.domain ?? ""),
      apiKey: String(credentials.apiKey ?? ""),
    };
  },

  async testConnection() {
    try {
      const res = await fetch(`${baseUrl()}/tickets?per_page=1`, {
        headers: { Authorization: authHeader() },
      });
      if (!res.ok) return { ok: false, message: `Freshdesk responded ${res.status}` };
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Connection failed" };
    }
  },

  async handleWebhook(payload) {
    const body = payload as { ticket_id?: number; status?: string; requester_email?: string };
    return [
      {
        type: "ticket_updated",
        clientEmail: body.requester_email,
        payload: { ticketId: body.ticket_id, status: body.status },
      },
    ];
  },

  actions: {
    async createTicket(client, params) {
      try {
        const res = await fetch(`${baseUrl()}/tickets`, {
          method: "POST",
          headers: { Authorization: authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({
            email: client.email ?? undefined,
            subject: params.subject ?? `Support request for ${client.name}`,
            description: params.description ?? `Ticket created from Supportify for client ${client.name}`,
            priority: params.priority ?? 1,
            status: 2, // open
          }),
        });
        if (!res.ok) {
          return { success: false, error: `Freshdesk responded ${res.status}: ${await res.text()}` };
        }
        const data = await res.json();
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Request failed" };
      }
    },
  },
};
