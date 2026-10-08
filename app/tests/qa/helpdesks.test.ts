import { afterEach, describe, expect, it, vi } from "vitest";

import { getHelpdeskProvider, HELPDESK_PROVIDERS, HelpdeskAuthError, TicketNotFoundError } from "@/lib/qa/helpdesks";
import { htmlToText } from "@/lib/qa/helpdesks/http";

type Handler = [RegExp, (url: string, init: RequestInit) => unknown];
const calls: { url: string; init: RequestInit }[] = [];

/** Stubs fetch: the first matching pattern answers (a number means "respond with that status"). */
function route(...handlers: Handler[]) {
  calls.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const match = handlers.find(([re]) => re.test(url));
    if (!match) return new Response(`no route for ${url}`, { status: 599 });
    const body = match[1](url, init);
    if (typeof body === "number") return new Response(null, { status: body });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
}
afterEach(() => vi.unstubAllGlobals());

function client(id: string, credentials: Record<string, string>) {
  const provider = getHelpdeskProvider(id);
  return provider.createClient(provider.schema.parse(credentials));
}
const roles = (t: { conversation: { role: string }[] }) => t.conversation.map((c) => c.role).join(",");
const since = new Date("2026-10-01T00:00:00Z");

describe("helpdesk registry", () => {
  it("offers the top helpdesks", () => {
    expect(HELPDESK_PROVIDERS.map((p) => p.id)).toEqual([
      "zendesk", "freshdesk", "intercom", "hubspot", "salesforce", "zoho_desk", "help_scout", "gorgias", "front", "servicenow", "jira_service_management",
    ]);
  });

  it("normalises account addresses and refuses anything outside the vendor's domain", () => {
    const zd = getHelpdeskProvider("zendesk").schema;
    expect(zd.parse({ subdomain: "https://Acme.zendesk.com/agent", email: "a@b.co", apiToken: "t" })).toMatchObject({ subdomain: "acme" });
    expect(() => zd.parse({ subdomain: "evil.com/x?", email: "a@b.co", apiToken: "t" })).toThrow();
    const sf = getHelpdeskProvider("salesforce").schema;
    expect(sf.parse({ instanceUrl: "acme.my.salesforce.com/lightning", clientId: "a", clientSecret: "b" })).toMatchObject({ instanceUrl: "https://acme.my.salesforce.com" });
    expect(() => sf.parse({ instanceUrl: "https://salesforce.com.evil.io", clientId: "a", clientSecret: "b" })).toThrow();
    expect(() => getHelpdeskProvider("jira_service_management").schema.parse({ site: "acme", email: "a@b.co", apiToken: "t", projectKey: "x y" })).toThrow();
  });

  it("strips HTML to readable text", () => {
    expect(htmlToText("<p>Hi &amp; welcome</p><p>Line<br>two</p><script>x()</script>")).toBe("Hi & welcome\nLine\ntwo");
  });
});

describe("Zendesk", () => {
  const zd = () => client("zendesk", { subdomain: "acme", email: "qa@acme.com", apiToken: "tok" });
  it("reads a ticket with its agent and conversation", async () => {
    route(
      [/\/tickets\/7\.json/, () => ({ ticket: { id: 7, subject: "Refund", status: "solved", requester_id: 1, assignee_id: 9 } })],
      [/\/tickets\/7\/comments\.json/, () => ({ comments: [{ author_id: 1, public: true, plain_body: "Hi" }, { author_id: 9, public: true, plain_body: "Done" }] })],
      [/\/users\/9\.json/, () => ({ user: { name: "Sam", email: "sam@acme.com" } })],
    );
    const t = await zd().getTicket("7");
    expect([t.id, t.subject, t.agentEmail, roles(t)]).toEqual(["7", "Refund", "sam@acme.com", "customer,agent"]);
    expect(calls[0].init.headers).toMatchObject({ Authorization: `Basic ${Buffer.from("qa@acme.com/token:tok").toString("base64")}` });
  });
  it("lists solved tickets with tags and CSAT, and maps 401 to an auth error", async () => {
    route([/search\.json/, () => ({ results: [{ id: 1, status: "solved", tags: ["vip"], satisfaction_rating: { score: "bad" } }, { id: 2, status: "open" }], next_page: null })]);
    expect(await zd().listSolvedSince(since, 10)).toEqual([{ id: "1", tags: ["vip"], csat: "bad" }]);
    route([/users\/me/, () => 401]);
    await expect(zd().testConnection()).rejects.toBeInstanceOf(HelpdeskAuthError);
  });
});

