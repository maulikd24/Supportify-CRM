import type { TicketRequester } from "@/lib/qa/helpdesks/types";
import { z } from "zod";

import { HelpdeskAuthError, TicketNotFoundError } from "./types";

/**
 * fetch + JSON with consistent, customer-readable errors for every helpdesk:
 * 401/403 → HelpdeskAuthError, 404 → TicketNotFoundError, anything else → Error.
 */
export async function requestJson<T>(provider: string, url: string | URL, init: RequestInit = {}, notFound?: string): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init.headers ?? {}) } });
  } catch (error) {
    throw new Error(`Couldn't reach ${provider}. Check the account address in QA Settings. (${error instanceof Error ? error.message : String(error)})`);
  }
  if (resp.status === 401) throw new HelpdeskAuthError(`${provider} rejected the saved credentials (401). Reconnect ${provider} in QA Settings.`);
  if (resp.status === 403) {
    throw new HelpdeskAuthError(`${provider} accepted the credentials but they don't have permission to read tickets (403). Check the account's role or app scopes.`);
  }
  if (resp.status === 404) throw new TicketNotFoundError(notFound ?? `Not found in ${provider} (404).`);
  if (resp.status === 429) throw new Error(`${provider} rate limit reached. Try again in a minute.`);
  if (!resp.ok) throw new Error(`${provider} request failed with status ${resp.status}.`);
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

export function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Good-enough HTML → plain text for scoring (keeps paragraph breaks). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A requester with blank fields dropped; undefined when nothing identifies them. */
export function requester(r: { name?: string | null; email?: string | null; phone?: string | null }): TicketRequester | undefined {
  const name = r.name?.trim() || undefined;
  const email = r.email?.trim() || undefined;
  const phone = r.phone?.trim() || undefined;
  return email || phone ? { name, email, phone } : undefined;
}

export function personName(first?: string | null, last?: string | null, fallback = "Unknown"): string {
  return [first, last].filter(Boolean).join(" ").trim() || fallback;
}

/**
 * A helpdesk account subdomain: accepts "acme", "acme.zendesk.com" or a full URL
 * and keeps only the subdomain, so requests can only ever go to the vendor's own domain.
 */
export function subdomainField(label: string, vendorDomain: string) {
  return z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v.replace(/^https?:\/\//, "").split("/")[0].replace(new RegExp(`\\.${vendorDomain.replace(/\./g, "\\.")}$`), ""))
    .pipe(z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, `Enter your ${label} (the part before .${vendorDomain})`));
}

export const requiredString = (message: string) => z.string().trim().min(1, message);

/** Seconds since epoch. */
export const unix = (d: Date) => Math.floor(d.getTime() / 1000);

/** ISO-8601 without milliseconds, which some APIs insist on. */
export const isoSeconds = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
