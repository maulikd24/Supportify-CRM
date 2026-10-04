import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * The per-org token in an inbound webhook URL (/api/webhooks/…/<token>) is what
 * identifies the tenant, and for providers that don't sign their webhooks (Exotel,
 * Freshdesk, CleverTap) it is the only credential — so it must be unguessable:
 * 256 random bits, rather than Prisma's cuid() default. Admins can rotate it from
 * Settings > Integrations if a URL leaks.
 */
export function newWebhookToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Meta signs every WhatsApp Cloud API webhook with the app secret:
 * X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw request body>.
 */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex"));
  const given = Buffer.from(header.slice("sha256=".length));
  return expected.length === given.length && timingSafeEqual(expected, given);
}
