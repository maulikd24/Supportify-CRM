import { z } from "zod";

import type { ConversationTurn } from "@/lib/qa/assessor";
import { htmlToText, isoSeconds, personName, requestJson, requiredString } from "../http";
import { HelpdeskAuthError, TicketNotFoundError, type HelpdeskClient, type HelpdeskProvider, type HelpdeskTicket, type SolvedTicket } from "../types";

const NAME = "Help Scout";
const BASE = "https://api.helpscout.net/v2";
const schema = z.object({
  appId: requiredString("Enter the Help Scout app ID"),
  appSecret: requiredString("Enter the Help Scout app secret"),
});
type Credentials = z.infer<typeof schema>;

type HsPerson = { type?: string; first?: string; last?: string; email?: string };
type HsThread = { type?: string; body?: string; createdAt?: string; createdBy?: HsPerson };
type HsConversation = {
  id: number;
  number?: number;
  subject?: string;
  status?: string;
  assignee?: HsPerson | null;
  tags?: { tag: string }[];
  _embedded?: { threads?: HsThread[] };
};
const SCORED_THREADS = new Set(["customer", "reply", "message", "note", "chat", "phone"]);

class HelpScoutClient implements HelpdeskClient {
  private token: string | null = null;
  constructor(private c: Credentials) {}

  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    let resp: Response;
    try {
      resp = await fetch(`${BASE}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credentials", client_id: this.c.appId, client_secret: this.c.appSecret }),
      });
    } catch (error) {
      throw new Error(`Couldn't reach Help Scout. (${error instanceof Error ? error.message : String(error)})`);
    }
    const data = (await resp.json().catch(() => ({}))) as { access_token?: string };
    if (!resp.ok || !data.access_token) throw new HelpdeskAuthError("Help Scout rejected the app ID/secret. Check them under Your Profile → My Apps.");
    this.token = data.access_token;
    return this.token;
  }
  private async get<T>(path: string, notFound?: string): Promise<T> {
    return requestJson<T>(NAME, `${BASE}${path}`, { headers: { Authorization: `Bearer ${await this.accessToken()}` } }, notFound);
  }

  async testConnection() {
    await this.get("/users/me");
  }

  async getTicket(ticketId: string): Promise<HelpdeskTicket> {
    const input = ticketId.replace(/^#/, "").trim();
    const notFound = `Conversation ${input} wasn't found in Help Scout.`;
    let c: HsConversation;
    try {
      c = await this.get<HsConversation>(`/conversations/${encodeURIComponent(input)}?embed=threads`, notFound);
    } catch (error) {
      // People often type the visible conversation number rather than the id.
      if (!(error instanceof TicketNotFoundError) || !/^\d+$/.test(input)) throw error;
      const found = await this.get<{ _embedded?: { conversations?: { id: number }[] } }>(`/conversations?status=all&query=${encodeURIComponent(`(number:${input})`)}`);
      const id = found._embedded?.conversations?.[0]?.id;
      if (!id) throw error;
      c = await this.get<HsConversation>(`/conversations/${id}?embed=threads`, notFound);
    }

    const conversation: ConversationTurn[] = (c._embedded?.threads ?? [])
      .filter((t) => t.type && SCORED_THREADS.has(t.type) && t.body)
      .sort((a, b) => Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? ""))
      .map((t) => ({
        role: t.type === "customer" || t.createdBy?.type === "customer" ? "customer" : "agent",
        author: t.createdBy?.email,
        body: htmlToText(t.body),
        created_at: t.createdAt,
        public: t.type !== "note",
      }));
    return {
      id: String(c.number ?? c.id),
      subject: c.subject ?? "",
      status: c.status ?? "",
      agentName: personName(c.assignee?.first, c.assignee?.last),
      agentEmail: c.assignee?.email ?? "",
      conversation,
    };
  }

  async listSolvedSince(since: Date, limit: number): Promise<SolvedTicket[]> {
    const out: SolvedTicket[] = [];
    for (let page = 1; out.length < limit; page++) {
      const data = await this.get<{ _embedded?: { conversations?: HsConversation[] }; page?: { totalPages?: number } }>(
        `/conversations?status=closed&modifiedSince=${encodeURIComponent(isoSeconds(since))}&sortField=modifiedAt&sortOrder=asc&page=${page}`,
      );
      // Use the internal id: it's what getTicket() resolves first.
      for (const c of data._embedded?.conversations ?? []) out.push({ id: String(c.id), tags: (c.tags ?? []).map((t) => t.tag), csat: null });
      if (page >= (data.page?.totalPages ?? 1)) break;
    }
    return out.slice(0, limit);
  }
}

export const helpScout: HelpdeskProvider<Credentials> = {
  id: "help_scout",
  name: NAME,
  ticketLabel: "Help Scout conversation ID",
  ticketPlaceholder: "1849201933",
  setupHelp: "Your Profile → My Apps → Create My App (any redirect URL). Copy the App ID and App Secret.",
  docsUrl: "https://developer.helpscout.com/mailbox-api/overview/authentication/",
  fields: [
    { key: "appId", label: "App ID", type: "text" },
    { key: "appSecret", label: "App secret", type: "password" },
  ],
  schema,
  accountLabel: () => "Help Scout",
  createClient: (c) => new HelpScoutClient(c),
  supportsTags: true,
  supportsCsat: false,
};