describe("Freshdesk", () => {
  const fd = () => client("freshdesk", { domain: "acme.freshdesk.com", apiKey: "key" });
  it("reads a ticket: description first, then conversations, with agent contact", async () => {
    route(
      [/\/tickets\/5\/conversations/, () => [{ body_text: "Sorted!", incoming: false, private: false }, { body_text: "Thanks", incoming: true }]],
      [/\/tickets\/5$/, () => ({ id: 5, subject: "Broken", status: 4, priority: 3, responder_id: 3, description_text: "It's broken" })],
      [/\/agents\/3/, () => ({ contact: { name: "Ana", email: "ana@acme.com" } })],
    );
    const t = await fd().getTicket("5");
    expect([t.status, t.priority, t.agentEmail, roles(t)]).toEqual(["resolved", "high", "ana@acme.com", "customer,agent,customer"]);
    expect(calls[0].url.startsWith("https://acme.freshdesk.com/api/v2/")).toBe(true);
  });
  it("lists only resolved/closed tickets", async () => {
    route([/\/tickets\?/, () => [{ id: 1, status: 4, tags: ["a"] }, { id: 2, status: 2 }, { id: 3, status: 5 }]]);
    expect((await fd().listSolvedSince(since, 10)).map((t) => t.id)).toEqual(["1", "3"]);
  });
});

describe("Intercom", () => {
  const ic = () => client("intercom", { accessToken: "tok", region: "eu" });
  it("reads a conversation, keeps comments/notes and credits the assignee", async () => {
    route(
      [/\/conversations\/123/, () => ({
        id: "123", title: "Login issue", state: "closed", admin_assignee_id: 42,
        source: { body: "<p>Can't log in</p>", author: { type: "user" } },
        conversation_parts: { conversation_parts: [
          { part_type: "assignment", body: null, author: { type: "bot" } },
          { part_type: "comment", body: "Try resetting", author: { type: "admin" } },
          { part_type: "note", body: "Known bug", author: { type: "admin" } },
        ] },
      })],
      [/\/admins\/42/, () => ({ name: "Ola", email: "ola@acme.com" })],
    );
    const t = await ic().getTicket("123");
    expect([t.subject, t.agentEmail, roles(t), t.conversation[0].body, t.conversation[2].public]).toEqual(["Login issue", "ola@acme.com", "customer,agent,agent", "Can't log in", false]);
    expect(calls[0].url.startsWith("https://api.eu.intercom.io/")).toBe(true);
  });
  it("searches closed conversations and maps ratings to CSAT", async () => {
    route([/conversations\/search/, () => ({ conversations: [{ id: "1", tags: { tags: [{ name: "vip" }] }, conversation_rating: { rating: 1 } }, { id: "2", conversation_rating: { rating: 5 } }], pages: {} })]);
    expect(await ic().listSolvedSince(since, 10)).toEqual([{ id: "1", tags: ["vip"], csat: "bad" }, { id: "2", tags: [], csat: "good" }]);
    expect(JSON.parse(String(calls[0].init.body)).query.value[1]).toEqual({ field: "updated_at", operator: ">", value: since.getTime() / 1000 });
  });
});

describe("HubSpot", () => {
  it("reads a ticket from its emails, notes and owner", async () => {
    route(
      [/objects\/tickets\/77/, () => ({ id: "77", properties: { subject: "Invoice", hubspot_owner_id: "5", closed_date: "2026-10-02" }, associations: { emails: { results: [{ id: "e1" }, { id: "e2" }] }, notes: { results: [{ id: "n1" }] } } })],
      [/emails\/batch\/read/, () => ({ results: [
        { id: "e2", properties: { hs_email_text: "Fixed it", hs_email_direction: "EMAIL", hs_timestamp: "2026-10-01T11:00:00Z" } },
        { id: "e1", properties: { hs_email_text: "Wrong invoice", hs_email_direction: "INCOMING_EMAIL", hs_timestamp: "2026-10-01T10:00:00Z" } },
      ] })],
      [/notes\/batch\/read/, () => ({ results: [{ id: "n1", properties: { hs_note_body: "<p>Refunded</p>", hs_timestamp: "2026-10-01T10:30:00Z" } }] })],
      [/owners\/5/, () => ({ firstName: "Kim", lastName: "Lee", email: "kim@acme.com" })],
    );
    const t = await client("hubspot", { accessToken: "pat" }).getTicket("77");
    expect([t.status, t.agentName, roles(t), t.conversation[1].body]).toEqual(["closed", "Kim Lee", "customer,agent,agent", "Refunded"]);
  });
});

