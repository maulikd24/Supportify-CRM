import type { ConversationTurn } from "@/lib/qa/assessor";

/**
 * Ported from qa-tool-reference/app/zendesk_client.py. Unlike the original
 * (which read one global ZENDESK_* env var set), this takes per-organization
 * credentials — each Supportify customer connects their own Zendesk account.
 */

export class ZendeskAuthError extends Error {}

export type ZendeskCredentials = {
  subdomain: string;
  email: string;
  apiToken: string;
};

export type ZendeskTicketWithConversation = {
  ticket: Record<string, unknown>;
  conversation: ConversationTurn[];
  agentName: string;
  agentEmail: string;
};

export class ZendeskClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(credentials: ZendeskCredentials) {
    this.baseUrl = `https://${credentials.subdomain}.zendesk.com/api/v2`;
    const token = Buffer.from(`${credentials.email}/token:${credentials.apiToken}`).toString("base64");
    this.headers = {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json",
    };
  }

  private async handleResponseError(resp: Response, subdomain: string): Promise<void> {
    if (resp.status === 401) {
      throw new ZendeskAuthError(
        "Zendesk returned 401 Unauthorized. Check that the connected email and API token are correct. " +
          `The token must be an API token (not a password) — generate one at ` +
          `https://${subdomain}.zendesk.com/admin/apps-integrations/apis/zendesk-api.`,
      );
    }
    if (resp.status === 403) {
      throw new ZendeskAuthError(
        "Zendesk returned 403 Forbidden. The API token is valid but lacks permission for this resource. " +
          "Ensure the agent account has the required role in Zendesk Admin.",
      );
    }
    if (resp.status === 404) {
      throw new Error(`Ticket not found (404). Verify the ticket ID exists in your Zendesk account (${subdomain}.zendesk.com).`);
    }
    if (!resp.ok) {
      throw new Error(`Zendesk request failed with status ${resp.status}`);
    }
  }

  private subdomainFromBaseUrl(): string {
    return new URL(this.baseUrl).hostname.split(".")[0];
  }

  async getTicket(ticketId: string): Promise<Record<string, unknown>> {
    let resp: Response;
    try {
      resp = await fetch(`${this.baseUrl}/tickets/${ticketId}.json`, { headers: this.headers });
    } catch (e) {
      throw new ZendeskAuthError(
        `Could not reach Zendesk at '${this.subdomainFromBaseUrl()}.zendesk.com'. ` +
          `Check that the subdomain is correct. (Detail: ${e})`,
      );
    }
    await this.handleResponseError(resp, this.subdomainFromBaseUrl());
    const data = (await resp.json()) as { ticket: Record<string, unknown> };
    return data.ticket;
  }

  async getTicketComments(ticketId: string): Promise<Record<string, unknown>[]> {
    let resp: Response;
    try {
      resp = await fetch(`${this.baseUrl}/tickets/${ticketId}/comments.json`, { headers: this.headers });
    } catch (e) {
      throw new ZendeskAuthError(`Could not reach Zendesk. Check the connected subdomain. (Detail: ${e})`);
    }
    await this.handleResponseError(resp, this.subdomainFromBaseUrl());
    const data = (await resp.json()) as { comments: Record<string, unknown>[] };
    return data.comments;
  }

  async getTicketWithConversation(ticketId: string): Promise<ZendeskTicketWithConversation> {
    const ticket = await this.getTicket(ticketId);
    const comments = await this.getTicketComments(ticketId);

    const conversation: ConversationTurn[] = [];
    for (const c of comments) {
      let role: "customer" | "agent" =
        c.public && c.author_id === ticket.requester_id ? "customer" : "agent";
      if (conversation.length === 0) role = "customer";
      conversation.push({
        role,
        author: c.author_id as string | number | undefined,
        body: (c.plain_body as string) || (c.body as string) || "",
        created_at: c.created_at as string | undefined,
        public: (c.public as boolean) ?? true,
      });
    }

    const agentId = ticket.assignee_id as number | undefined;
    let agentName = "Unknown";
    let agentEmail = "";

    if (agentId) {
      try {
        const resp = await fetch(`${this.baseUrl}/users/${agentId}.json`, { headers: this.headers });
        if (resp.ok) {
          const data = (await resp.json()) as { user: { name?: string; email?: string } };
          agentName = data.user.name ?? "Unknown";
          agentEmail = data.user.email ?? "";
        }
      } catch {
        // Agent lookup is best-effort.
      }
    }

    return { ticket, conversation, agentName, agentEmail };
  }

  async searchTickets(query: string, perPage = 25): Promise<Record<string, unknown>[]> {
    const url = new URL(`${this.baseUrl}/search.json`);
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", String(perPage));
    const resp = await fetch(url, { headers: this.headers });
    await this.handleResponseError(resp, this.subdomainFromBaseUrl());
    const data = (await resp.json()) as { results?: Record<string, unknown>[] };
    return data.results ?? [];
  }

  /** Lightweight connectivity check used when a customer connects/tests their Zendesk credentials. */
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/users/me.json`, { headers: this.headers });
      if (resp.ok) return { ok: true };
      await this.handleResponseError(resp, this.subdomainFromBaseUrl());
      return { ok: false, error: `Unexpected status ${resp.status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
