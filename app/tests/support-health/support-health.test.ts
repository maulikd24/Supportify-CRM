import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { post } = vi.hoisted(() => ({ post: vi.fn(async () => ({ status: 200 })) }));
vi.mock("@/lib/security/outbound", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/outbound")>()),
  postJsonToPublicUrl: post,
}));

import { linkTicketToClientAction, unlinkRequesterAction } from "@/app/(dashboard)/clients/[id]/support-actions";
import { runReview } from "@/lib/qa/run-review";
import { encryptJson } from "@/lib/security/crypto";
import { getSupportHealth, supportStatus } from "@/lib/support-health/health";
import { normalizePhone, phoneKey } from "@/lib/support-health/link";
import { asUser, createClient, createOrg, createUser, deleteOrgs, isRedirect, prisma } from "../helpers";
import type { HelpdeskConnection, SopDocument } from "@/generated/prisma/client";

/**
 * Reviews run for real (runReview) against a stubbed Zendesk and Claude: each ticket's requester
 * and score come from the tables below, so we can check matching, health and alerts end to end.
 */
const REQUESTERS: Record<string, { email?: string; phone?: string }> = {};
const SCORES: Record<string, number> = {};
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

type U = Awaited<ReturnType<typeof createUser>>;
let orgId: string, otherOrgId: string, crmOnlyOrgId: string;
let admin: U, manager: U, rm: U, otherAdmin: U;
let connection: HelpdeskConnection, sop: SopDocument;
let meera: string, raj: string, twinA: string, otherOrgMeera: string;

async function review(ticketId: string, requester: { email?: string; phone?: string }, score: number, org = orgId) {
  REQUESTERS[ticketId] = requester;
  SCORES[ticketId] = score;
  const conn = org === orgId ? connection : await prisma.helpdeskConnection.findUniqueOrThrow({ where: { organizationId: org } });
  const s = org === orgId ? sop : await prisma.sopDocument.findFirstOrThrow({ where: { organizationId: org } });
  return runReview(org, conn, s, ticketId, { source: "manual", isOverage: false });
}

async function qaSetup(org: string) {
  await prisma.helpdeskConnection.create({
    data: { organizationId: org, provider: "zendesk", accountLabel: "acme.zendesk.com", encryptedCredentials: encryptJson({ subdomain: "acme", email: "a@acme.test", apiToken: "t" }), isValid: true },
  });
  return prisma.sopDocument.create({ data: { organizationId: org, name: "SOP", content: "Be kind.", category: "general" } });
}

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = "test";
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const t = url.match(/zendesk\.com\/api\/v2\/tickets\/([\w-]+)(\/comments)?\.json/);
    if (t) {
      return t[2]
        ? json({ comments: [{ author_id: 1, public: true, plain_body: "Help" }, { author_id: 9, public: true, plain_body: "Done" }] })
        : json({ ticket: { id: t[1], subject: `Ticket ${t[1]}`, status: "solved", requester_id: `req-${t[1]}`, assignee_id: 9 } });
    }
    const u = url.match(/zendesk\.com\/api\/v2\/users\/req-([\w-]+)\.json/);
    if (u) return json({ user: { name: "Customer", ...REQUESTERS[u[1]] } });
    if (url.includes("zendesk.com/api/v2/users/")) return json({ user: { name: "Agent", email: "agent@acme.test" } });
    if (url.includes("api.anthropic.com")) {
      const body = String(init?.body ?? "");
      // The prompt carries "- Subject: Ticket T6" then a newline (JSON-escaped in the body).
      const ticket = Object.keys(SCORES).find((id) => body.includes(`Subject: Ticket ${id}\\n`)) ?? "";
      const s = SCORES[ticket] ?? 80;
      const result = { overall_score: s, criteria_scores: { sop_adherence: s, tone_and_empathy: s, accuracy: s, resolution_quality: s, response_completeness: s }, sentiment: { overall: "neutral" }, summary: "x", strengths: [], improvements: [], sop_violations: [], accuracy_detail: {} };
      return json({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: JSON.stringify(result) }], usage: { input_tokens: 10, output_tokens: 10 } });
    }
    return new Response("no route", { status: 599 });
  });

  const both = [{ product: "CRM" as const, planId: "scale", seats: 50 }, { product: "QA_SENTINEL" as const, planId: "scale", reviewQuota: 1000 }];
  const a = await createOrg({ products: both });
  const b = await createOrg({ products: both });
  const c = await createOrg({ products: [{ product: "CRM", planId: "scale", seats: 50 }] });
  orgId = a.org.id;
  otherOrgId = b.org.id;
  crmOnlyOrgId = c.org.id;
  admin = await createUser(orgId, { role: "ADMIN", orgRole: "OWNER" });
  manager = await createUser(orgId, { role: "MANAGER", orgRole: "MEMBER" });
  rm = await createUser(orgId, { role: "RM", orgRole: "MEMBER" });
  await prisma.user.update({ where: { id: rm.id }, data: { managerId: manager.id } });
  otherAdmin = await createUser(otherOrgId, { role: "ADMIN", orgRole: "OWNER" });

  const client = async (org: string, stage: string, name: string, data: { email?: string; mobile?: string; priority?: "HIGH" | "MEDIUM" }) => {
    const created = await createClient(org, stage, name);
    return (await prisma.client.update({ where: { id: created.id }, data: { ...data, assignedToId: org === orgId ? rm.id : null } })).id;
  };
  meera = await client(orgId, a.stage.id, "Meera", { email: "Meera@Example.com", mobile: "9800011111", priority: "HIGH" });
  raj = await client(orgId, a.stage.id, "Raj", { mobile: "+91 98000 22222" });
  twinA = await client(orgId, a.stage.id, "Twin A", { email: "shared@example.com" });
  await client(orgId, a.stage.id, "Twin B", { email: "shared@example.com" });
  otherOrgMeera = await client(otherOrgId, b.stage.id, "Meera elsewhere", { email: "meera@example.com" });

  sop = await qaSetup(orgId);
  connection = await prisma.helpdeskConnection.findUniqueOrThrow({ where: { organizationId: orgId } });
  await qaSetup(otherOrgId);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await deleteOrgs(orgId, otherOrgId, crmOnlyOrgId);
});
beforeEach(() => post.mockClear());

