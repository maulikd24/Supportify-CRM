import { z } from "zod";

import type { ConversationTurn } from "@/lib/qa/assessor";
import { htmlToText, personName, requester, requestJson, requiredString } from "../http";
import { HelpdeskAuthError, TicketNotFoundError, type HelpdeskClient, type HelpdeskProvider, type HelpdeskTicket, type SolvedTicket } from "../types";

const NAME = "Zoho Desk";
const DATA_CENTERS = ["com", "eu", "in", "com.au", "jp", "ca", "sa", "com.cn"] as const;
const schema = z.object({
  dataCenter: z.enum(DATA_CENTERS).default("com"),
  orgId: z.string().trim().regex(/^\d+$/, "Enter the numeric Zoho Desk organization ID"),
  clientId: requiredString("Enter the Zoho API client ID"),
  clientSecret: requiredString("Enter the Zoho API client secret"),
  refreshToken: requiredString("Enter a refresh token (Desk.tickets.READ, Desk.basic.READ)"),
});
type Credentials = z.infer<typeof schema>;

type ZTicket = { id: string; ticketNumber?: string; modifiedTime?: string; email?: string | null; phone?: string | null; contact?: { firstName?: string; lastName?: string } | null; subject?: string; status?: string; priority?: string | null; description?: string; createdTime?: string; assignee?: { firstName?: string; lastName?: string; email?: string } | null };
type ZThread = { id: string; direction?: "in" | "out"; createdTime?: string; author?: { name?: string; email?: string }; content?: string; summary?: string };
type ZComment = { content?: string; isPublic?: boolean; commentedTime?: string; commenter?: { name?: string } };

class ZohoDeskClient implements HelpdeskClient {
  private token: string | null = null;
  private base: string;
  constructor(private c: Credentials) {
    this.base = `https://desk.zoho.${c.dataCenter}/api/v1`;
  }

  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    const params = new URLSearchParams({ grant_type: "refresh_token", client_id: this.c.clientId, client_secret: this.c.clientSecret, refresh_token: this.c.refreshToken });
    const data = await requestJson<{ access_token?: string; error?: string }>(NAME, `https://accounts.zoho.${this.c.dataCenter}/oauth/v2/token?${params}`, { method: "POST" });
    // Zoho reports bad credentials as 200 + { error }.
    if (!data.access_token) throw new HelpdeskAuthError(`Zoho rejected the API credentials (${data.error ?? "no access token"}). Generate a new refresh token.`);
    this.token = data.access_token;
    return this.token;
  }
  private async get<T>(path: string, notFound?: string): Promise<T> {
    const token = await this.accessToken();
    return requestJson<T>(NAME, `${this.base}${path}`, { headers: { Authorization: `Zoho-oauthtoken ${token}`, orgId: this.c.orgId } }, notFound);
  }

  async testConnection() {
    await this.get("/myinfo");
  }

  async getTicket(ticketId: string): Promise<HelpdeskTicket> {
    const input = ticketId.replace(/^#/, "").trim();
    const notFound = `Ticket ${input} wasn't found in Zoho Desk.`;
    let id = input;
    // People use the short ticket number; the API wants the long internal id.
    if (/^\d{1,12}$/.test(input)) {
      const found = await this.get<{ data?: { id: string }[] } | undefined>(`/tickets/search?ticketNumber=${encodeURIComponent(input)}&limit=1`);
      if (!found?.data?.[0]) throw new TicketNotFoundError(notFound);
      id = found.data[0].id;
    }
    const ticket = await this.get<ZTicket>(`/tickets/${encodeURIComponent(id)}?include=assignee`, notFound);
    const [threadList, comments] = await Promise.all([
      this.get<{ data?: ZThread[] } | undefined>(`/tickets/${id}/threads?limit=100`),
      this.get<{ data?: ZComment[] } | undefined>(`/tickets/${id}/comments?limit=100`),
    ]);
    // The list only has summaries; fetch full content for up to 30 threads.
    const threads = await Promise.all(
      (threadList?.data ?? []).slice(0, 30).map((t) => this.get<ZThread>(`/tickets/${id}/threads/${t.id}`).catch(() => t)),
    );
    const turns = [
      ...threads.map((t) => ({ role: t.direction === "in" ? ("customer" as const) : ("agent" as const), author: t.author?.email ?? t.author?.name, body: htmlToText(t.content) || t.summary || "", created_at: t.createdTime, public: true })),
      ...(comments?.data ?? []).map((c) => ({ role: "agent" as const, author: c.commenter?.name, body: htmlToText(c.content), created_at: c.commentedTime, public: Boolean(c.isPublic) })),
    ].sort((a, b) => Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? ""));
    const conversation: ConversationTurn[] = turns.length === 0 && ticket.description ? [{ role: "customer", body: htmlToText(ticket.description), created_at: ticket.createdTime, public: true }] : turns;

    return {
      id: ticket.ticketNumber ?? ticket.id,
      subject: ticket.subject ?? "",
      status: ticket.status?.toLowerCase() ?? "",
      priority: ticket.priority?.toLowerCase() ?? undefined,
      agentName: personName(ticket.assignee?.firstName, ticket.assignee?.lastName),
      agentEmail: ticket.assignee?.email ?? "",
      conversation,
      requester: requester({ name: personName(ticket.contact?.firstName, ticket.contact?.lastName, ""), email: ticket.email, phone: ticket.phone }),
    };
  }

  async listSolvedSince(since: Date, limit: number): Promise<SolvedTicket[]> {
    const out: SolvedTicket[] = [];
    const range = `${since.toISOString()},${new Date(Date.now() + 60_000).toISOString()}`;
    for (let from = 0; out.length < limit; from += 100) {
      const page = await this.get<{ data?: ZTicket[] } | undefined>(
        `/tickets/search?status=Closed&modifiedTimeRange=${encodeURIComponent(range)}&sortBy=modifiedTime&limit=100&from=${from}`,
      );
      const rows = page?.data ?? [];
      for (const t of rows) out.push({ id: t.ticketNumber ?? t.id, tags: [], csat: null, updatedAt: t.modifiedTime });
      if (rows.length < 100) break;
    }
    return out.slice(0, limit);
  }
}

