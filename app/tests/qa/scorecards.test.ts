import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { computeScore, DEFAULT_SCORECARD, normalizeCriteria, resolveScorecard } from "@/lib/qa/scorecard";
import { createScorecardAction, deleteScorecardAction, setDefaultScorecardAction, updateScorecardAction } from "@/app/qa/scorecards/actions";
import { saveAutoReviewSettingsAction } from "@/app/qa/settings/auto-review-actions";
import { pollOrganization, processQueue } from "@/lib/qa/auto-review";
import { encryptJson } from "@/lib/security/crypto";
import { asUser, createOrg, createUser, deleteOrgs, prisma } from "../helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let growth: string, starter: string, other: string, adminGrowth: U, adminStarter: U, memberGrowth: U, otherScorecard: string;

const CUSTOM = [
  { label: "Politeness", description: "Friendly and polite.", weight: 1, autoFailBelow: null },
  { label: "Refund policy", description: "Never promise refunds outside policy.", weight: 3, autoFailBelow: 40 },
];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = globalThis.fetch;
let lastPrompt = "";

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = "test";
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("zendesk.com/api/v2/search.json")) return json({ results: [{ id: 501, status: "solved", tags: [] }], next_page: null });
    const t = url.match(/zendesk\.com\/api\/v2\/tickets\/(\d+)(\/comments)?\.json/);
    if (t) {
      return t[2]
        ? json({ comments: [{ author_id: 1, public: true, plain_body: "Refund me" }, { author_id: 9, public: true, plain_body: "Sure, full refund!" }] })
        : json({ ticket: { id: Number(t[1]), subject: "Refund", status: "solved", requester_id: 1, assignee_id: 9 } });
    }
    if (url.includes("zendesk.com/api/v2/users/")) return json({ user: { name: "Agent", email: "agent@acme.test" } });
    if (url.includes("api.anthropic.com")) {
      lastPrompt = String(init?.body ?? "");
      const result = { overall_score: 99, criteria_scores: { politeness: 95, refund_policy: 20, tone: 50 }, sentiment: { overall: "positive" }, summary: "Promised an out-of-policy refund", strengths: [], improvements: [], sop_violations: [], accuracy_detail: {} };
      return json({ id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: JSON.stringify(result) }], usage: { input_tokens: 1000, output_tokens: 200 } });
    }
    return realFetch(input, init);
  });

  growth = (await createOrg({ products: [{ product: "QA_SENTINEL", planId: "growth", reviewQuota: 500 }] })).org.id;
  starter = (await createOrg({ products: [{ product: "QA_SENTINEL", planId: "starter", reviewQuota: 100 }] })).org.id;
  other = (await createOrg({ products: [{ product: "QA_SENTINEL", planId: "growth", reviewQuota: 500 }] })).org.id;
  adminGrowth = await createUser(growth);
  memberGrowth = await createUser(growth, { role: "RM", orgRole: "MEMBER" });
  adminStarter = await createUser(starter);
  otherScorecard = (await prisma.scorecard.create({ data: { organizationId: other, name: "Other org", isDefault: true, criteria: normalizeCriteria(CUSTOM) } })).id;
});
beforeEach(() => asUser(adminGrowth));
afterAll(async () => {
  vi.unstubAllGlobals();
  await deleteOrgs(growth, starter, other);
});

describe("computeScore", () => {
  const criteria = normalizeCriteria(CUSTOM);

  it("weights the overall score and ignores unknown or missing criteria", () => {
    expect(computeScore(criteria, { politeness: 100, refund_policy: 60, extra: 0 })).toEqual({ overall: 70, autoFailed: false, autoFailReasons: [] });
    expect(computeScore(criteria, { politeness: 80 }).overall).toBe(80);
    expect(computeScore(criteria, {}).overall).toBe(0);
  });

  it("auto-fails to 0 when a critical criterion is under its threshold", () => {
    expect(computeScore(criteria, { politeness: 100, refund_policy: 39 })).toEqual({ overall: 0, autoFailed: true, autoFailReasons: ["Refund policy"] });
  });

  it("gives unique keys to duplicate labels", () => {
    expect(normalizeCriteria([CUSTOM[0], CUSTOM[0]]).map((c) => c.key)).toEqual(["politeness", "politeness_2"]);
  });
});

