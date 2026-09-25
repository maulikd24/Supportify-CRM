import type { IntegrationAdapter } from "@/lib/integrations/types";

interface ExotelCredentials {
  sid: string;
  apiKey: string;
  apiToken: string;
  callerId: string; // Exophone to call from
}

let creds: ExotelCredentials | null = null;

function baseUrl(): string {
  if (!creds) throw new Error("Exotel adapter not configured");
  return `https://${creds.apiKey}:${creds.apiToken}@api.exotel.com/v1/Accounts/${creds.sid}`;
}

export const exotelAdapter: IntegrationAdapter = {
  provider: "exotel",

  async configure(credentials) {
    creds = {
      sid: String(credentials.sid ?? ""),
      apiKey: String(credentials.apiKey ?? ""),
      apiToken: String(credentials.apiToken ?? ""),
      callerId: String(credentials.callerId ?? ""),
    };
  },

  async testConnection() {
    try {
      const res = await fetch(`${baseUrl()}.json`);
      if (!res.ok) return { ok: false, message: `Exotel responded ${res.status}` };
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Connection failed" };
    }
  },

  async handleWebhook(payload) {
    const body = payload as { CallSid?: string; Status?: string; From?: string; DialCallDuration?: string };
    return [
      {
        type: "call_completed",
        clientPhone: body.From,
        payload: {
          callSid: body.CallSid,
          status: body.Status,
          durationSeconds: body.DialCallDuration ? Number(body.DialCallDuration) : undefined,
        },
      },
    ];
  },

  actions: {
    async initiateCall(client) {
      if (!client.mobile) return { success: false, error: "Client has no mobile number" };
      try {
        const form = new URLSearchParams({
          From: client.mobile,
          CallerId: creds?.callerId ?? "",
        });
        const res = await fetch(`${baseUrl()}/Calls/connect.json`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
        });
        if (!res.ok) {
          return { success: false, error: `Exotel responded ${res.status}: ${await res.text()}` };
        }
        const data = await res.json();
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Request failed" };
      }
    },
  },
};
