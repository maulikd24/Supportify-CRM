import { z } from "zod";

import type { ConversationTurn } from "@/lib/qa/assessor";
import { htmlToText, personName, requester, requestJson, requiredString } from "../http";
import type { HelpdeskClient, HelpdeskProvider, HelpdeskTicket, SolvedTicket, TicketRequester } from "../types";

const NAME = "HubSpot";
const BASE = "https://api.hubapi.com";
const schema = z.object({ accessToken: requiredString("Enter a HubSpot private app access token") });
type Credentials = z.infer<typeof schema>;

type HsObject = { id: string; properties: Record<string, string | null>; associations?: Record<string, { results?: { id: string }[] }> };

class HubSpotClient implements HelpdeskClient {
  private headers: Record<string, string>;
  constructor(c: Credentials) {
    this.headers = { Authorization: `Bearer ${c.accessToken}`, "Content-Type": "application/json" };
  }
  private req<T>(path: string, init: RequestInit = {}, notFound?: string) {
    return requestJson<T>(NAME, `${BASE}${path}`, { ...init, headers: this.headers }, notFound);
  }
  private async batchRead(objectType: "emails" | "notes" | "contacts", ids: string[], properties: string[]): Promise<HsObject[]> {
    if (ids.length === 0) return [];
    const { results } = await this.req<{ results: HsObject[] }>(`/crm/v3/objects/${objectType}/batch/read`, {
      method: "POST",
      body: JSON.stringify({ properties, inputs: ids.slice(0, 100).map((id) => ({ id })) }),
    });
    return results;
  }

  async testConnection() {
    await this.req("/crm/v3/objects/tickets?limit=1");
  }

  async getTicket(ticketId: string): Promise<HelpdeskTicket> {
    const ticket = await this.req<HsObject>(
      `/crm/v3/objects/tickets/${encodeURIComponent(ticketId)}?properties=subject,content,hs_ticket_priority,hubspot_owner_id,closed_date,createdate&associations=emails,notes,contacts`,
      {},
      `Ticket ${ticketId} wasn't found in HubSpot.`,
    );
    const p = ticket.properties;
    const emailIds = (ticket.associations?.emails?.results ?? []).map((r) => r.id);
    const noteIds = (ticket.associations?.notes?.results ?? []).map((r) => r.id);
    const [emails, notes] = await Promise.all([
      this.batchRead("emails", emailIds, ["hs_email_text", "hs_email_html", "hs_email_direction", "hs_timestamp", "hs_email_from_email"]),
      this.batchRead("notes", noteIds, ["hs_note_body", "hs_timestamp"]),
    ]);

    const turns: (ConversationTurn & { at: number })[] = [
      ...emails.map((e) => ({
        role: e.properties.hs_email_direction === "INCOMING_EMAIL" ? ("customer" as const) : ("agent" as const),
        author: e.properties.hs_email_from_email ?? undefined,
        body: e.properties.hs_email_text || htmlToText(e.properties.hs_email_html),
        created_at: e.properties.hs_timestamp ?? undefined,
        public: true,
        at: Date.parse(e.properties.hs_timestamp ?? "") || 0,
      })),
      ...notes.map((n) => ({
        role: "agent" as const,
        body: htmlToText(n.properties.hs_note_body),
        created_at: n.properties.hs_timestamp ?? undefined,
        public: false,
        at: Date.parse(n.properties.hs_timestamp ?? "") || 0,
      })),
    ].sort((a, b) => a.at - b.at);
    const conversation: ConversationTurn[] = turns.map((t) => ({ role: t.role, author: t.author, body: t.body, created_at: t.created_at, public: t.public }));
    if (emails.length === 0 && p.content) conversation.unshift({ role: "customer", body: p.content, created_at: p.createdate ?? undefined, public: true });

    let agentName = "Unknown";
    let agentEmail = "";
    if (p.hubspot_owner_id) {
      try {
        const owner = await this.req<{ firstName?: string; lastName?: string; email?: string }>(`/crm/v3/owners/${p.hubspot_owner_id}`);
        agentName = personName(owner.firstName, owner.lastName, agentName);
        agentEmail = owner.email ?? "";
      } catch {
        // best-effort
      }
    }
    let customer: TicketRequester | undefined;
    const contactId = ticket.associations?.contacts?.results?.[0]?.id;
    if (contactId) {
      try {
        const [contact] = await this.batchRead("contacts", [contactId], ["email", "phone", "mobilephone", "firstname", "lastname"]);
        const cp = contact?.properties ?? {};
        customer = requester({ name: personName(cp.firstname ?? undefined, cp.lastname ?? undefined, ""), email: cp.email, phone: cp.mobilephone || cp.phone });
      } catch {
        // best-effort
      }
    }
    return { id: ticket.id, subject: p.subject ?? "", status: p.closed_date ? "closed" : "open", priority: p.hs_ticket_priority?.toLowerCase(), agentName, agentEmail, conversation, requester: customer };
  }

  async listSolvedSince(since: Date, limit: number): Promise<SolvedTicket[]> {
    const out: SolvedTicket[] = [];
    let after: string | undefined;
    do {
      const page: { results: HsObject[]; paging?: { next?: { after?: string } } } = await this.req("/crm/v3/objects/tickets/search", {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: "closed_date", operator: "GT", value: String(since.getTime()) }] }],
          sorts: [{ propertyName: "closed_date", direction: "ASCENDING" }],
          properties: ["subject"],
          limit: 100,
          ...(after ? { after } : {}),
        }),
      });
      for (const t of page.results) out.push({ id: t.id, tags: [], csat: null });
      after = page.paging?.next?.after;
    } while (after && out.length < limit);
    return out.slice(0, limit);
  }
}

export const hubspot: HelpdeskProvider<Credentials> = {
  id: "hubspot",
  name: "HubSpot Service Hub",
  ticketLabel: "HubSpot ticket ID",
  ticketPlaceholder: "4821937465",
  setupHelp: "Settings → Integrations → Private apps → create an app with the tickets, emails, notes (crm.objects) and owners read scopes.",
  docsUrl: "https://developers.hubspot.com/docs/api/private-apps",
  fields: [{ key: "accessToken", label: "Private app access token", type: "password", placeholder: "pat-na1-…" }],
  schema,
  accountLabel: () => "HubSpot",
  createClient: (c) => new HubSpotClient(c),
  supportsTags: false,
  supportsCsat: false,
};
