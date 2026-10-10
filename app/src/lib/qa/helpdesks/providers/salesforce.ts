import { z } from "zod";

import type { ConversationTurn } from "@/lib/qa/assessor";
import { htmlToText, isoSeconds, requester, requestJson, requiredString } from "../http";
import { HelpdeskAuthError, TicketNotFoundError, type HelpdeskClient, type HelpdeskProvider, type HelpdeskTicket, type SolvedTicket } from "../types";

const NAME = "Salesforce";
const API = "v60.0";
const schema = z.object({
  instanceUrl: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => `https://${v.replace(/^https?:\/\//, "").split("/")[0]}`)
    .pipe(z.string().regex(/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(my\.)?salesforce\.com$/, "Enter your My Domain URL, e.g. https://acme.my.salesforce.com")),
  clientId: requiredString("Enter the connected app's consumer key"),
  clientSecret: requiredString("Enter the connected app's consumer secret"),
});
type Credentials = z.infer<typeof schema>;

type Case = {
  Id: string;
  CaseNumber: string;
  Subject?: string;
  Description?: string;
  Status?: string;
  Priority?: string;
  CreatedDate?: string;
  Owner?: { Name?: string; Email?: string } | null;
  Contact?: { Name?: string } | null;
  ContactEmail?: string | null;
  ContactMobile?: string | null;
  ContactPhone?: string | null;
  SuppliedName?: string | null;
  SuppliedEmail?: string | null;
  SuppliedPhone?: string | null;
};
type Email = { TextBody?: string; HtmlBody?: string; Incoming?: boolean; FromAddress?: string; MessageDate?: string };
type Comment = { CommentBody?: string; IsPublished?: boolean; CreatedDate?: string; CreatedBy?: { Name?: string } };

const soqlString = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

class SalesforceClient implements HelpdeskClient {
  private token: string | null = null;
  constructor(private c: Credentials) {}

  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: this.c.clientId, client_secret: this.c.clientSecret });
    let resp: Response;
    try {
      resp = await fetch(`${this.c.instanceUrl}/services/oauth2/token`, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    } catch (error) {
      throw new Error(`Couldn't reach Salesforce at ${this.c.instanceUrl}. (${error instanceof Error ? error.message : String(error)})`);
    }
    const data = (await resp.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
    if (!resp.ok || !data.access_token) {
      throw new HelpdeskAuthError(`Salesforce rejected the connected app credentials${data.error_description ? `: ${data.error_description}` : ""}. Check the client credentials flow is enabled with a run-as user.`);
    }
    this.token = data.access_token;
    return this.token;
  }
  private async query<T>(soql: string): Promise<T[]> {
    const token = await this.accessToken();
    const records: T[] = [];
    let path: string | null = `/services/data/${API}/query?q=${encodeURIComponent(soql)}`;
    while (path && records.length < 2000) {
      const page: { records: T[]; nextRecordsUrl?: string } = await requestJson(NAME, `${this.c.instanceUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      records.push(...page.records);
      path = page.nextRecordsUrl ?? null;
    }
    return records;
  }

  async testConnection() {
    await this.query("SELECT Id FROM Case LIMIT 1");
  }

  async getTicket(ticketId: string): Promise<HelpdeskTicket> {
    const input = ticketId.trim();
    const fields = "Id, CaseNumber, Subject, Description, Status, Priority, CreatedDate, Owner.Name, Owner.Email, Contact.Name, ContactEmail, ContactMobile, ContactPhone, SuppliedName, SuppliedEmail, SuppliedPhone";
    const where = /^500[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/.test(input)
      ? `Id = ${soqlString(input)}`
      : `CaseNumber IN (${soqlString(input)}, ${soqlString(input.replace(/^0+/, "").padStart(8, "0"))})`;
    const [kase] = await this.query<Case>(`SELECT ${fields} FROM Case WHERE ${where} LIMIT 1`);
    if (!kase) throw new TicketNotFoundError(`Case ${input} wasn't found in Salesforce.`);

    const [emails, comments] = await Promise.all([
      this.query<Email>(`SELECT TextBody, HtmlBody, Incoming, FromAddress, MessageDate FROM EmailMessage WHERE ParentId = ${soqlString(kase.Id)} ORDER BY MessageDate ASC`),
      this.query<Comment>(`SELECT CommentBody, IsPublished, CreatedDate, CreatedBy.Name FROM CaseComment WHERE ParentId = ${soqlString(kase.Id)} ORDER BY CreatedDate ASC`),
    ]);
    const turns = [
      ...emails.map((e) => ({ role: e.Incoming ? ("customer" as const) : ("agent" as const), author: e.FromAddress, body: e.TextBody || htmlToText(e.HtmlBody), created_at: e.MessageDate, public: true })),
      ...comments.map((c) => ({ role: "agent" as const, author: c.CreatedBy?.Name, body: c.CommentBody ?? "", created_at: c.CreatedDate, public: Boolean(c.IsPublished) })),
    ].sort((a, b) => Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? ""));
    const conversation: ConversationTurn[] = emails.length === 0 && kase.Description ? [{ role: "customer", body: kase.Description, created_at: kase.CreatedDate, public: true }, ...turns] : turns;

    return {
      id: kase.CaseNumber,
      subject: kase.Subject ?? "",
      status: kase.Status ?? "",
      priority: kase.Priority?.toLowerCase(),
      agentName: kase.Owner?.Name ?? "Unknown",
      agentEmail: kase.Owner?.Email ?? "",
      conversation,
      // The linked Contact when there is one, else what a web-to-case/email-to-case sender supplied.
      requester: requester({
        name: kase.Contact?.Name ?? kase.SuppliedName,
        email: kase.ContactEmail || kase.SuppliedEmail,
        phone: kase.ContactMobile || kase.ContactPhone || kase.SuppliedPhone,
      }),
    };
  }

  async listSolvedSince(since: Date, limit: number): Promise<SolvedTicket[]> {
    const rows = await this.query<{ CaseNumber: string; LastModifiedDate?: string }>(
      `SELECT CaseNumber, LastModifiedDate FROM Case WHERE IsClosed = true AND LastModifiedDate > ${isoSeconds(since)} ORDER BY LastModifiedDate ASC LIMIT ${Math.min(limit, 2000)}`,
    );
    return rows.map((r) => ({ id: r.CaseNumber, tags: [], csat: null, updatedAt: r.LastModifiedDate }));
  }
}

export const salesforce: HelpdeskProvider<Credentials> = {
  id: "salesforce",
  name: "Salesforce Service Cloud",
  ticketLabel: "Salesforce case number",
  ticketPlaceholder: "00001026",
  setupHelp: "Setup → App Manager → new connected app with OAuth, the api scope, and \"Enable Client Credentials Flow\" with a run-as user who can read Cases.",
  docsUrl: "https://help.salesforce.com/s/articleView?id=sf.connected_app_client_credentials_setup.htm",
  fields: [
    { key: "instanceUrl", label: "My Domain URL", type: "text", placeholder: "https://acme.my.salesforce.com" },
    { key: "clientId", label: "Consumer key", type: "text" },
    { key: "clientSecret", label: "Consumer secret", type: "password" },
  ],
  schema,
  accountLabel: (c) => c.instanceUrl.replace(/^https:\/\//, ""),
  createClient: (c) => new SalesforceClient(c),
  supportsTags: false,
  supportsCsat: false,
  listsOldestFirst: true,
};
