import { z } from "zod";

import type { ConversationTurn } from "@/lib/qa/assessor";
import { basicAuth, requester, requestJson, requiredString, subdomainField } from "../http";
import { TicketNotFoundError, type HelpdeskClient, type HelpdeskProvider, type HelpdeskTicket, type SolvedTicket } from "../types";

const NAME = "ServiceNow";
const schema = z.object({
  instance: subdomainField("ServiceNow instance", "service-now.com"),
  username: requiredString("Enter the integration user's username"),
  password: requiredString("Enter the integration user's password"),
});
type Credentials = z.infer<typeof schema>;

type Incident = Record<string, string | undefined>;
type Journal = { value?: string; element?: string; sys_created_by?: string; sys_created_on?: string };
const INCIDENT_FIELDS = "sys_id,number,short_description,description,state,priority,sys_created_on,assigned_to.name,assigned_to.email,caller_id.user_name,caller_id.name,caller_id.email,caller_id.mobile_phone,caller_id.phone";

class ServiceNowClient implements HelpdeskClient {
  private base: string;
  private headers: Record<string, string>;
  constructor(private c: Credentials) {
    this.base = `https://${c.instance}.service-now.com/api/now`;
    this.headers = { Authorization: basicAuth(c.username, c.password) };
  }
  private get<T>(path: string) {
    return requestJson<T>(NAME, `${this.base}${path}`, { headers: this.headers });
  }
  private async findIncident(query: string): Promise<Incident | undefined> {
    const { result } = await this.get<{ result: Incident[] }>(
      `/table/incident?sysparm_query=${encodeURIComponent(query)}&sysparm_limit=1&sysparm_display_value=true&sysparm_fields=${INCIDENT_FIELDS}`,
    );
    return result[0];
  }

  async testConnection() {
    await this.get("/table/incident?sysparm_limit=1&sysparm_fields=sys_id");
  }

  async getTicket(ticketId: string): Promise<HelpdeskTicket> {
    const input = ticketId.trim().toUpperCase();
    // Encoded queries use ^ as a separator, so only allow safe characters.
    if (!/^[A-Z0-9]+$/.test(input)) throw new TicketNotFoundError(`"${ticketId}" isn't a valid incident number.`);
    const incident = (await this.findIncident(`number=${input}`)) ?? (/^[A-F0-9]{32}$/.test(input) ? await this.findIncident(`sys_id=${input.toLowerCase()}`) : undefined);
    if (!incident?.sys_id) throw new TicketNotFoundError(`Incident ${input} wasn't found in ${this.c.instance}.service-now.com.`);

    const { result: journal } = await this.get<{ result: Journal[] }>(
      `/table/sys_journal_field?sysparm_query=${encodeURIComponent(`element_id=${incident.sys_id}^elementINcomments,work_notes^ORDERBYsys_created_on`)}&sysparm_fields=value,element,sys_created_by,sys_created_on&sysparm_limit=500`,
    );
    const caller = incident["caller_id.user_name"];
    const conversation: ConversationTurn[] = [
      ...(incident.description ? [{ role: "customer" as const, author: caller, body: incident.description, created_at: incident.sys_created_on, public: true }] : []),
      ...journal.map((j) => ({
        role: j.element === "comments" && caller && j.sys_created_by === caller ? ("customer" as const) : ("agent" as const),
        author: j.sys_created_by,
        body: j.value ?? "",
        created_at: j.sys_created_on,
        public: j.element === "comments",
      })),
    ];
    return {
      id: incident.number ?? input,
      subject: incident.short_description ?? "",
      status: incident.state?.toLowerCase() ?? "",
      priority: incident.priority,
      agentName: incident["assigned_to.name"] || "Unknown",
      agentEmail: incident["assigned_to.email"] ?? "",
      conversation,
      requester: requester({
        name: incident["caller_id.name"],
        email: incident["caller_id.email"],
        phone: incident["caller_id.mobile_phone"] || incident["caller_id.phone"],
      }),
    };
  }

  async listSolvedSince(since: Date, limit: number): Promise<SolvedTicket[]> {
    const out: SolvedTicket[] = [];
    const stamp = since.toISOString().slice(0, 19).replace("T", " ");
    // 6 = Resolved, 7 = Closed.
    const query = encodeURIComponent(`stateIN6,7^sys_updated_on>${stamp}^ORDERBYsys_updated_on`);
    for (let offset = 0; out.length < limit; offset += 100) {
      const { result } = await this.get<{ result: { number: string }[] }>(`/table/incident?sysparm_query=${query}&sysparm_fields=number&sysparm_limit=100&sysparm_offset=${offset}`);
      for (const r of result) out.push({ id: r.number, tags: [], csat: null });
      if (result.length < 100) break;
    }
    return out.slice(0, limit);
  }
}

export const servicenow: HelpdeskProvider<Credentials> = {
  id: "servicenow",
  name: NAME,
  ticketLabel: "ServiceNow incident number",
  ticketPlaceholder: "INC0010023",
  setupHelp: "Create an integration user with the itil role (read access to incidents and journal entries). Basic authentication must be allowed for the REST API.",
  docsUrl: "https://docs.servicenow.com/bundle/washingtondc-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html",
  fields: [
    { key: "instance", label: "Instance", type: "text", placeholder: "acme (from acme.service-now.com)" },
    { key: "username", label: "Username", type: "text" },
    { key: "password", label: "Password", type: "password" },
  ],
  schema,
  accountLabel: (c) => `${c.instance}.service-now.com`,
  createClient: (c) => new ServiceNowClient(c),
  supportsTags: false,
  supportsCsat: false,
};
