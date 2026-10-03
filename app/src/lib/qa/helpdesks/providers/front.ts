import { z } from "zod";

import type { ConversationTurn } from "@/lib/qa/assessor";
import { htmlToText, personName, requestJson, requiredString, unix } from "../http";
import type { HelpdeskClient, HelpdeskProvider, HelpdeskTicket, SolvedTicket } from "../types";

const NAME = "Front";
const BASE = "https://api2.frontapp.com";
const schema = z.object({ apiToken: requiredString("Enter a Front API token") });
type Credentials = z.infer<typeof schema>;

type FTeammate = { first_name?: string; last_name?: string; email?: string } | null;
type FConversation = { id: string; subject?: string; status?: string; assignee?: FTeammate; tags?: { name: string }[] };
type FMessage = { is_inbound?: boolean; text?: string | null; body?: string | null; author?: FTeammate; created_at?: number; recipients?: { handle?: string; role?: string }[] };
type FComment = { body?: string; author?: FTeammate; posted_at?: number };

class FrontClient implements HelpdeskClient {
  private headers: Record<string, string>;
  constructor(c: Credentials) {
    this.headers = { Authorization: `Bearer ${c.apiToken}` };
  }
  private get<T>(pathOrUrl: string, notFound?: string) {
    return requestJson<T>(NAME, pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE}${pathOrUrl}`, { headers: this.headers }, notFound);
  }

  async testConnection() {
    await this.get("/me");
  }

  async getTicket(ticketId: string): Promise<HelpdeskTicket> {
    const id = encodeURIComponent(ticketId.trim());
    const notFound = `Conversation ${ticketId} wasn't found in Front.`;
    const c = await this.get<FConversation>(`/conversations/${id}`, notFound);
    const [messages, comments] = await Promise.all([
      this.get<{ _results: FMessage[] }>(`/conversations/${id}/messages?limit=100`, notFound),
      this.get<{ _results: FComment[] }>(`/conversations/${id}/comments`, notFound),
    ]);
    const conversation: ConversationTurn[] = [
      ...messages._results.map((m) => ({
        role: m.is_inbound ? ("customer" as const) : ("agent" as const),
        author: m.author?.email ?? m.recipients?.find((r) => r.role === "from")?.handle,
        body: m.text || htmlToText(m.body),
        created_at: m.created_at ? new Date(m.created_at * 1000).toISOString() : undefined,
        public: true,
      })),
      ...comments._results.map((cm) => ({
        role: "agent" as const,
        author: cm.author?.email,
        body: cm.body ?? "",
        created_at: cm.posted_at ? new Date(cm.posted_at * 1000).toISOString() : undefined,
        public: false,
      })),
    ].sort((a, b) => Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? ""));
    return {
      id: c.id,
      subject: c.subject ?? "",
      status: c.status === "archived" ? "closed" : (c.status ?? ""),
      agentName: personName(c.assignee?.first_name, c.assignee?.last_name),
      agentEmail: c.assignee?.email ?? "",
      conversation,
    };
  }

  async listSolvedSince(since: Date, limit: number): Promise<SolvedTicket[]> {
    const out: SolvedTicket[] = [];
    let next: string | null = `/conversations/search/${encodeURIComponent(`is:archived after:${unix(since)}`)}?limit=100`;
    while (next && out.length < limit) {
      const page: { _results: FConversation[]; _pagination?: { next?: string | null } } = await this.get(next);
      for (const c of page._results) out.push({ id: c.id, tags: (c.tags ?? []).map((t) => t.name), csat: null });
      next = page._pagination?.next ?? null;
    }
    return out.slice(0, limit);
  }
}

export const front: HelpdeskProvider<Credentials> = {
  id: "front",
  name: NAME,
  ticketLabel: "Front conversation ID",
  ticketPlaceholder: "cnv_55c8c149",
  setupHelp: "Settings → Developers → API tokens → create a token with read access to shared resources.",
  docsUrl: "https://dev.frontapp.com/docs/create-and-revoke-api-tokens",
  fields: [{ key: "apiToken", label: "API token", type: "password" }],
  schema,
  accountLabel: () => "Front",
  createClient: (c) => new FrontClient(c),
  supportsTags: true,
  supportsCsat: false,
};
