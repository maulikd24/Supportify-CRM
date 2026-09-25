import type { IntegrationAdapter } from "@/lib/integrations/types";

interface ClevertapCredentials {
  accountId: string;
  passcode: string;
  region?: string; // e.g. "eu1", "sg1" — omit for default (us)
}

let creds: ClevertapCredentials | null = null;

function baseUrl(): string {
  if (!creds) throw new Error("Clevertap adapter not configured");
  const host = creds.region ? `${creds.region}.api.clevertap.com` : "api.clevertap.com";
  return `https://${host}/1`;
}

function headers(): HeadersInit {
  if (!creds) throw new Error("Clevertap adapter not configured");
  return {
    "X-CleverTap-Account-Id": creds.accountId,
    "X-CleverTap-Passcode": creds.passcode,
    "Content-Type": "application/json",
  };
}

export const clevertapAdapter: IntegrationAdapter = {
  provider: "clevertap",

  async configure(credentials) {
    creds = {
      accountId: String(credentials.accountId ?? ""),
      passcode: String(credentials.passcode ?? ""),
      region: credentials.region ? String(credentials.region) : undefined,
    };
  },

  async testConnection() {
    try {
      const res = await fetch(`${baseUrl()}/upload`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ d: [] }),
      });
      if (!res.ok) return { ok: false, message: `Clevertap responded ${res.status}` };
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Connection failed" };
    }
  },

  async handleWebhook(payload) {
    const body = payload as { identity?: string; evtName?: string; evtData?: Record<string, unknown> };
    return [
      {
        type: "campaign_event",
        clientEmail: body.identity,
        payload: { eventName: body.evtName, props: body.evtData ?? {} },
      },
    ];
  },

  actions: {
    async syncProfile(client) {
      try {
        const identity = client.email ?? client.mobile ?? client.id;
        const res = await fetch(`${baseUrl()}/upload`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            d: [
              {
                identity,
                type: "profile",
                profileData: {
                  Name: client.name,
                  Email: client.email ?? undefined,
                  Phone: client.mobile ?? undefined,
                  clientStatus: client.status,
                },
              },
            ],
          }),
        });
        if (!res.ok) {
          return { success: false, error: `Clevertap responded ${res.status}: ${await res.text()}` };
        }
        const data = await res.json();
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Request failed" };
      }
    },
  },
};
