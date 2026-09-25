import { WorkOS } from "@workos-inc/node";

const globalForWorkos = globalThis as unknown as { workos: WorkOS | undefined };

/** Lazily constructed so importing this module doesn't require WORKOS_API_KEY unless SSO is actually used. */
export function getWorkos(): WorkOS {
  if (globalForWorkos.workos) return globalForWorkos.workos;

  const apiKey = process.env.WORKOS_API_KEY;
  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!apiKey || !clientId) {
    throw new Error("WORKOS_API_KEY and WORKOS_CLIENT_ID must be set to enable SSO.");
  }
  const client = new WorkOS(apiKey, { clientId });
  if (process.env.NODE_ENV !== "production") globalForWorkos.workos = client;
  return client;
}

export function workosClientId(): string {
  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!clientId) throw new Error("WORKOS_CLIENT_ID is not set.");
  return clientId;
}

export function ssoCallbackUrl(): string {
  const base = process.env.WORKOS_REDIRECT_URI;
  if (!base) throw new Error("WORKOS_REDIRECT_URI is not set.");
  return base;
}

/** Extracts the domain from an email address, lowercased. Returns null for a malformed address. */
export function emailDomain(email: string): string | null {
  const parts = email.trim().toLowerCase().split("@");
  return parts.length === 2 && parts[1] ? parts[1] : null;
}