describe("Salesforce", () => {
  const sf = () => client("salesforce", { instanceUrl: "https://acme.my.salesforce.com", clientId: "id", clientSecret: "secret" });
  it("gets a token, looks the case up by number and merges emails and comments", async () => {
    route(
      [/oauth2\/token/, () => ({ access_token: "at" })],
      [/query\?q=SELECT\+?.*FROM(\+|%20)Case(\+|%20)WHERE/i, () => ({ records: [{ Id: "500000000000001AAA", CaseNumber: "00001026", Subject: "Late", Status: "Closed", Owner: { Name: "Raj", Email: "raj@acme.com" } }] })],
      [/EmailMessage/, () => ({ records: [{ TextBody: "Where is it?", Incoming: true, MessageDate: "2026-10-01T10:00:00Z" }, { TextBody: "On its way", Incoming: false, MessageDate: "2026-10-01T12:00:00Z" }] })],
      [/CaseComment/, () => ({ records: [{ CommentBody: "Checked courier", IsPublished: false, CreatedDate: "2026-10-01T11:00:00Z" }] })],
    );
    const t = await sf().getTicket("1026");
    expect([t.id, t.agentEmail, roles(t), t.conversation[1].public]).toEqual(["00001026", "raj@acme.com", "customer,agent,agent", false]);
    expect(decodeURIComponent(calls[1].url)).toContain("CaseNumber IN ('1026', '00001026')");
  });
  it("escapes ticket ids in SOQL and reports bad app credentials as an auth error", async () => {
    route([/oauth2\/token/, () => ({ access_token: "at" })], [/query/, () => ({ records: [] })]);
    await expect(sf().getTicket("x' OR Id != '")).rejects.toBeInstanceOf(TicketNotFoundError);
    expect(decodeURIComponent(calls[1].url)).toContain("'x\\' OR Id != \\''");
    route([/oauth2\/token/, () => 400]);
    await expect(sf().testConnection()).rejects.toBeInstanceOf(HelpdeskAuthError);
  });
});

describe("Zoho Desk", () => {
  it("resolves a ticket number, refreshes the token and reads threads", async () => {
    route(
      [/accounts\.zoho\.in\/oauth/, () => ({ access_token: "zt" })],
      [/tickets\/search\?ticketNumber=101/, () => ({ data: [{ id: "900000001" }] })],
      [/tickets\/900000001\/threads\/t1/, () => ({ id: "t1", direction: "in", content: "<div>Need help</div>", createdTime: "2026-10-01T10:00:00Z" })],
      [/tickets\/900000001\/threads\/t2/, () => ({ id: "t2", direction: "out", content: "Done", createdTime: "2026-10-01T11:00:00Z" })],
      [/tickets\/900000001\/threads\?/, () => ({ data: [{ id: "t2" }, { id: "t1" }] })],
      [/tickets\/900000001\/comments/, () => 204],
      [/tickets\/900000001\?/, () => ({ id: "900000001", ticketNumber: "101", subject: "Help", status: "Closed", assignee: { firstName: "Li", lastName: "Wu", email: "li@acme.com" } })],
    );
    const t = await client("zoho_desk", { dataCenter: "in", orgId: "123", clientId: "c", clientSecret: "s", refreshToken: "r" }).getTicket("101");
    expect([t.id, t.agentName, roles(t), t.conversation[0].body]).toEqual(["101", "Li Wu", "customer,agent", "Need help"]);
    expect(calls.find((c) => c.url.includes("desk.zoho.in"))?.init.headers).toMatchObject({ Authorization: "Zoho-oauthtoken zt", orgId: "123" });
  });
  it("treats Zoho's 200 + error token response as bad credentials", async () => {
    route([/oauth\/v2\/token/, () => ({ error: "invalid_code" })]);
    await expect(client("zoho_desk", { dataCenter: "com", orgId: "1", clientId: "c", clientSecret: "s", refreshToken: "r" }).testConnection()).rejects.toBeInstanceOf(HelpdeskAuthError);
  });
});

