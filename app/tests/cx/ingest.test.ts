import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { trigger } = vi.hoisted(() => ({ trigger: vi.fn() }));
vi.mock("@/lib/cx/ingest/trigger", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/cx/ingest/trigger")>()), triggerCxWorker: trigger }));

import { GET as workerRoute } from "@/app/api/internal/cron/cx-worker/route";
import { pauseSourceAction, removeSourceAction, startHelpdeskImportAction } from "@/app/cx/sources/actions";
import { connectHelpdeskAction, disconnectHelpdeskAction } from "@/app/qa/settings/actions";
import { buildConversation, customerKeyFor } from "@/lib/cx/ingest/conversation";
import { pollHelpdeskSource, processIngestJobs } from "@/lib/cx/ingest/helpdesk";
import { purgeExpiredConversations } from "@/lib/cx/ingest/retention";
import { encryptJson } from "@/lib/security/crypto";
import type { CxSource } from "@/generated/prisma/client";
import { asUser, createClient, createOrg, createUser, deleteOrgs, isRedirect, prisma } from "../helpers";

/**
 * A fake Zendesk: tickets 1..N solved one minute apart, listed oldest-updated first through
 * the search API in pages of 100, exactly like the real adapter expects.
 */
type FakeTicket = { id: number; updated: string; subject: string; comments: string[]; requester: { email?: string; phone?: string }; agent: string };
let TICKETS: FakeTicket[] = [];
const getTicketCalls: number[] = [];
let failTicket: Record<number, number> = {}; // ticket id → HTTP status to answer with
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const BASE = Date.UTC(2026, 8, 1); // 1 Sep 2026

function makeTickets(n: number) {
  TICKETS = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    updated: new Date(BASE + (i + 1) * 60_000).toISOString(),
    subject: `Order ${1000 + i} is late`,
    comments: [`Hi, I'm meera${i}@example.com, call me on +91 98000 ${String(10000 + i)}. Card 4111 1111 1111 1111.`, "Sorry! On its way."],
    requester: { email: `meera${i}@example.com` },
    agent: i % 2 ? "asha@acmebpo.com" : "ravi@acme.com",
  }));
}

beforeAll(() => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname.endsWith("/search.json")) {
      const since = Date.parse(/updated>(\S+)/.exec(url.searchParams.get("query") ?? "")?.[1] ?? "");
      const page = Number(url.searchParams.get("page") ?? 1);
      const matching = TICKETS.filter((t) => Date.parse(t.updated) > since).sort((a, b) => Date.parse(a.updated) - Date.parse(b.updated));
      const results = matching.slice((page - 1) * 100, page * 100).map((t) => ({ id: t.id, status: "solved", updated_at: t.updated, tags: [] }));
      const next = new URL(url);
      next.searchParams.set("page", String(page + 1));
      return json({ results, next_page: page * 100 < matching.length ? next.toString() : null });
    }
    const users = /\/users\/(\w+)\.json/.exec(url.pathname);
    if (users) {
      const [kind, id] = users[1].split("_");
      const t = TICKETS.find((x) => x.id === Number(id));
      return kind === "req" ? json({ user: { name: "Customer", ...t?.requester } }) : json({ user: { name: "Agent", email: t?.agent } });
    }
    const m = /\/tickets\/(\d+)(\/comments)?\.json/.exec(url.pathname);
    if (m) {
      const t = TICKETS.find((x) => x.id === Number(m[1]));
      if (!m[2]) getTicketCalls.push(Number(m[1]));
      if (failTicket[Number(m[1])]) return new Response(null, { status: failTicket[Number(m[1])] });
      if (!t) return new Response(null, { status: 404 });
      return m[2]
        ? json({ comments: t.comments.map((c, i) => ({ author_id: i === 0 ? `req_${t.id}` : `agt_${t.id}`, public: true, plain_body: c, created_at: new Date(Date.parse(t.updated) - (2 - i) * 30_000).toISOString() })) })
        : json({ ticket: { id: t.id, subject: t.subject, status: "solved", requester_id: `req_${t.id}`, assignee_id: `agt_${t.id}`, updated_at: t.updated } });
    }
    if (url.pathname.endsWith("/users/me.json")) return json({ user: { id: 1 } });
    return new Response("no route", { status: 599 });
  });
});
afterAll(() => vi.unstubAllGlobals());

const orgs: string[] = [];
afterAll(() => deleteOrgs(...orgs));

