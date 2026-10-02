import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const meterEvents = vi.fn();
vi.mock("@/lib/billing/stripe", () => ({ getStripe: () => ({ billing: { meterEvents: { create: meterEvents } } }) }));

import { pollOrganization, processQueue, sampleTicket } from "@/lib/qa/auto-review";
import { encryptJson } from "@/lib/security/crypto";
import { createOrg, deleteOrgs, prisma } from "../helpers";

const TICKETS = [101, 102, 103, 104, 105].map((id) => ({
  id,
  status: "solved",
  tags: id === 105 ? ["spam"] : ["billing"],
  satisfaction_rating: id === 104 ? { score: "bad" } : null,
}));
let claudeCalls = 0;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = globalThis.fetch;

let orgId: string;
beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = "test";
  process.env.STRIPE_METER_EVENT_QA_REVIEW = "qa_review";
  process.env.STRIPE_PRICE_QA_OVERAGE = "price_overage";
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("zendesk.com/api/v2/search.json")) return json({ results: TICKETS, next_page: null });
    const t = url.match(/zendesk\.com\/api\/v2\/tickets\/(\d+)(\/comments)?\.json/);
    if (t) {
      return t[2]
        ? json({ comments: [{ author_id: 1, public: true, plain_body: "My invoice is wrong" }, { author_id: 9, public: true, plain_body: "Fixed!" }] })
        : json({ ticket: { id: Number(t[1]), subject: `Ticket ${t[1]}`, status: "solved", requester_id: 1, assignee_id: 9 } });
    }
    if (url.includes("zendesk.com/api/v2/users/")) return json({ user: { name: "Agent", email: "agent@acme.test" } });
    if (url.includes("api.anthropic.com")) {
      claudeCalls++;
      const result = { overall_score: 82, criteria_scores: { tone: 85 }, sentiment: { overall: "positive" }, summary: "Good", strengths: [], improvements: [], sop_violations: [], accuracy_detail: {} };
      return json({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: JSON.stringify(result) }], usage: { input_tokens: 1000, output_tokens: 200 } });
    }
    return realFetch(input, init);
  });

  const { org } = await createOrg({
    products: [{ product: "QA_SENTINEL", planId: "starter", reviewQuota: 2, stripeSubscriptionId: "sub_auto", billingInterval: "month" }],
  });
  orgId = org.id;
  await prisma.productSubscription.updateMany({ where: { organizationId: orgId }, data: { allowOverage: true, overageCap: 1 } });
  await prisma.zendeskConnection.create({
    data: { organizationId: orgId, subdomain: "acme", email: "a@acme.test", encryptedToken: encryptJson({ subdomain: "acme", email: "a@acme.test", apiToken: "t" }), isValid: true },
  });
  const sop = await prisma.sopDocument.create({ data: { organizationId: orgId, name: "Billing SOP", content: "Be kind.", category: "general" } });
  await prisma.autoReviewConfig.create({
    data: { organizationId: orgId, enabled: true, sopId: sop.id, samplePercent: 100, alwaysReviewBadCsat: true, includeTags: [], excludeTags: ["spam"] },
  });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await deleteOrgs(orgId);
});

describe("QA auto-review", () => {
  it("queues sampled solved tickets once, skipping excluded tags and flagging bad CSAT", async () => {
    expect(await pollOrganization(orgId)).toEqual({ found: 5, queued: 4 });
    const jobs = await prisma.autoReviewJob.findMany({ where: { organizationId: orgId } });
    expect(jobs.find((j) => j.ticketId === "104")?.reason).toBe("bad_csat");
    expect(jobs.some((j) => j.ticketId === "105")).toBe(false);
    expect((await pollOrganization(orgId)).queued).toBe(0);
  });

  it("reviews within quota, bills one overage up to the cap, then skips", async () => {
    const run = await processQueue(120_000, orgId);
    expect(run.remaining).toBe(0);
    const reviews = await prisma.ticketReview.findMany({ where: { organizationId: orgId } });
    expect(reviews).toHaveLength(3);
    expect(reviews.every((r) => r.source === "auto")).toBe(true);
    expect(reviews.filter((r) => r.isOverage)).toHaveLength(1);
    expect(claudeCalls).toBe(3);
    expect(meterEvents).toHaveBeenCalledTimes(1);
    expect(meterEvents.mock.calls[0][0]).toMatchObject({ event_name: "qa_review", payload: { stripe_customer_id: `cus_${orgId}`, value: "1" } });
    const skipped = await prisma.autoReviewJob.findFirstOrThrow({ where: { organizationId: orgId, status: "SKIPPED" } });
    expect(skipped.lastError).toMatch(/overage cap/);
  });

  it("samples deterministically at roughly the configured rate", () => {
    const cfg = { organizationId: "o", samplePercent: 30, alwaysReviewBadCsat: false, includeTags: [], excludeTags: [] };
    const picked = Array.from({ length: 2000 }, (_, i) => sampleTicket(cfg, { id: i })).filter(Boolean).length;
    expect(picked).toBeGreaterThan(500);
    expect(picked).toBeLessThan(700);
    expect(sampleTicket(cfg, { id: 7 })).toBe(sampleTicket(cfg, { id: 7 }));
    expect(sampleTicket({ ...cfg, includeTags: ["vip"] }, { id: 1, tags: ["billing"] })).toBeNull();
  });
});