describe("Help Scout", () => {
  it("falls back from id to conversation number and orders threads oldest first", async () => {
    route(
      [/oauth2\/token/, () => ({ access_token: "hs" })],
      [/conversations\/88\?embed/, () => 404],
      [/conversations\?status=all&query=/, () => ({ _embedded: { conversations: [{ id: 555 }] } })],
      [/conversations\/555\?embed/, () => ({ id: 555, number: 88, subject: "Hi", status: "closed", assignee: { first: "Mo", last: "Ali", email: "mo@acme.com" }, _embedded: { threads: [
        { type: "reply", body: "Sure", createdAt: "2026-10-01T11:00:00Z", createdBy: { type: "user" } },
        { type: "lineitem", body: "Assigned", createdAt: "2026-10-01T10:30:00Z" },
        { type: "customer", body: "Help?", createdAt: "2026-10-01T10:00:00Z", createdBy: { type: "customer" } },
      ] } })],
    );
    const t = await client("help_scout", { appId: "a", appSecret: "b" }).getTicket("88");
    expect([t.id, t.agentEmail, roles(t)]).toEqual(["88", "mo@acme.com", "customer,agent"]);
  });
});

describe("Gorgias", () => {
  const g = () => client("gorgias", { domain: "acme", email: "a@acme.com", apiKey: "k" });
  it("reads ticket messages by sender", async () => {
    route(
      [/tickets\/9\/messages/, () => ({ data: [{ from_agent: true, body_text: "Refunded", created_datetime: "2026-10-01T11:00:00Z" }, { from_agent: false, body_text: "Refund?", created_datetime: "2026-10-01T10:00:00Z" }] })],
      [/tickets\/9$/, () => ({ id: 9, subject: "Refund", status: "closed", assignee_user: { name: "Tia", email: "tia@acme.com" } })],
    );
    const t = await g().getTicket("9");
    expect([t.agentEmail, roles(t)]).toEqual(["tia@acme.com", "customer,agent"]);
  });
  it("lists closed tickets updated since, stopping at older ones", async () => {
    route([/\/tickets\?/, () => ({ data: [
      { id: 3, status: "closed", updated_datetime: "2026-10-03T00:00:00Z", satisfaction_survey: { score: 1 } },
      { id: 2, status: "open", updated_datetime: "2026-10-02T00:00:00Z" },
      { id: 1, status: "closed", updated_datetime: "2026-09-30T00:00:00Z" },
    ], meta: { next_cursor: "next" } })]);
    expect(await g().listSolvedSince(since, 10)).toEqual([{ id: "3", tags: [], csat: "bad" }]);
    expect(calls).toHaveLength(1);
  });
});

describe("Front", () => {
  it("reads messages and internal comments in time order", async () => {
    route(
      [/conversations\/cnv_1\/messages/, () => ({ _results: [{ is_inbound: false, text: "Done", created_at: 1759320000 }, { is_inbound: true, text: "Help", created_at: 1759310000 }] })],
      [/conversations\/cnv_1\/comments/, () => ({ _results: [{ body: "On it", posted_at: 1759315000 }] })],
      [/conversations\/cnv_1$/, () => ({ id: "cnv_1", subject: "Help", status: "archived", assignee: { first_name: "Jo", last_name: "Ng", email: "jo@acme.com" } })],
    );
    const t = await client("front", { apiToken: "t" }).getTicket("cnv_1");
    expect([t.status, t.agentName, roles(t)]).toEqual(["closed", "Jo Ng", "customer,agent,agent"]);
  });
});

describe("ServiceNow", () => {
  const sn = () => client("servicenow", { instance: "acme", username: "u", password: "p" });
  it("reads an incident with caller comments and work notes", async () => {
    route(
      [/table\/incident\?/, () => ({ result: [{ sys_id: "abc", number: "INC0010023", short_description: "VPN down", state: "Resolved", "assigned_to.name": "Ben", "assigned_to.email": "ben@acme.com", "caller_id.user_name": "jane", description: "VPN won't connect" }] })],
      [/sys_journal_field/, () => ({ result: [{ element: "work_notes", value: "Reset token", sys_created_by: "ben" }, { element: "comments", value: "Works now", sys_created_by: "jane" }] })],
    );
    const t = await sn().getTicket("inc0010023");
    expect([t.id, t.agentEmail, roles(t), t.conversation[1].public]).toEqual(["INC0010023", "ben@acme.com", "customer,agent,customer", false]);
  });
  it("rejects incident numbers that could inject into the query", async () => {
    route();
    await expect(sn().getTicket("INC1^ORnumber!=x")).rejects.toBeInstanceOf(TicketNotFoundError);
    expect(calls).toHaveLength(0);
  });
});