describe("matching tickets to clients", () => {
  it("phone numbers compare on their last 10 digits, whatever the formatting", () => {
    expect(phoneKey(normalizePhone("+91 98000-11111")!)).toBe("9800011111");
    expect(normalizePhone("12345")).toBeNull();
  });

  it("links by exact email (any case) or phone, only within the review's own org", async () => {
    const byEmail = await review("T1", { email: " MEERA@example.com " }, 85);
    const byPhone = await review("T2", { phone: "+91-98000-22222" }, 85);
    const inOtherOrg = await review("T3", { email: "meera@example.com" }, 85, otherOrgId);

    const rows = await prisma.ticketReview.findMany({ where: { id: { in: [byEmail.id, byPhone.id, inOtherOrg.id] } } });
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by[byEmail.id]).toMatchObject({ clientId: meera, clientLinkedBy: "auto", requesterEmail: "meera@example.com" });
    expect(by[byPhone.id]).toMatchObject({ clientId: raj, requesterPhone: "919800022222" });
    expect(by[inOtherOrg.id].clientId).toBe(otherOrgMeera); // never org A's Meera
  });

  it("links nothing when two clients share the email, or nobody matches", async () => {
    const ambiguous = await review("T4", { email: "shared@example.com" }, 80);
    const stranger = await review("T5", { email: "nobody@example.com" }, 80);
    const rows = await prisma.ticketReview.findMany({ where: { id: { in: [ambiguous.id, stranger.id] } } });
    expect(rows.map((r) => r.clientId)).toEqual([null, null]);
  });
});

describe("support health and alerts", () => {
  it("averages the latest three reviews; below 70 is at risk", async () => {
    expect(supportStatus([])).toEqual({ status: "no_data", averageScore: null });
    expect(supportStatus([80, 60, 70]).status).toBe("healthy");
    expect(supportStatus([60, 65, 80]).status).toBe("at_risk");
  });

  it("alerts the RM's manager and team channels once per drop for a high-priority client, and re-arms on recovery", async () => {
    await prisma.alertChannel.create({
      data: { organizationId: orgId, kind: "slack", name: "#cs", encryptedUrl: encryptJson("https://hooks.slack.com/services/x"), alertTypes: ["client_support_risk"] },
    });
    const alerts = () => prisma.notification.count({ where: { organizationId: orgId, type: "client_support_risk", userId: manager.id } });

    await review("T6", { email: "meera@example.com" }, 40);
    await review("T7", { email: "meera@example.com" }, 50); // latest 3: 50, 40, 85 → 58
    expect(await alerts()).toBe(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(post.mock.calls[0])).toContain("Support quality dropped: Meera");

    await review("T8", { email: "meera@example.com" }, 30); // still at risk: no second alert
    expect(await alerts()).toBe(1);

    for (const id of ["T9", "T10", "T11"]) await review(id, { email: "meera@example.com" }, 95); // recovers
    expect((await prisma.client.findUniqueOrThrow({ where: { id: meera } })).supportRiskNotifiedAt).toBeNull();
    for (const id of ["T12", "T13", "T14"]) await review(id, { email: "meera@example.com" }, 20); // drops again
    expect(await alerts()).toBe(2);

    const health = await getSupportHealth(orgId, meera);
    expect(health).toMatchObject({ status: "at_risk", averageScore: 20 });
    expect(health.reviews.map((r) => r.ticketId)).toEqual(["T14", "T13", "T12"]);
  });

  it("doesn't alert when the org's CRM subscription has lapsed (needs both products)", async () => {
    const { org, stage } = await createOrg({
      products: [{ product: "QA_SENTINEL", planId: "scale", reviewQuota: 1000 }, { product: "CRM", status: "CANCELED", planId: "scale", seats: 5 }],
    });
    try {
      const qaAdmin = await createUser(org.id, { role: "ADMIN", orgRole: "OWNER" });
      const c = await createClient(org.id, stage.id, "Lapsed");
      await prisma.client.update({ where: { id: c.id }, data: { email: "lapsed@example.com", priority: "HIGH" } });
      await qaSetup(org.id);
      await review("L1", { email: "lapsed@example.com" }, 10, org.id);
      expect(await prisma.notification.count({ where: { organizationId: org.id, userId: qaAdmin.id, type: "client_support_risk" } })).toBe(0);
      expect((await prisma.client.findUniqueOrThrow({ where: { id: c.id } })).supportRiskNotifiedAt).toBeNull();
    } finally {
      await deleteOrgs(org.id);
    }
  });

  it("doesn't alert for clients that aren't high priority", async () => {
    await review("T15", { phone: "9800022222" }, 10);
    expect(await prisma.notification.count({ where: { organizationId: orgId, type: "client_support_risk", payload: { path: ["clientId"], equals: raj } } })).toBe(0);
  });
});

