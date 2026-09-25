import { Resend } from "resend";

const globalForResend = globalThis as unknown as { resend: Resend | undefined };

function getResend(): Resend {
  if (globalForResend.resend) return globalForResend.resend;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set. Add it to your environment to send email.");
  }
  const client = new Resend(apiKey);
  if (process.env.NODE_ENV !== "production") globalForResend.resend = client;
  return client;
}

const FROM = process.env.EMAIL_FROM || "Supportify <noreply@supportify.co.in>";

export async function sendEmail(params: { to: string; subject: string; html: string; text: string }): Promise<void> {
  // In local dev without a Resend key, log instead of failing signup/reset flows outright.
  if (!process.env.RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY not set — would have sent "${params.subject}" to ${params.to}:\n${params.text}`);
    return;
  }
  await getResend().emails.send({ from: FROM, to: params.to, subject: params.subject, html: params.html, text: params.text });
}

function wrapHtml(bodyHtml: string): string {
  return `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">${bodyHtml}</div>`;
}

export async function sendVerificationEmail(params: { to: string; name: string; verifyUrl: string }): Promise<void> {
  const text = `Hi ${params.name},\n\nVerify your Supportify account: ${params.verifyUrl}\n\nThis link expires in 24 hours.`;
  const html = wrapHtml(
    `<p>Hi ${params.name},</p><p>Verify your Supportify account by clicking the link below.</p>` +
      `<p><a href="${params.verifyUrl}">Verify email address</a></p><p>This link expires in 24 hours.</p>`,
  );
  await sendEmail({ to: params.to, subject: "Verify your Supportify account", html, text });
}

export async function sendPasswordResetEmail(params: { to: string; name: string; resetUrl: string }): Promise<void> {
  const text = `Hi ${params.name},\n\nReset your Supportify password: ${params.resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`;
  const html = wrapHtml(
    `<p>Hi ${params.name},</p><p>Reset your Supportify password by clicking the link below.</p>` +
      `<p><a href="${params.resetUrl}">Reset password</a></p>` +
      `<p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>`,
  );
  await sendEmail({ to: params.to, subject: "Reset your Supportify password", html, text });
}