export const zohoDesk: HelpdeskProvider<Credentials> = {
  id: "zoho_desk",
  name: NAME,
  ticketLabel: "Zoho Desk ticket number",
  ticketPlaceholder: "1042",
  setupHelp: "api-console.zoho.com → Self Client → generate a code with Desk.tickets.READ and Desk.basic.READ, then exchange it for a refresh token. The org ID is under Setup → Developer Space → API.",
  docsUrl: "https://desk.zoho.com/DeskAPIDocument#OauthTokens",
  fields: [
    {
      key: "dataCenter",
      label: "Data center",
      type: "select",
      options: [
        { value: "com", label: "United States (zoho.com)" },
        { value: "eu", label: "Europe (zoho.eu)" },
        { value: "in", label: "India (zoho.in)" },
        { value: "com.au", label: "Australia (zoho.com.au)" },
        { value: "jp", label: "Japan (zoho.jp)" },
        { value: "ca", label: "Canada (zoho.ca)" },
        { value: "sa", label: "Saudi Arabia (zoho.sa)" },
        { value: "com.cn", label: "China (zoho.com.cn)" },
      ],
    },
    { key: "orgId", label: "Organization ID", type: "text", placeholder: "60001234567" },
    { key: "clientId", label: "Client ID", type: "text" },
    { key: "clientSecret", label: "Client secret", type: "password" },
    { key: "refreshToken", label: "Refresh token", type: "password" },
  ],
  schema,
  accountLabel: (c) => `Zoho Desk org ${c.orgId}`,
  createClient: (c) => new ZohoDeskClient(c),
  supportsTags: false,
  supportsCsat: false,
  listsOldestFirst: true,
};