async function setup(opts: { cx?: boolean; status?: "ACTIVE" | "TRIALING" } = {}) {
  const { org, stage } = await createOrg({
    products: opts.cx === false ? [{ product: "QA_SENTINEL", planId: "scale" }] : [{ product: "CX_INTELLIGENCE", status: opts.status ?? "ACTIVE", planId: "growth", trialEndsAt: new Date(Date.now() + 86_400_000) }],
  });
  orgs.push(org.id);
  await prisma.helpdeskConnection.create({
    data: { organizationId: org.id, provider: "zendesk", accountLabel: "acme.zendesk.com", encryptedCredentials: encryptJson({ subdomain: "acme", email: "a@acme.test", apiToken: "t" }), isValid: true },
  });
  const source = (await prisma.cxSource.create({
    data: { organizationId: org.id, type: "HELPDESK", provider: "zendesk", label: "Zendesk", backfillFrom: new Date(BASE) },
  })) as CxSource & { type: "HELPDESK" };
  return { orgId: org.id, stageId: stage.id, source };
}
const reload = (id: string) => prisma.cxSource.findUniqueOrThrow({ where: { id } }) as Promise<CxSource & { type: "HELPDESK" }>;
const NOW = new Date(BASE + 10 * 86_400_000);

beforeEach(() => {
  getTicketCalls.length = 0;
  failTicket = {};
  trigger.mockReset();
});

describe("building a stored conversation", () => {
  it("redacts subject and messages before anything is stored, and keys the customer without their details", () => {
    makeTickets(1);
    const fields = buildConversation("org_a", {
      id: "1",
      subject: "Refund to meera@example.com",
      status: "solved",
      agentName: "Ravi",
      agentEmail: "Ravi@Acme.com",
      requester: { email: "Meera@Example.com", phone: "+91 98000 11111" },
      conversation: [
        { role: "customer", body: "I'm meera@example.com, call +91 98000 11111", created_at: "2026-09-01T10:00:00Z" },
        { role: "agent", body: "We emailed meera@example.com", created_at: "2026-09-01T10:30:00Z" },
      ],
    });
    const stored = JSON.stringify(fields);
    expect(stored).not.toMatch(/meera@example\.com|98000/i);
    expect(fields.subject).toBe("Refund to [EMAIL_1]");
    expect(fields.turns.map((t) => t.text)).toEqual(["I'm [EMAIL_1], call [PHONE_1]", "We emailed [EMAIL_1]"]);
    expect(fields.firstReplyAt?.toISOString()).toBe("2026-09-01T10:30:00.000Z");
    expect(fields.agentEmail).toBe("ravi@acme.com");
    // Same customer, same key; another org gets a different key for the same person.
    expect(fields.customerKey).toBe(customerKeyFor("org_a", { email: "meera@example.com" }));
    expect(customerKeyFor("org_b", { email: "meera@example.com" })).not.toBe(fields.customerKey);
  });

  it("keeps the opening and end of very long threads, and says so", () => {
    const body = "x".repeat(3_000);
    const fields = buildConversation("o", {
      id: "1", subject: "s", status: "solved", agentName: "a", agentEmail: "",
      conversation: Array.from({ length: 300 }, (_, i) => ({ role: i % 2 ? ("agent" as const) : ("customer" as const), body: `${i} ${body}` })),
    });
    expect(fields.truncated).toBe(true);
    expect(fields.turns[0].text.startsWith("0 ")).toBe(true);
    expect(fields.turns.at(-1)!.text.startsWith("299 ")).toBe(true);
    expect(fields.turns.reduce((n, t) => n + t.text.length, 0)).toBeLessThanOrEqual(60_000);
  });
});

