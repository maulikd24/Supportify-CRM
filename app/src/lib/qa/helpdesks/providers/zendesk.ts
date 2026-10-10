import { z } from "zod";

import type { ConversationTurn } from "@/lib/qa/assessor";
import { basicAuth, requester, requestJson, requiredString, subdomainField } from "../http";
import type { HelpdeskClient, HelpdeskProvider, HelpdeskTicket, SolvedTicket, TicketRequester } from "../types";

const NAME = "Zendesk";
const schema = z.object({
  subdomain: subdomainField("Zendesk subdomain", "zendesk.com"),
  email: z.string().trim().email("Enter the Zendesk agent email"),
  apiToken: requiredString("Enter a Zendesk API token"),
});
type Credentials = z.infer<typeof schema>;

type ZdTicket = { id: number; subject?: string; status?: string; priority?: string; requester_id?: number; assignee_id?: number; updated_at?: string; tags?: string[]; satisfaction_rating?: { score?: string } | null };
type ZdComment = { author_id?: number; public?: boolean; plain_body?: string; body?: string; created_at?: string };

class ZendeskClient implements HelpdeskClient {
  private base: string;
  private headers: Record<string, string>;
  constructor(private c: Credentials) {
    this.base = `https://${c.subdomain}.zendesk.com/api/v2`;
    this.headers = { Authorization: basicAuth(`${c.email}/token`, c.apiToken) };
  }
  private get<T>(path: string, notFound?: string) {
    return requestJson<T>(NAME, path.startsWith("http") ? path : `${this.base}${path}`, { headers: this.headers }, notFound);
  }

  async testConnection() {
    await this.get("/users/me.json");
  }

  async getTicket(ticketId: string): Promise<HelpdeskTicket> {
    const id = ticketId.replace(/^#/, "");
    const notFound = `Ticket ${id} wasn't found in ${this.c.subdomain}.zendesk.com.`;
    const { ticket } = await this.get<{ ticket: ZdTicket }>(`/tickets/${encodeURIComponent(id)}.json`, notFound);
    const { comments } = await this.get<{ comments: ZdComment[] }>(`/tickets/${encodeURIComponent(id)}/comments.json`, notFound);

    const conversation: ConversationTurn[] = comments.map((c, i) => ({
      role: i === 0 || (c.public && c.author_id === ticket.requester_id) ? "customer" : "agent",
      author: c.author_id,
      body: c.plain_body || c.body || "",
      created_at: c.created_at,
      public: c.public ?? true,
    }));

    let agentName = "Unknown";
    let agentEmail = "";
    if (ticket.assignee_id) {
      try {
        const { user } = await this.get<{ user: { name?: string; email?: string } }>(`/users/${ticket.assignee_id}.json`);
        agentName = user.name ?? agentName;
        agentEmail = user.email ?? "";
      } catch {
        // Agent lookup is best-effort.
      }
    }
    let customer: TicketRequester | undefined;
    if (ticket.requester_id) {
      try {
        const { user } = await this.get<{ user: { name?: string; email?: string | null; phone?: string | null } }>(`/users/${ticket.requester_id}.json`);
        customer = requester(user);
      } catch {
        // Requester lookup is best-effort too.
      }
    }
    return { id: String(ticket.id), subject: ticket.subject ?? "", status: ticket.status ?? "", priority: ticket.priority, agentName, agentEmail, conversation, requester: customer };
  }

  async listSolvedSince(since: Date, limit: number): Promise<SolvedTicket[]> {
    const url = new URL(`${this.base}/search.json`);
    url.searchParams.set("query", `type:ticket status>=solved updated>${since.toISOString()}`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("sort_by", "updated_at");
    url.searchParams.set("sort_order", "asc");
    const out: SolvedTicket[] = [];
    let next: string | null = url.toString();
    while (next && out.length < limit) {
      const page: { results?: ZdTicket[]; next_page?: string | null } = await this.get(next);
      for (const t of page.results ?? []) {
        if (t.status !== "solved" && t.status !== "closed") continue;
        const score = t.satisfaction_rating?.score;
        out.push({ id: String(t.id), tags: t.tags ?? [], csat: score === "bad" ? "bad" : score === "good" ? "good" : null, updatedAt: t.updated_at });
      }
      next = page.next_page ?? null;
    }
    return out.slice(0, limit);
  }
}

export const zendesk: HelpdeskProvider<Credentials> = {
  id: "zendesk",
  name: NAME,
  ticketLabel: "Zendesk ticket ID",
  ticketPlaceholder: "12345",
  setupHelp: "Admin Center → Apps and integrations → Zendesk API → add an API token. Use the email of an agent who can see the tickets.",
  docsUrl: "https://support.zendesk.com/hc/en-us/articles/4408889192858",
  fields: [
    { key: "subdomain", label: "Subdomain", type: "text", placeholder: "acme (from acme.zendesk.com)" },
    { key: "email", label: "Agent email", type: "email", placeholder: "qa@acme.com" },
    { key: "apiToken", label: "API token", type: "password" },
  ],
  schema,
  accountLabel: (c) => `${c.subdomain}.zendesk.com`,
  createClient: (c) => new ZendeskClient(c),
  supportsTags: true,
  supportsCsat: true,
  listsOldestFirst: true,
};
