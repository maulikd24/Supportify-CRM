import type { MessagingAdapter } from "@/lib/messaging/types";

interface MetaCredentials {
  phoneNumberId: string;
  accessToken: string;
}

/**
 * Returns a fresh adapter instance holding one org's credentials. Never share an
 * instance (or hoist `creds` to module scope) — a warm serverless instance serves
 * many tenants concurrently, so shared state would send with another org's account.
 */
export function createWhatsappMetaAdapter(): MessagingAdapter {
  let creds: MetaCredentials | null = null;

  return {
    channel: "whatsapp",
    provider: "whatsapp_meta",

    async configure(credentials) {
      creds = {
        phoneNumberId: String(credentials.phoneNumberId ?? ""),
        accessToken: String(credentials.accessToken ?? ""),
      };
    },

    async sendMessage({ to, templateExternalId, variables }) {
      if (!creds) throw new Error("WhatsApp (Meta) adapter not configured");

      const body = templateExternalId
        ? {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
              name: templateExternalId,
              language: { code: "en_US" },
              components: [
                {
                  type: "body",
                  parameters: Object.values(variables).map((text) => ({ type: "text", text })),
                },
              ],
            },
          }
        : { messaging_product: "whatsapp", to, type: "text", text: { body: variables.body ?? "" } };

      const res = await fetch(`https://graph.facebook.com/v20.0/${creds.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`Meta WhatsApp API responded ${res.status}: ${await res.text()}`);
      }
      const data = await res.json();
      return { externalId: data.messages?.[0]?.id ?? "", status: "SENT" };
    },

    async handleInboundWebhook(payload) {
      const body = payload as {
        entry?: { changes?: { value?: { messages?: { id: string; from: string; text?: { body: string }; timestamp: string }[] } }[] }[];
      };
      const messages = body.entry?.flatMap((e) => e.changes?.flatMap((c) => c.value?.messages ?? []) ?? []) ?? [];
      return messages.map((m) => ({
        externalId: m.id,
        fromPhone: m.from,
        body: m.text?.body ?? "",
        receivedAt: new Date(Number(m.timestamp) * 1000),
      }));
    },

    async handleStatusWebhook(payload) {
      const body = payload as {
        entry?: { changes?: { value?: { statuses?: { id: string; status: string }[] } }[] }[];
      };
      const statuses = body.entry?.flatMap((e) => e.changes?.flatMap((c) => c.value?.statuses ?? []) ?? []) ?? [];
      return statuses.map((s) => ({
        externalId: s.id,
        status: (s.status.toUpperCase() as "SENT" | "DELIVERED" | "READ" | "FAILED") ?? "SENT",
      }));
    },
  };
}
