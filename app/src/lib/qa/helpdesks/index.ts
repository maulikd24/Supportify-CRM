import { decryptJson } from "@/lib/security/crypto";
import { freshdesk } from "./providers/freshdesk";
import { front } from "./providers/front";
import { gorgias } from "./providers/gorgias";
import { helpScout } from "./providers/help-scout";
import { hubspot } from "./providers/hubspot";
import { intercom } from "./providers/intercom";
import { jiraServiceManagement } from "./providers/jira-service-management";
import { salesforce } from "./providers/salesforce";
import { servicenow } from "./providers/servicenow";
import { zendesk } from "./providers/zendesk";
import { zohoDesk } from "./providers/zoho-desk";
import type { CredentialField, HelpdeskClient, HelpdeskProvider, HelpdeskProviderId } from "./types";

export * from "./types";

/** Every helpdesk QA Sentinel can review tickets from, in the order shown in Settings. */
export const HELPDESK_PROVIDERS = [
  zendesk,
  freshdesk,
  intercom,
  hubspot,
  salesforce,
  zohoDesk,
  helpScout,
  gorgias,
  front,
  servicenow,
  jiraServiceManagement,
] as unknown as HelpdeskProvider<Record<string, string>>[];

const BY_ID = new Map(HELPDESK_PROVIDERS.map((p) => [p.id, p]));

export function isHelpdeskProvider(id: string): id is HelpdeskProviderId {
  return BY_ID.has(id as HelpdeskProviderId);
}

export function getHelpdeskProvider(id: string): HelpdeskProvider<Record<string, string>> {
  const provider = BY_ID.get(id as HelpdeskProviderId);
  if (!provider) throw new Error(`Unknown helpdesk provider: ${id}`);
  return provider;
}

/** API client for a stored connection (credentials are decrypted only here). */
export function helpdeskClient(connection: { provider: string; encryptedCredentials: string }): HelpdeskClient {
  const provider = getHelpdeskProvider(connection.provider);
  // Re-validate on the way out so older rows are normalised the same way as new ones.
  return provider.createClient(provider.schema.parse(decryptJson<unknown>(connection.encryptedCredentials)));
}

/** Plain, serialisable provider info for client components (no functions, no schemas). */
export type HelpdeskProviderOption = {
  id: HelpdeskProviderId;
  name: string;
  ticketLabel: string;
  ticketPlaceholder: string;
  setupHelp: string;
  docsUrl: string;
  fields: CredentialField[];
  supportsTags: boolean;
  supportsCsat: boolean;
};

export function helpdeskProviderOption(p: HelpdeskProvider<Record<string, string>>): HelpdeskProviderOption {
  const { id, name, ticketLabel, ticketPlaceholder, setupHelp, docsUrl, fields, supportsTags, supportsCsat } = p;
  return { id, name, ticketLabel, ticketPlaceholder, setupHelp, docsUrl, fields, supportsTags, supportsCsat };
}

export const HELPDESK_PROVIDER_OPTIONS: HelpdeskProviderOption[] = HELPDESK_PROVIDERS.map(helpdeskProviderOption);