describe("importing a helpdesk", () => {
  it("backfills every ticket page by page, then picks up new ones", async () => {
    makeTickets(130);
    const { orgId, source } = await setup();
    const listed: number[] = [];
    let more = true;
    while (more) {
      const r = await pollHelpdeskSource(await reload(source.id), NOW, { pageSize: 50 });
      listed.push(r.listed);
      more = r.more;
    }
    expect(listed.length).toBeGreaterThanOrEqual(3);
    expect(await prisma.cxIngestJob.count({ where: { sourceId: source.id } })).toBe(130);

    await processIngestJobs(120_000, orgId);
    expect(await prisma.conversation.count({ where: { organizationId: orgId } })).toBe(130);
    expect(new Set(getTicketCalls).size).toBe(130);
    expect(getTicketCalls.length).toBe(130); // each fetched once

    // A ticket solved later (inside the catch-up overlap) is picked up on the next poll.
    TICKETS.push({ ...TICKETS[0], id: 131, updated: new Date(NOW.getTime() - 60_000).toISOString() });
    await pollHelpdeskSource(await reload(source.id), NOW, { pageSize: 50 });
    await processIngestJobs(60_000, orgId);
    expect(await prisma.conversation.count({ where: { organizationId: orgId } })).toBe(131);
  });

  it("stores nothing identifying: no emails, phones or cards anywhere in the conversation rows", async () => {
    makeTickets(3);
    const { orgId, source } = await setup();
    await pollHelpdeskSource(source, NOW);
    await processIngestJobs(60_000, orgId);
    const rows = await prisma.conversation.findMany({ where: { organizationId: orgId } });
    expect(rows).toHaveLength(3);
    const all = JSON.stringify(rows);
    expect(all).not.toMatch(/@example\.com|98000|4111 1111/);
    expect(all).toContain("[EMAIL_1]");
    expect(all).toContain("[CARD_1]");
    expect(rows.every((r) => r.customerKey && /^[0-9a-f]{32}$/.test(r.customerKey))).toBe(true);
  });

  it("re-imports a ticket that changed, re-analysing only when its text changed", async () => {
    makeTickets(2);
    const { orgId, source } = await setup();
    await pollHelpdeskSource(source, NOW);
    await processIngestJobs(60_000, orgId);
    await prisma.conversation.updateMany({ where: { organizationId: orgId }, data: { analysisStatus: "DONE" } });

    // Listed again (cursor rewound) but unchanged: nothing is re-queued.
    await prisma.cxSource.update({ where: { id: source.id }, data: { cursor: new Date(BASE).toISOString() } });
    expect((await pollHelpdeskSource(await reload(source.id), NOW)).listed).toBe(2);
    expect(await prisma.cxIngestJob.count({ where: { sourceId: source.id, status: "QUEUED" } })).toBe(0);

    // Ticket 1 reopened with a new message; ticket 2 touched (new updated time) but same text.
    TICKETS[0] = { ...TICKETS[0], updated: new Date(NOW.getTime() - 120_000).toISOString(), comments: [...TICKETS[0].comments, "Still not here!"] };
    TICKETS[1] = { ...TICKETS[1], updated: new Date(NOW.getTime() - 60_000).toISOString() };
    await prisma.cxSource.update({ where: { id: source.id }, data: { cursor: new Date(BASE).toISOString() } });
    await pollHelpdeskSource(await reload(source.id), NOW);
    await processIngestJobs(60_000, orgId);

    const rows = await prisma.conversation.findMany({ where: { organizationId: orgId }, orderBy: { externalId: "asc" } });
    expect(rows).toHaveLength(2); // updated in place
    expect(rows.map((r) => r.analysisStatus)).toEqual(["PENDING", "DONE"]);
    expect(JSON.stringify(rows[0].turns)).toContain("Still not here!");
  });

  it("two overlapping runs fetch each ticket once", async () => {
    makeTickets(20);
    const { orgId, source } = await setup();
    await pollHelpdeskSource(source, NOW);
    await Promise.all([processIngestJobs(60_000, orgId), processIngestJobs(60_000, orgId)]);
    expect(getTicketCalls.length).toBe(20);
    expect(await prisma.conversation.count({ where: { organizationId: orgId } })).toBe(20);
  });

  it("maps agents to teams and links customers who are CRM clients", async () => {
    makeTickets(2);
    const { orgId, stageId, source } = await setup();
    const bpo = await prisma.team.create({ data: { organizationId: orgId, name: "Acme BPO", kind: "BPO" } });
    await prisma.agentTeamMapping.create({ data: { organizationId: orgId, teamId: bpo.id, matchType: "domain", value: "acmebpo.com" } });
    const client = await createClient(orgId, stageId, "Meera");
    await prisma.client.update({ where: { id: client.id }, data: { email: "meera0@example.com" } });

    await pollHelpdeskSource(source, NOW);
    await processIngestJobs(60_000, orgId);
    const [first, second] = await prisma.conversation.findMany({ where: { organizationId: orgId }, orderBy: { externalId: "asc" } });
    expect([first.teamId, first.clientId]).toEqual([null, client.id]); // ravi@acme.com, meera0
    expect([second.teamId, second.clientId]).toEqual([bpo.id, null]); // asha@acmebpo.com, meera1
  });

  it("retries failures, gives up on missing tickets, backs off when rate limited, stops on bad credentials", async () => {
    makeTickets(3);
    const { orgId, source } = await setup();
    await pollHelpdeskSource(source, NOW);

    failTicket = { 1: 404, 2: 429 };
    const run = await processIngestJobs(60_000, orgId);
    expect(run.rateLimited).toBe(true);
    const jobs = Object.fromEntries((await prisma.cxIngestJob.findMany({ where: { sourceId: source.id } })).map((j) => [j.externalId, j]));
    expect(jobs["1"].status).toBe("FAILED");
    expect(jobs["2"]).toMatchObject({ status: "QUEUED", attempts: 0 }); // not counted against it

    failTicket = { 2: 401 };
    await processIngestJobs(60_000, orgId);
    expect((await reload(source.id)).status).toBe("error");
    expect((await prisma.cxIngestJob.findFirstOrThrow({ where: { sourceId: source.id, externalId: "2" } })).status).toBe("FAILED");
  });

  it("does nothing for orgs without an active CX subscription", async () => {
    makeTickets(2);
    const { orgId, source } = await setup({ cx: false });
    await prisma.cxIngestJob.create({ data: { organizationId: orgId, sourceId: source.id, externalId: "1" } });
    await processIngestJobs(60_000, orgId);
    expect(await prisma.conversation.count({ where: { organizationId: orgId } })).toBe(0);
    expect((await prisma.cxIngestJob.findFirstOrThrow({ where: { sourceId: source.id } })).lastError).toMatch(/subscription is not active/);
  });
});

