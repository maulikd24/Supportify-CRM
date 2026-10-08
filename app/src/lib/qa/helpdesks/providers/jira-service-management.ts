import { z } from "zod";

import type { ConversationTurn } from "@/lib/qa/assessor";
import { basicAuth, htmlToText, requester, requestJson, requiredString, subdomainField } from "../http";
import { TicketNotFoundError, type HelpdeskClient, type HelpdeskProvider, type HelpdeskTicket, type SolvedTicket } from "../types";

const NAME = "Jira Service Management";
const schema = z.object({
  site: subdomainField("Atlassian site", "atlassian.net"),
  email: z.string().trim().email("Enter the Atlassian account email"),
  apiToken: requiredString("Enter an Atlassian API token"),
  projectKey: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/, "Project keys look like SUP or HELPDESK").optional()),
});
type Credentials = z.infer<typeof schema>;

type JUser = { accountId?: string; displayName?: string; emailAddress?: string } | null;
type JIssue = {
  key: string;
  fields: { summary?: string; status?: { name?: string }; priority?: { name?: string } | null; assignee?: JUser; reporter?: JUser; labels?: string[]; created?: string };
  renderedFields?: { description?: string | null };
};
type JComment = { author?: JUser; renderedBody?: string; jsdPublic?: boolean; created?: string };

class JiraServiceManagementClient implements HelpdeskClient {
  private base: string;
  private headers: Record<string, string>;
  constructor(private c: Credentials) {
    this.base = `https://${c.site}.atlassian.net/rest/api/3`;
    this.headers = { Authorization: basicAuth(c.email, c.apiToken), "Content-Type": "application/json" };
  }
  private req<T>(path: string, init: RequestInit = {}, notFound?: string) {
    return requestJson<T>(NAME, `${this.base}${path}`, { ...init, headers: this.headers }, notFound);
  }

  async testConnection() {
    await this.req("/myself");
  }

  async getTicket(ticketId: string): Promise<HelpdeskTicket> {
    const key = ticketId.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(key)) throw new TicketNotFoundError(`"${ticketId}" isn't an issue key like SUP-123.`);
    const notFound = `Issue ${key} wasn't found in ${this.c.site}.atlassian.net.`;
    const issue = await this.req<JIssue>(`/issue/${key}?fields=summary,status,priority,assignee,reporter,labels,created&expand=renderedFields`, {}, notFound);
    const { comments } = await this.req<{ comments: JComment[] }>(`/issue/${key}/comment?expand=renderedBody&orderBy=created&maxResults=100`, {}, notFound);
    const reporter = issue.fields.reporter?.accountId;
    const description = htmlToText(issue.renderedFields?.description);
    const conversation: ConversationTurn[] = [
      ...(description ? [{ role: "customer" as const, author: issue.fields.reporter?.displayName, body: description, created_at: issue.fields.created, public: true }] : []),
      ...comments.map((c) => ({
        role: c.author?.accountId && c.author.accountId === reporter ? ("customer" as const) : ("agent" as const),
        author: c.author?.displayName,
        body: htmlToText(c.renderedBody),
        created_at: c.created,
        public: c.jsdPublic !== false,
      })),
    ];
    return {
      id: issue.key,
      subject: issue.fields.summary ?? "",
      status: issue.fields.status?.name?.toLowerCase() ?? "",
      priority: issue.fields.priority?.name?.toLowerCase(),
      agentName: issue.fields.assignee?.displayName ?? "Unknown",
      // Atlassian hides emails unless the user allows it; the portal can map agents by name later.
      agentEmail: issue.fields.assignee?.emailAddress ?? "",
      conversation,
      // Jira only exposes the reporter's email when their privacy settings allow it.
      requester: issue.fields.reporter ? requester({ name: issue.fields.reporter.displayName, email: issue.fields.reporter.emailAddress }) : undefined,
    };
  }

  async listSolvedSince(since: Date, limit: number): Promise<SolvedTicket[]> {
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${since.getUTCFullYear()}/${pad(since.getUTCMonth() + 1)}/${pad(since.getUTCDate())} ${pad(since.getUTCHours())}:${pad(since.getUTCMinutes())}`;
    const jql = `${this.c.projectKey ? `project = "${this.c.projectKey}" AND ` : ""}statusCategory = Done AND updated > "${stamp}" ORDER BY updated ASC`;
    const out: SolvedTicket[] = [];
    let nextPageToken: string | undefined;
    do {
      const page: { issues: JIssue[]; nextPageToken?: string } = await this.req("/search/jql", {
        method: "POST",
        body: JSON.stringify({ jql, fields: ["labels"], maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) }),
      });
      for (const i of page.issues) out.push({ id: i.key, tags: i.fields.labels ?? [], csat: null });
      nextPageToken = page.nextPageToken;
    } while (nextPageToken && out.length < limit);
    return out.slice(0, limit);
  }
}

export const jiraServiceManagement: HelpdeskProvider<Credentials> = {
  id: "jira_service_management",
  name: NAME,
  ticketLabel: "Jira issue key",
  ticketPlaceholder: "SUP-123",
  setupHelp: "id.atlassian.com → Security → API tokens. Use an agent account on the service project. Optionally limit auto-review to one project.",
  docsUrl: "https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/",
  fields: [
    { key: "site", label: "Site", type: "text", placeholder: "acme (from acme.atlassian.net)" },
    { key: "email", label: "Account email", type: "email" },
    { key: "apiToken", label: "API token", type: "password" },
    { key: "projectKey", label: "Service project key", type: "text", placeholder: "SUP", optional: true, help: "Leave empty to include every project." },
  ],
  schema,
  accountLabel: (c) => `${c.site}.atlassian.net${c.projectKey ? ` · ${c.projectKey}` : ""}`,
  createClient: (c) => new JiraServiceManagementClient(c),
  supportsTags: true,
  supportsCsat: false,
};