describe("Jira Service Management", () => {
  const jira = () => client("jira_service_management", { site: "acme", email: "a@acme.com", apiToken: "t", projectKey: "sup" });
  it("reads an issue: reporter comments are the customer's", async () => {
    route(
      [/issue\/SUP-12\/comment/, () => ({ comments: [{ author: { accountId: "agent1" }, renderedBody: "<p>Fixed</p>", jsdPublic: true }, { author: { accountId: "cust" }, renderedBody: "Thanks!" }, { author: { accountId: "agent1" }, renderedBody: "note", jsdPublic: false }] })],
      [/issue\/SUP-12\?/, () => ({ key: "SUP-12", fields: { summary: "Can't print", status: { name: "Resolved" }, reporter: { accountId: "cust" }, assignee: { displayName: "Eve", emailAddress: "eve@acme.com" } }, renderedFields: { description: "<p>Printer jam</p>" } })],
    );
    const t = await jira().getTicket("sup-12");
    expect([t.id, t.agentEmail, roles(t), t.conversation[3].public]).toEqual(["SUP-12", "eve@acme.com", "customer,agent,customer,agent", false]);
  });
  it("searches done issues in the configured project", async () => {
    route([/search\/jql/, () => ({ issues: [{ key: "SUP-1", fields: { labels: ["billing"] } }] })]);
    expect(await jira().listSolvedSince(since, 10)).toEqual([{ id: "SUP-1", tags: ["billing"], csat: null }]);
    expect(JSON.parse(String(calls[0].init.body)).jql).toBe('project = "SUP" AND statusCategory = Done AND updated > "2026/10/01 00:00" ORDER BY updated ASC');
  });
});

