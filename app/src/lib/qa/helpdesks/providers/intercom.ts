import { z } from "zod";

import type { ConversationTurn } from "@/lib/qa/assessor";
import { htmlToText, requester, requestJson, requiredString, unix } from "../http";
import type { HelpdeskClient, HelpdeskProvider, HelpdeskTicket, SolvedTicket, TicketRequester } from "../types";

const NAME = "Intercom";
const schema = z.object({
  accessToken: requiredString("Enter an Intercom access token"),
  region: z.enum(["us", "eu", "au"]).default("us"),
});
type Credentials = z.infer<typeof schema>;

const HOSTS = { us: "https://api.intercom.io", eu: "https://api.eu.intercom.io", au: "https://api.au.intercom.io" } as const;
const CUSTOMER_AUTHORS = new Set(["user", "lead", "contact"]);

type IcAuthor = { type?: string; id?: string; name?: string | null; email?: string | null };
type IcPart = { part_type?: string; body?: string | null; author?: IcAuthor; created_at?: number };
type IcConversation = {
  id: string;
  contacts?: { contacts?: { id: string }[] };
  title?: string | null;
  state?: string;
  priority?: string;
  admin_assignee_id?: number | string | null;
  created_at?: number;
  tags?: { tags?: { name: string }[] };
  conversation_rating?: { rating?: number | null } | null;
  source?: { subject?: string | null; body?: string | null; author?: IcAuthor };
  conversation_parts?: { conversation_parts?: IcPart[] };
};

class IntercomClient implements HelpdeskClient {
  private base: string;
  private headers: Record<string, string>;
  constructor(c: Credentials) {
    this.base = HOSTS[c.region];
    this.headers = { Authorization: `Bearer ${c.accessToken}`, "Intercom-Version": "2.11", "Content-Type": "application/json" };
  }
  private req<T>(path: string, init: RequestInit = {}, notFound?: string) {
    return requestJson<T>(NAME, `${this.base}${path}`, { ...init, headers: this.headers }, notFound);
  }

  async testConnection() {
    await this.req("/me");
  }

  async getTicket(ticketId: string): Promise<HelpdeskTicket> {
    const c = await this.req<IcConversation>(`/conversations/${encodeURIComponent(ticketId)}?display_as=plaintext`, {}, `Conversation ${ticketId} wasn't found in Intercom.`);
    const role = (a?: IcAuthor) => (a?.type && CUSTOMER_AUTHORS.has(a.type) ? "customer" : "agent") as ConversationTurn["role"];
    const conversation: ConversationTurn[] = [];
    if (c.source?.body) conversation.push({ role: role(c.source.author), author: c.source.author?.id, body: htmlToText(c.source.body), created_at: toIso(c.created_at), public: true });
    for (const p of c.conversation_parts?.conversation_parts ?? []) {
      if ((p.part_type !== "comment" && p.part_type !== "note") || !p.body) continue;
      conversation.push({ role: role(p.author), author: p.author?.id, body: htmlToText(p.body), created_at: toIso(p.created_at), public: p.part_type === "comment" });
    }

    let agentName = "Unknown";
    let agentEmail = "";
    if (c.admin_assignee_id) {
      try {
        const admin = await this.req<{ name?: string; email?: string }>(`/admins/${c.admin_assignee_id}`);
        agentName = admin.name ?? agentName;
        agentEmail = admin.email ?? "";
      } catch {
        // best-effort
      }
    }
    if (!agentEmail) {
      // Unassigned: credit the teammate who replied last.
      const last = [...(c.conversation_parts?.conversation_parts ?? [])].reverse().find((p) => p.part_type === "comment" && p.author?.type === "admin");
      if (last?.author) {
        agentName = last.author.name ?? agentName;
        agentEmail = last.author.email ?? "";
      }
    }
    let customer: TicketRequester | undefined;
    const contactId = c.contacts?.contacts?.[0]?.id;
    if (contactId) {
      try {
        const contact = await this.req<{ name?: string | null; email?: string | null; phone?: string | null }>(`/contacts/${encodeURIComponent(contactId)}`);
        customer = requester(contact);
      } catch {
        // best-effort
      }
    }
    customer ??= c.source?.author?.type && CUSTOMER_AUTHORS.has(c.source.author.type) ? requester(c.source.author) : undefined;
    return { id: c.id, subject: c.title || htmlToText(c.source?.subject) || "", status: c.state ?? "", priority: c.priority, agentName, agentEmail, conversation, requester: customer };
  }

  async listSolvedSince(since: Date, limit: number): Promise<SolvedTicket[]> {
    const out: SolvedTicket[] = [];
    let startingAfter: string | undefined;
    do {
      const page: { conversations?: IcConversation[]; pages?: { next?: { starting_after?: string } | null } } = await this.req("/conversations/search", {
        method: "POST",
        body: JSON.stringify({
          query: {
            operator: "AND",
            value: [
              { field: "state", operator: "=", value: "closed" },
              { field: "updated_at", operator: ">", value: unix(since) },
            ],
          },
          pagination: { per_page: 150, ...(startingAfter ? { starting_after: startingAfter } : {}) },
        }),
      });
      for (const c of page.conversations ?? []) {
        const rating = c.conversation_rating?.rating;
        out.push({ id: c.id, tags: (c.tags?.tags ?? []).map((t) => t.name), csat: rating == null ? null : rating <= 2 ? "bad" : rating >= 4 ? "good" : null });
      }
      startingAfter = page.pages?.next?.starting_after ?? undefined;
    } while (startingAfter && out.length < limit);
    return out.slice(0, limit);
  }
}

function toIso(seconds?: number) {
  return seconds ? new Date(seconds * 1000).toISOString() : undefined;
}

export const intercom: HelpdeskProvider<Credentials> = {
  id: "intercom",
  name: NAME,
  ticketLabel: "Intercom conversation ID",
  ticketPlaceholder: "215467382910324",
  setupHelp: "Developer Hub → your app → Authentication → access token (needs read conversations and read admins).",
  docsUrl: "https://developers.intercom.com/docs/build-an-integration/learn-more/authentication",
  fields: [
    { key: "accessToken", label: "Access token", type: "password" },
    {
      key: "region",
      label: "Data region",
      type: "select",
      options: [
        { value: "us", label: "United States" },
        { value: "eu", label: "Europe" },
        { value: "au", label: "Australia" },
      ],
    },
  ],
  schema,
  accountLabel: (c) => `Intercom (${c.region.toUpperCase()})`,
  createClient: (c) => new IntercomClient(c),
  supportsTags: true,
  supportsCsat: true,
};