describe("sources and the shared helpdesk connection", () => {
  it("admins start an import (trials capped at 30 days, once per helpdesk); members can't", async () => {
    makeTickets(0);
    const { orgId, source } = await setup({ status: "TRIALING" });
    await prisma.cxSource.delete({ where: { id: source.id } });
    const admin = await createUser(orgId, { role: "ADMIN", orgRole: "OWNER" });
    const member = await createUser(orgId, { role: "RM", orgRole: "MEMBER" });

    asUser(member);
    await expect(startHelpdeskImportAction(90)).rejects.toSatisfy((e) => isRedirect(e));

    asUser(admin);
    expect(await startHelpdeskImportAction(45)).toEqual({ __actionError: expect.stringMatching(/how far back/) });
    expect(await startHelpdeskImportAction(365)).toEqual({ backfillDays: 30 });
    const created = await prisma.cxSource.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(Math.round((Date.now() - created.backfillFrom!.getTime()) / 86_400_000)).toBe(30);
    expect(trigger).toHaveBeenCalledWith({ organizationId: orgId });
    expect(await startHelpdeskImportAction(30)).toEqual({ __actionError: expect.stringMatching(/already being imported/) });
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "cx.source_connected" } })).toBe(1);
  });

  it("another org's admin can't pause or remove a source", async () => {
    const { source } = await setup();
    const other = await setup();
    asUser(await createUser(other.orgId, { role: "ADMIN", orgRole: "OWNER" }));
    expect(await pauseSourceAction(source.id)).toEqual({ __actionError: "Source not found" });
    expect(await removeSourceAction(source.id)).toEqual({ __actionError: "Source not found" });
    expect((await reload(source.id)).status).toBe("active");
  });

  it("a CX-only admin can manage the helpdesk; switching or disconnecting pauses the CX import", async () => {
    const { orgId, source } = await setup();
    asUser(await createUser(orgId, { role: "ADMIN", orgRole: "OWNER" }));

    vi.stubGlobal("fetch", async () => json({ results: [] }));
    const switched = await connectHelpdeskAction("freshdesk", { domain: "acme", apiKey: "k" });
    expect(switched).toEqual({ accountLabel: "acme.freshdesk.com" });
    expect(await reload(source.id)).toMatchObject({ status: "paused", lastError: expect.stringMatching(/switched/) });

    await prisma.cxSource.update({ where: { id: source.id }, data: { status: "active", provider: "freshdesk" } });
    expect(await disconnectHelpdeskAction()).toBeUndefined();
    expect(await reload(source.id)).toMatchObject({ status: "paused", lastError: "The helpdesk was disconnected" });
    vi.unstubAllGlobals();
  });
});

describe("retention and the worker", () => {
  it("deletes conversations older than the org's retention (default 13 months)", async () => {
    const short = await setup();
    const normal = await setup();
    await prisma.cxCostSettings.create({ data: { organizationId: short.orgId, retentionMonths: 1 } });
    const at = (months: number) => new Date(Date.now() - months * 31 * 86_400_000);
    const conv = (orgId: string, id: string, startedAt: Date) =>
      prisma.conversation.create({ data: { organizationId: orgId, sourceType: "HELPDESK", provider: "zendesk", externalId: id, startedAt, turns: [], textHash: id, redactionVersion: 1 } });
    await conv(short.orgId, "old", at(2));
    await conv(short.orgId, "new", at(0));
    await conv(normal.orgId, "old", at(2));
    await conv(normal.orgId, "ancient", at(14));

    await purgeExpiredConversations();
    expect((await prisma.conversation.findMany({ where: { organizationId: short.orgId } })).map((c) => c.externalId)).toEqual(["new"]);
    expect((await prisma.conversation.findMany({ where: { organizationId: normal.orgId } })).map((c) => c.externalId)).toEqual(["old"]);
  });

  it("the worker route needs the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await workerRoute(new Request("http://test/api/internal/cron/cx-worker"))).status).toBe(401);
    vi.unstubAllEnvs();
  });
});