describe("ticket requester (for matching tickets to CRM clients)", () => {
  it("Zendesk and Freshdesk look the requester up; a failed lookup still returns the ticket", async () => {
    route(
      [/\/tickets\/7\.json/, () => ({ ticket: { id: 7, requester_id: 1, assignee_id: 9 } })],
      [/\/tickets\/7\/comments\.json/, () => ({ comments: [{ author_id: 1, plain_body: "Hi" }] })],
      [/\/users\/1\.json/, () => ({ user: { name: "Meera", email: "meera@example.com", phone: "+91 98000 11111" } })],
      [/\/users\/9\.json/, () => ({ user: { name: "Sam", email: "sam@acme.com" } })],
    );
    expect((await client("zendesk", { subdomain: "acme", email: "qa@acme.com", apiToken: "tok" }).getTicket("7")).requester).toEqual({ name: "Meera", email: "meera@example.com", phone: "+91 98000 11111" });

    route(
      [/\/tickets\/5\/conversations/, () => []],
      [/\/tickets\/5$/, () => ({ id: 5, requester_id: 8, description_text: "x" })],
      [/\/contacts\/8/, () => ({ name: "Raj", email: null, phone: "022 1234", mobile: "+91 98000 22222" })],
    );
    expect((await client("freshdesk", { domain: "acme", apiKey: "k" }).getTicket("5")).requester).toEqual({ name: "Raj", email: undefined, phone: "+91 98000 22222" });

    route([/\/tickets\/6\/conversations/, () => []], [/\/tickets\/6$/, () => ({ id: 6, requester_id: 8 })], [/\/contacts\/8/, () => 500]);
    const t = await client("freshdesk", { domain: "acme", apiKey: "k" }).getTicket("6");
    expect([t.id, t.requester]).toEqual(["6", undefined]);
  });

  it("Intercom and HubSpot read the conversation's contact", async () => {
    route(
      [/\/conversations\/123/, () => ({ id: "123", source: { body: "Hi", author: { type: "user", email: "lead@example.com" } }, contacts: { contacts: [{ id: "c1" }] } })],
      [/\/contacts\/c1/, () => ({ name: "Asha", email: "asha@example.com", phone: "+919800033333" })],
    );
    expect((await client("intercom", { accessToken: "t", region: "us" }).getTicket("123")).requester).toEqual({ name: "Asha", email: "asha@example.com", phone: "+919800033333" });

    route(
      [/objects\/tickets\/77/, () => ({ id: "77", properties: { content: "x" }, associations: { contacts: { results: [{ id: "k1" }] } } })],
      [/contacts\/batch\/read/, () => ({ results: [{ id: "k1", properties: { email: "kim@example.com", phone: null, mobilephone: "98000 44444", firstname: "Kim", lastname: "Ray" } }] })],
    );
    expect((await client("hubspot", { accessToken: "pat" }).getTicket("77")).requester).toEqual({ name: "Kim Ray", email: "kim@example.com", phone: "98000 44444" });
  });

  it("Salesforce prefers the case contact and falls back to web-to-case details", async () => {
    route(
      [/oauth2\/token/, () => ({ access_token: "at" })],
      [/FROM(\+|%20)Case(\+|%20)WHERE/i, () => ({ records: [{ Id: "500000000000001AAA", CaseNumber: "00001026", SuppliedName: "Web Visitor", SuppliedEmail: "web@example.com", SuppliedPhone: "98000 55555" }] })],
      [/EmailMessage|CaseComment/, () => ({ records: [] })],
    );
    const t = await client("salesforce", { instanceUrl: "https://acme.my.salesforce.com", clientId: "id", clientSecret: "s" }).getTicket("1026");
    expect(t.requester).toEqual({ name: "Web Visitor", email: "web@example.com", phone: "98000 55555" });
    expect(decodeURIComponent(calls[1].url)).toContain("ContactEmail, ContactMobile, ContactPhone, SuppliedName, SuppliedEmail, SuppliedPhone");
  });

  it("Zoho Desk, Help Scout, Gorgias, Front, ServiceNow and Jira read it from the ticket", async () => {
    route(
      [/accounts\.zoho\.in\/oauth/, () => ({ access_token: "zt" })],
      [/tickets\/search\?ticketNumber=900/, () => ({ data: [{ id: "900" }] })],
      [/tickets\/900\/threads\?/, () => ({ data: [] })],
      [/tickets\/900\/comments/, () => 204],
      [/tickets\/900\?/, () => ({ id: "900", email: "zo@example.com", phone: "98000 66666", contact: { firstName: "Zo", lastName: "Ha" } })],
    );
    expect((await client("zoho_desk", { dataCenter: "in", orgId: "1", clientId: "c", clientSecret: "s", refreshToken: "r" }).getTicket("900")).requester).toEqual({ name: "Zo Ha", email: "zo@example.com", phone: "98000 66666" });

    route([/oauth2\/token/, () => ({ access_token: "hs" })], [/conversations\/555\?embed/, () => ({ id: 555, primaryCustomer: { first: "Mo", email: "mo@example.com" }, _embedded: { threads: [] } })]);
    expect((await client("help_scout", { appId: "a", appSecret: "b" }).getTicket("555")).requester).toEqual({ name: "Mo", email: "mo@example.com", phone: undefined });

    route([/tickets\/9\/messages/, () => ({ data: [] })], [/tickets\/9$/, () => ({ id: 9, customer: { name: "Tia", email: "tia@example.com", channels: [{ type: "email", address: "tia@example.com" }, { type: "phone", address: "+91 98000 77777" }] } })]);
    expect((await client("gorgias", { domain: "acme", email: "a@acme.com", apiKey: "k" }).getTicket("9")).requester).toEqual({ name: "Tia", email: "tia@example.com", phone: "+91 98000 77777" });

    route([/cnv_2\/messages/, () => ({ _results: [] })], [/cnv_2\/comments/, () => ({ _results: [] })], [/conversations\/cnv_2$/, () => ({ id: "cnv_2", recipient: { handle: "+91 98000 88888", name: "Jo" } })]);
    expect((await client("front", { apiToken: "t" }).getTicket("cnv_2")).requester).toEqual({ name: "Jo", email: undefined, phone: "+91 98000 88888" });

    route(
      [/table\/incident\?/, () => ({ result: [{ sys_id: "abc", number: "INC1", "caller_id.name": "Jane", "caller_id.email": "jane@example.com", "caller_id.mobile_phone": "", "caller_id.phone": "98000 99999" }] })],
      [/sys_journal_field/, () => ({ result: [] })],
    );
    expect((await client("servicenow", { instance: "acme", username: "u", password: "p" }).getTicket("INC1")).requester).toEqual({ name: "Jane", email: "jane@example.com", phone: "98000 99999" });

    route([/issue\/SUP-12\/comment/, () => ({ comments: [] })], [/issue\/SUP-12\?/, () => ({ key: "SUP-12", fields: { reporter: { accountId: "c", displayName: "Eve", emailAddress: "eve@example.com" } } })]);
    expect((await client("jira_service_management", { site: "acme", email: "a@acme.com", apiToken: "t", projectKey: "sup" }).getTicket("SUP-12")).requester).toEqual({ name: "Eve", email: "eve@example.com", phone: undefined });
  });
});
