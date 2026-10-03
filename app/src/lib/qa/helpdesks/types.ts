import type { z } from "zod";

import type { ConversationTurn } from "@/lib/qa/assessor";

export type HelpdeskProviderId =
  | "zendesk"
  | "freshdesk"
  | "intercom"
  | "hubspot"
  | "salesforce"
  | "zoho_desk"
  | "help_scout"
  | "gorgias"
  | "front"
  | "servicenow"
  | "jira_service_management";

/** The helpdesk rejected the stored credentials (401/403). Auto-review stops polling until they're re-tested. */
export class HelpdeskAuthError extends Error {
  override name = "HelpdeskAuthError";
}

/** The ticket doesn't exist in the connected helpdesk. */
export class TicketNotFoundError extends Error {
  override name = "TicketNotFoundError";
}

/** A ticket normalised across helpdesks: everything QA scoring needs. */
export type HelpdeskTicket = {
  /** The id people see and type (Zendesk #, Salesforce case number, Jira key…). */
  id: string;
  subject: string;
  status: string;
  priority?: string;
  agentName: string;
  agentEmail: string;
  conversation: ConversationTurn[];
};

/** A solved/closed ticket found while polling for auto-review. */
export type SolvedTicket = {
  id: string;
  tags: string[];
  /** Customer satisfaction, when the helpdesk records it. */
  csat: "good" | "bad" | null;
};

export interface HelpdeskClient {
  /** Throws HelpdeskAuthError (bad credentials) or Error (unreachable) on failure. */
  testConnection(): Promise<void>;
  getTicket(ticketId: string): Promise<HelpdeskTicket>;
  /** Tickets solved/closed (or updated while solved) after `since`, oldest first, at most `limit`. */
  listSolvedSince(since: Date, limit: number): Promise<SolvedTicket[]>;
}

/** A credential input shown in the connect form. */
export type CredentialField = {
  key: string;
  label: string;
  type: "text" | "password" | "email" | "select";
  placeholder?: string;
  help?: string;
  optional?: boolean;
  options?: { value: string; label: string }[];
};

export type HelpdeskProvider<C = Record<string, string>> = {
  id: HelpdeskProviderId;
  name: string;
  /** What a ticket is called there, for "Zendesk ticket ID" style labels. */
  ticketLabel: string;
  ticketPlaceholder: string;
  /** One-line "where to find these credentials" hint. */
  setupHelp: string;
  docsUrl: string;
  fields: CredentialField[];
  /** Validates and normalises the form input (e.g. "acme.zendesk.com" → "acme"). */
  schema: z.ZodType<C>;
  /** Shown once connected, e.g. "acme.zendesk.com". Never includes secrets. */
  accountLabel(credentials: C): string;
  createClient(credentials: C): HelpdeskClient;
  /** Whether auto-review's tag rules / bad-CSAT rule can apply. */
  supportsTags: boolean;
  supportsCsat: boolean;
};
