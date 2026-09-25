import type { MessagingAdapter } from "@/lib/messaging/types";

interface ExotelSmsCredentials {
  sid: string;
  apiKey: string;
  apiToken: string;
  senderId: string;
}

let creds: ExotelSmsCredentials | null = null;

export const smsExotelAdapter: MessagingAdapter = {
  channel: "sms",
  provider: "sms_exotel",

  async configure(credentials) {
    creds = {
      sid: String(credentials.sid ?? ""),
      apiKey: String(credentials.apiKey ?? ""),
      apiToken: String(credentials.apiToken ?? ""),
      senderId: String(credentials.senderId ?? ""),
    };
  },

  async sendMessage({ to, body }) {
    if (!creds) throw new Error("Exotel SMS adapter not configured");

    const url = `https://${creds.apiKey}:${creds.apiToken}@api.exotel.com/v1/Accounts/${creds.sid}/Sms/send.json`;
    const form = new URLSearchParams({ From: creds.senderId, To: to, Body: body });

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`Exotel SMS API responded ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    return { externalId: data.SMSMessage?.Sid ?? "", status: "SENT" };
  },

  async handleInboundWebhook(payload) {
    const body = payload as { From?: string; Body?: string; SmsSid?: string };
    return [
      {
        externalId: body.SmsSid ?? `exotel-in-${Date.now()}`,
        fromPhone: body.From ?? "unknown",
        body: body.Body ?? "",
        receivedAt: new Date(),
      },
    ];
  },

  async handleStatusWebhook(payload) {
    const body = payload as { SmsSid?: string; Status?: string };
    return [
      {
        externalId: body.SmsSid ?? "",
        status: (body.Status?.toUpperCase() as "DELIVERED" | "FAILED") ?? "DELIVERED",
      },
    ];
  },
};
