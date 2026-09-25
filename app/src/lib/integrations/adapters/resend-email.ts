import type { EmailAdapter } from "@/lib/integrations/types";

interface ResendCredentials {
  apiKey: string;
  fromAddress: string;
  fromName?: string;
}

let creds: ResendCredentials | null = null;

export const resendEmailAdapter: EmailAdapter = {
  provider: "resend_email",

  async configure(credentials) {
    creds = {
      apiKey: String(credentials.apiKey ?? ""),
      fromAddress: String(credentials.fromAddress ?? ""),
      fromName: credentials.fromName ? String(credentials.fromName) : undefined,
    };
  },

  async sendEmail({ to, subject, html, text }) {
    if (!creds) throw new Error("Resend email adapter not configured");

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: creds.fromName ? `${creds.fromName} <${creds.fromAddress}>` : creds.fromAddress,
          to,
          subject,
          html,
          text,
        }),
      });
      if (!res.ok) {
        return { success: false, error: `Resend responded ${res.status}: ${await res.text()}` };
      }
      const data = await res.json();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Request failed" };
    }
  },
};
