import { z } from "zod";

import type { ConversationTurn } from "@/lib/qa/assessor";
import { basicAuth, requester, requestJson, requiredString, subdomainField } from "../http";
import type { HelpdeskClient, HelpdeskProvider, HelpdeskTicket, SolvedTicket, TicketRequester } from "../types";

const NAME = "Freshdesk";
const schema = z.object({
  domain: subdomainField("Freshdesk domain", "freshdesk.com"),
  apiKey: requiredString("Enter a Freshdesk API key"),
});
type Credentials = z.infer<typeof schema>;

const STATUS: Record<number, string> = { 2: "open", 3: "pending", 4: "resolved", 5: "closed" };
const PRIORITY: Record<number, string> = { 1: "low", 2: "medium", 3: "high", 4: "urgent" };

type FdTicket = { id: number; subject?: string; status?: number; priority?: number; responder_id?: number | null; requester_id?: number | null; tags?: string[]; description_text?: string; created_at?: string; updated_at?: string };
type FdConversation = { body_text?: string; incoming?: boolean; private?: boolean; user_id?: number; created_at?: string };

class FreshdeskClient implements HelpdeskClient {
  private base: string;
  private headers: Record<string, string>;
  constructor(private c: Credentials) {
    this.base = `https://${c.domain}.freshdesk.com/api/v2`;
    this.headers = { Authorization: basicAuth(c.apiKey, "X") };
  }
  private get<T>(path: string, notFound?: string) {
    return requestJson<T>(NAME, `${this.base}${path}`, { headers: this.headers }, notFound);
  }

  async testConnection() {
    await this.get("/agents/me");
  }

  async getTicket(ticketId: string): Promise<HelpdeskTicket> {
    const id = encodeURIComponent(ticketId.replace(/^#/, ""));
    const notFound = `Ticket ${ticketId} wasn't found in ${this.c.domain}.freshdesk.com.`;
    const ticket = await this.get<FdTicket>(`/tickets/${id}`, notFound);
    const parts: FdConversation[] = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await this.get<FdConversation[]>(`/tickets/${id}/conversations?per_page=100&page=${page}`, notFound);
      parts.push(...batch);
      if (batch.length < 100) break;
    }

    const conversation: ConversationTurn[] = [
      ...(ticket.description_text ? [{ role: "customer" as const, body: ticket.description_text, created_at: ticket.created_at, public: true }] : []),
      ...parts.map((p) => ({ role: p.incoming ? ("customer" as const) : ("agent" as const), author: p.user_id, body: p.body_text ?? "", created_at: p.created_at, public: !p.private })),
    ];

    let agentName = "Unknown";
    let agentEmail = "";
    if (ticket.responder_id) {
      try {
        const agent = await this.get<{ contact?: { name?: string; email?: string } }>(`/agents/${ticket.responder_id}`);
        agentName = agent.contact?.name ?? agentName;
        agentEmail = agent.contact?.email ?? "";
      } catch {
        // best-effort
      }
    }
    let customer: TicketRequester | undefined;
    if (ticket.requester_id) {
      try {
        const contact = await this.get<{ name?: string; email?: string | null; phone?: string | null; mobile?: string | null }>(`/contacts/${ticket.requester_id}`);
        customer = requester({ name: contact.name, email: contact.email, phone: contact.mobile || contact.phone });
      } catch {
        // best-effort
      }
    }
    return {
      requester: customer,
      id: String(ticket.id),
      subject: ticket.subject ?? "",
      status: STATUS[ticket.status ?? 0] ?? String(ticket.status ?? ""),
      priority: PRIORITY[ticket.priority ?? 0],
      agentName,
      agentEmail,
      conversation,
    };
  }

  async listSolvedSince(since: Date, limit: number): Promise<SolvedTicket[]> {
    const out: SolvedTicket[] = [];
    // Freshdesk caps list pagination at 300 pages of 100.
    for (let page = 1; page <= 300 && out.length < limit; page++) {
      const batch = await this.get<FdTicket[]>(
        `/tickets?updated_since=${encodeURIComponent(since.toISOString())}&order_by=updated_at&order_type=asc&per_page=100&page=${page}`,
      );
      for (const t of batch) if (t.status === 4 || t.status === 5) out.push({ id: String(t.id), tags: t.tags ?? [], csat: null });
      if (batch.length < 100) break;
    }
    return out.slice(0, limit);
  }
}

export const freshdesk: HelpdeskProvider<Credentials> = {
  id: "freshdesk",
  name: NAME,
  ticketLabel: "Freshdesk ticket ID",
  ticketPlaceholder: "1024",
  setupHelp: "Profile settings (top right) → View API key. Use an agent who can see the tickets you want reviewed.",
  docsUrl: "https://support.freshdesk.com/support/solutions/articles/215517",
  fields: [
    { key: "domain", label: "Domain", type: "text", placeholder: "acme (from acme.freshdesk.com)" },
    { key: "apiKey", label: "API key", type: "password" },
  ],
  schema,
  accountLabel: (c) => `${c.domain}.freshdesk.com`,
  createClient: (c) => new FreshdeskClient(c),
  supportsTags: true,
  supportsCsat: false,
};
