import { z } from "zod";

import type { ConversationTurn } from "@/lib/qa/assessor";
import { basicAuth, htmlToText, requestJson, requiredString, subdomainField } from "../http";
import type { HelpdeskClient, HelpdeskProvider, HelpdeskTicket, SolvedTicket } from "../types";

const NAME = "Gorgias";
const schema = z.object({
  domain: subdomainField("Gorgias domain", "gorgias.com"),
  email: z.string().trim().email("Enter the email of the Gorgias user who created the API key"),
  apiKey: requiredString("Enter a Gorgias API key"),
});
type Credentials = z.infer<typeof schema>;

type GTicket = {
  id: number;
  subject?: string | null;
  status?: string;
  priority?: string;
  updated_datetime?: string;
  assignee_user?: { name?: string; email?: string } | null;
  tags?: { name: string }[];
  satisfaction_survey?: { score?: number | null } | null;
};
type GMessage = { from_agent?: boolean; public?: boolean; body_text?: string | null; stripped_text?: string | null; body_html?: string | null; sender?: { email?: string }; created_datetime?: string };

class GorgiasClient implements HelpdeskClient {
  private base: string;
  private headers: Record<string, string>;
  constructor(private c: Credentials) {
    this.base = `https://${c.domain}.gorgias.com/api`;
    this.headers = { Authorization: basicAuth(c.email, c.apiKey) };
  }
  private get<T>(path: string, notFound?: string) {
    return requestJson<T>(NAME, `${this.base}${path}`, { headers: this.headers }, notFound);
  }

  async testConnection() {
    await this.get("/account");
  }

  async getTicket(ticketId: string): Promise<HelpdeskTicket> {
    const id = encodeURIComponent(ticketId.replace(/^#/, ""));
    const notFound = `Ticket ${ticketId} wasn't found in ${this.c.domain}.gorgias.com.`;
    const ticket = await this.get<GTicket>(`/tickets/${id}`, notFound);
    const { data } = await this.get<{ data: GMessage[] }>(`/tickets/${id}/messages?limit=100`, notFound);
    const conversation: ConversationTurn[] = data
      .sort((a, b) => Date.parse(a.created_datetime ?? "") - Date.parse(b.created_datetime ?? ""))
      .map((m) => ({
        role: m.from_agent ? "agent" : "customer",
        author: m.sender?.email,
        body: m.stripped_text || m.body_text || htmlToText(m.body_html),
        created_at: m.created_datetime,
        public: m.public ?? true,
      }));
    return {
      id: String(ticket.id),
      subject: ticket.subject ?? "",
      status: ticket.status ?? "",
      priority: ticket.priority,
      agentName: ticket.assignee_user?.name ?? "Unknown",
      agentEmail: ticket.assignee_user?.email ?? "",
      conversation,
    };
  }

  async listSolvedSince(since: Date, limit: number): Promise<SolvedTicket[]> {
    const out: SolvedTicket[] = [];
    let cursor: string | null = null;
    // Newest-updated first; stop once we're past `since`.
    for (let pages = 0; pages < 50 && out.length < limit; pages++) {
      const page: { data: GTicket[]; meta?: { next_cursor?: string | null } } = await this.get(
        `/tickets?limit=100&order_by=updated_datetime:desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      let reachedOld = false;
      for (const t of page.data) {
        if (Date.parse(t.updated_datetime ?? "") <= since.getTime()) {
          reachedOld = true;
          break;
        }
        if (t.status !== "closed") continue;
        const score = t.satisfaction_survey?.score;
        out.push({ id: String(t.id), tags: (t.tags ?? []).map((x) => x.name), csat: score == null ? null : score <= 2 ? "bad" : score >= 4 ? "good" : null });
      }
      cursor = page.meta?.next_cursor ?? null;
      if (reachedOld || !cursor) break;
    }
    return out.reverse().slice(0, limit);
  }
}

export const gorgias: HelpdeskProvider<Credentials> = {
  id: "gorgias",
  name: NAME,
  ticketLabel: "Gorgias ticket ID",
  ticketPlaceholder: "28457123",
  setupHelp: "Settings → REST API → copy the base URL's domain, your username (email) and the API key.",
  docsUrl: "https://developers.gorgias.com/reference/authentication",
  fields: [
    { key: "domain", label: "Domain", type: "text", placeholder: "acme (from acme.gorgias.com)" },
    { key: "email", label: "Username (email)", type: "email" },
    { key: "apiKey", label: "API key", type: "password" },
  ],
  schema,
  accountLabel: (c) => `${c.domain}.gorgias.com`,
  createClient: (c) => new GorgiasClient(c),
  supportsTags: true,
  supportsCsat: true,
};