describe("admin linking", () => {
  it("links a reviewed ticket's customer to a client (past and future tickets), then unlinks for good", async () => {
    const stray = await review("T16", { email: "personal@gmail.example" }, 75);
    expect((await prisma.ticketReview.findUniqueOrThrow({ where: { id: stray.id } })).clientId).toBeNull();

    asUser(admin);
    expect(await linkTicketToClientAction(raj, "#T16")).toBeUndefined();
    expect(await prisma.ticketReview.findUniqueOrThrow({ where: { id: stray.id } })).toMatchObject({ clientId: raj, clientLinkedBy: "manual" });
    const next = await review("T17", { email: "personal@gmail.example" }, 75);
    expect((await prisma.ticketReview.findUniqueOrThrow({ where: { id: next.id } })).clientId).toBe(raj);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "qa.requester_linked", entityId: raj } })).toBe(1);

    expect(await unlinkRequesterAction(raj, { email: "personal@gmail.example", phone: null })).toBeUndefined();
    expect(await prisma.ticketReview.count({ where: { organizationId: orgId, requesterEmail: "personal@gmail.example", clientId: { not: null } } })).toBe(0);
    const later = await review("T18", { email: "personal@gmail.example" }, 75);
    expect((await prisma.ticketReview.findUniqueOrThrow({ where: { id: later.id } })).clientId).toBeNull(); // stays unlinked
  });

  it("only admins of the client's org can link, and only tickets from their own org", async () => {
    asUser(rm);
    await expect(linkTicketToClientAction(meera, "T5")).rejects.toSatisfy((e) => isRedirect(e));
    asUser(otherAdmin);
    expect(await linkTicketToClientAction(meera, "T5")).toEqual({ __actionError: "Client not found" });
    // Org B's admin can't pull org A's ticket into an org B client either.
    expect(await linkTicketToClientAction(otherOrgMeera, "T5")).toEqual({ __actionError: expect.stringMatching(/No QA review found/) });
    expect(await unlinkRequesterAction(meera, { email: "meera@example.com", phone: null })).toEqual({ __actionError: "Client not found" });
    expect((await prisma.ticketReview.findFirstOrThrow({ where: { organizationId: orgId, ticketId: "T5" } })).clientId).toBeNull();
  });

  it("can't unlink a requester that isn't linked to that client", async () => {
    asUser(admin);
    expect(await unlinkRequesterAction(twinA, { email: "meera@example.com", phone: null })).toEqual({
      __actionError: expect.stringMatching(/isn't linked to this client/),
    });
    expect(await prisma.ticketReview.count({ where: { organizationId: orgId, requesterEmail: "meera@example.com", clientId: meera } })).toBeGreaterThan(0);
  });

  it("needs both products", async () => {
    const crmAdmin = await createUser(crmOnlyOrgId, { role: "ADMIN", orgRole: "OWNER" });
    const stage = await prisma.stage.findFirstOrThrow({ where: { organizationId: crmOnlyOrgId } });
    const c = await createClient(crmOnlyOrgId, stage.id, "Solo");
    asUser(crmAdmin);
    expect(await linkTicketToClientAction(c.id, "T1")).toEqual({ __actionError: expect.stringMatching(/needs both CRM and QA Sentinel/) });
  });
});