describe("scorecard management", () => {
  it("lets a Growth admin create, edit and choose a default scorecard", async () => {
    const { id } = (await createScorecardAction({ name: "Refunds", criteria: CUSTOM })) as { id: string };
    const second = (await createScorecardAction({ name: "Second", criteria: [CUSTOM[0]] })) as { id: string };
    expect((await prisma.scorecard.findUniqueOrThrow({ where: { id } })).isDefault).toBe(true);
    expect((await prisma.scorecard.findUniqueOrThrow({ where: { id: second.id } })).isDefault).toBe(false);

    await setDefaultScorecardAction(second.id);
    expect((await resolveScorecard(growth)).id).toBe(second.id);
    expect((await resolveScorecard(growth, id)).name).toBe("Refunds");

    await updateScorecardAction(id, { name: "Refunds v2", criteria: CUSTOM });
    expect((await prisma.scorecard.findUniqueOrThrow({ where: { id } })).name).toBe("Refunds v2");
    expect(await prisma.auditLog.count({ where: { organizationId: growth, action: { startsWith: "qa.scorecard_" } } })).toBe(4);

    await deleteScorecardAction(second.id);
    expect((await prisma.scorecard.findUniqueOrThrow({ where: { id } })).isDefault).toBe(true);
  });

  it("rejects invalid scorecards with a readable message", async () => {
    expect(await createScorecardAction({ name: "Empty", criteria: [] })).toEqual({ __actionError: "Add at least one criterion" });
    expect(await createScorecardAction({ name: "Heavy", criteria: [{ ...CUSTOM[0], weight: 11 }] })).toEqual({ __actionError: "Weights must be 1–10" });
  });

  it("is limited to Growth and above", async () => {
    asUser(adminStarter);
    expect(await createScorecardAction({ name: "Nope", criteria: CUSTOM })).toEqual({ __actionError: expect.stringMatching(/Growth plans and above/) });
    await prisma.scorecard.create({ data: { organizationId: starter, name: "Kept from Growth", isDefault: true, criteria: normalizeCriteria(CUSTOM) } });
    expect(await resolveScorecard(starter)).toBe(DEFAULT_SCORECARD);
  });

  it("is limited to owners and admins", async () => {
    asUser(memberGrowth);
    await expect(createScorecardAction({ name: "Member", criteria: CUSTOM })).rejects.toThrow();
  });

  it("can't touch or use another organization's scorecard", async () => {
    expect(await updateScorecardAction(otherScorecard, { name: "Hijacked", criteria: CUSTOM })).toEqual({ __actionError: "Scorecard not found" });
    expect(await setDefaultScorecardAction(otherScorecard)).toEqual({ __actionError: "Scorecard not found" });
    expect(await deleteScorecardAction(otherScorecard)).toEqual({ __actionError: "Scorecard not found" });
    expect((await prisma.scorecard.findUniqueOrThrow({ where: { id: otherScorecard } })).name).toBe("Other org");
    expect((await resolveScorecard(growth, otherScorecard)).id).not.toBe(otherScorecard);
    expect(await saveAutoReviewSettingsAction({ enabled: false, sopId: null, scorecardId: otherScorecard, samplePercent: 10, alwaysReviewBadCsat: true, includeTags: "", excludeTags: "" })).toEqual({
      ok: false,
      error: "Pick one of your scorecards",
    });
  });
});

describe("reviews with a custom scorecard", () => {
  it("scores auto-reviews with the chosen scorecard and snapshots it", async () => {
    const scorecard = await prisma.scorecard.findFirstOrThrow({ where: { organizationId: growth, name: "Refunds v2" } });
    await prisma.helpdeskConnection.create({
      data: { organizationId: growth, provider: "zendesk", accountLabel: "acme.zendesk.com", encryptedCredentials: encryptJson({ subdomain: "acme", email: "a@acme.test", apiToken: "t" }), isValid: true },
    });
    const sop = await prisma.sopDocument.create({ data: { organizationId: growth, name: "Refund SOP", content: "No refunds after 30 days.", category: "general" } });
    await prisma.autoReviewConfig.create({
      data: { organizationId: growth, enabled: true, sopId: sop.id, scorecardId: scorecard.id, samplePercent: 100, alwaysReviewBadCsat: false, includeTags: [], excludeTags: [] },
    });

    await pollOrganization(growth);
    await processQueue(60_000, growth);

    const review = await prisma.ticketReview.findFirstOrThrow({ where: { organizationId: growth, ticketId: "501" } });
    expect(lastPrompt).toContain("refund_policy");
    expect(review.scorecardId).toBe(scorecard.id);
    expect(review.criteriaScores).toEqual({ politeness: 95, refund_policy: 20 });
    expect([review.overallScore, review.autoFailed, review.autoFailReasons]).toEqual([0, true, ["Refund policy"]]);
    expect((review.scorecardSnapshot as { name: string }).name).toBe("Refunds v2");

    // Editing the scorecard later doesn't change the stored review.
    await updateScorecardAction(scorecard.id, { name: "Refunds v3", criteria: [CUSTOM[0]] });
    const after = await prisma.ticketReview.findUniqueOrThrow({ where: { id: review.id } });
    expect((after.scorecardSnapshot as { criteria: unknown[] }).criteria).toHaveLength(2);
  });
});
