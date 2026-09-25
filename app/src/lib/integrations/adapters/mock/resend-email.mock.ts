import type { EmailAdapter } from "@/lib/integrations/types";

export const resendEmailMockAdapter: EmailAdapter = {
  provider: "resend_email",

  async configure() {
    // no-op
  },

  async sendEmail({ to, subject }) {
    console.log("[mock resend-email]", to, subject);
    return { success: true, data: { id: `mock-email-${Date.now()}`, mock: true } };
  },
};
