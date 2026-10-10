import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ requestJson: vi.fn(), createBatch: vi.fn(), getBatchStatus: vi.fn(), batchResults: vi.fn() }));
vi.mock("@/lib/cx/ai/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cx/ai/client")>()),
  aiConfigured: () => true,
  requestJson: ai.requestJson,
  createBatch: ai.createBatch,
  getBatchStatus: ai.getBatchStatus,
  batchResults: ai.batchResults,
}));

import { applyClassification, claimAnalysisSlots, collectClassificationBatches, submitClassificationBatch, activeTopics } from "@/lib/cx/ai/classify";
import { runDiscoveryStep } from "@/lib/cx/ai/discover";
import { recomputeDays } from "@/lib/cx/ai/rollups";
import { runAnalysis } from "@/lib/cx/ai/run";
import type { BatchItem } from "@/lib/cx/ai/client";
import { createOrg, deleteOrgs, prisma } from "../helpers";

const DAY = new Date("2026-10-01T09:00:00.000Z");
const orgs: string[] = [];
afterAll(() => deleteOrgs(...orgs));
beforeEach(() => {
  for (const f of Object.values(ai)) f.mockReset();
});

async function org(planId = "growth", status: "ACTIVE" | "TRIALING" = "ACTIVE") {
  const { org } = await createOrg({ products: [{ product: "CX_INTELLIGENCE", status, planId, analysisQuota: planId === "scale" ? 100_000 : 25_000, trialEndsAt: new Date(Date.now() + 86_400_000) } as never] });
  await prisma.productSubscription.updateMany({ where: { organizationId: org.id }, data: { analysisQuota: status === "TRIALING" ? 1_000 : planId === "scale" ? 100_000 : 25_000 } });
  orgs.push(org.id);
  return org.id;
}

async function conversations(organizationId: string, n: number, text = "My parcel is late") {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = await prisma.conversation.create({
      data: {
        organizationId, sourceType: "HELPDESK", provider: "zendesk", externalId: `${text.slice(0, 6)}-${i}`, channel: "email",
        startedAt: new Date(DAY.getTime() + i * 60_000), subject: `Ticket ${i}`,
        turns: [{ role: "customer", text: `${text} #${i}`, at: null }, { role: "agent", text: "Sorry about that", at: null }],
        textHash: `h${i}`, redactionVersion: 1, rating: i === 0 ? 2 : null, ratingScale: i === 0 ? "csat_5" : null,
      },
    });
    ids.push(c.id);
  }
  return ids;
}

/** An active two-theme topic list, as discovery would leave it. */
async function taxonomy(organizationId: string) {
  const delivery = await prisma.topic.create({ data: { organizationId, key: "delivery", name: "Delivery" } });
  await prisma.topic.create({ data: { organizationId, key: "late_delivery", name: "Late delivery", parentId: delivery.id } });
  await prisma.topic.create({ data: { organizationId, key: "damaged_item", name: "Damaged item", parentId: delivery.id } });
  await prisma.taxonomyVersion.create({ data: { organizationId, version: 1, status: "active", snapshot: [] } });
}

const analysis = (over: Record<string, unknown> = {}) => ({
  topics: [{ key: "late_delivery", primary: true, evidence: "parcel is late" }],
  proposedTopic: null, rootCause: "courier delay", summary: "Parcel late; apologised.",
  sentiment: -0.6, sentimentStart: -0.7, sentimentEnd: -0.2, churnRisk: 0.7, escalationRisk: 0.2,
  predictedCsat: 2.1, customerEffort: 3, deflectable: true, deflectableReason: "order tracking page",
  qualityScore: 70, qualityFlags: ["no resolution"], ...over,
});
const succeeded = (customId: string, json: unknown, stop = "end_turn"): BatchItem => ({
  customId, type: "succeeded",
  message: { model: "claude-opus-5-5", stop_reason: stop, content: [{ type: "text", text: JSON.stringify(json) }], usage: { input_tokens: 2000, output_tokens: 300 } },
});
const results = (items: BatchItem[]) => async function* () { yield* items; };

describe("topic discovery", () => {
  it("waits for enough conversations, then gathers and merges in two runs into a unique-keyed topic list", async () => {
    const orgId = await org();
    await conversations(orgId, 10);
    expect(await runDiscoveryStep(orgId)).toBe("not_enough_data");
    expect(ai.requestJson).not.toHaveBeenCalled();

    await conversations(orgId, 25, "Refund"); // 35 total
    ai.requestJson.mockResolvedValue({ model: "claude-opus-5-5", usage: { input_tokens: 5000, output_tokens: 500 }, json: { reasons: [{ name: "Late delivery", description: "Parcel later than promised" }] } });
    expect(await runDiscoveryStep(orgId)).toBe("gathered");
    expect(ai.requestJson).toHaveBeenCalledTimes(1); // 35 conversations = one chunk
    expect(JSON.stringify(ai.requestJson.mock.calls[0][0].prompt)).toContain("<conversation");

    ai.requestJson.mockReset().mockResolvedValue({
      model: "claude-opus-5-5", usage: { input_tokens: 3000, output_tokens: 800 },
      json: { themes: [
        { name: "Delivery", description: "Getting orders", topics: [{ name: "Late delivery", description: "Late" }, { name: "Late Delivery!", description: "Dup name" }] },
        { name: "Refunds", description: "Money back", topics: [{ name: "Refund not received", description: "Waiting" }] },
      ] },
    });
    expect(await runDiscoveryStep(orgId)).toBe("active");
    const topics = await prisma.topic.findMany({ where: { organizationId: orgId }, orderBy: { key: "asc" } });
    expect(topics.map((t) => t.key)).toEqual(["delivery", "late_delivery", "late_delivery_2", "refund_not_received", "refunds"]);
    expect(topics.filter((t) => t.parentId).length).toBe(3);
    const version = await prisma.taxonomyVersion.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(version.status).toBe("active");
    expect(version.costUsd).toBeGreaterThan(0);
    expect(await runDiscoveryStep(orgId)).toBe("done");
  });

  it("only one of two overlapping runs builds it; a failure waits before retrying; a dead step is noticed", async () => {
    const orgId = await org();
    await conversations(orgId, 35);
    // Slow enough that the two runs really overlap while the first is gathering.
    ai.requestJson.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 300));
      return { model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 1 }, json: { reasons: [] } };
    });
    const [a, b] = await Promise.all([runDiscoveryStep(orgId), runDiscoveryStep(orgId)]);
    expect([a, b].sort()).toEqual(["busy", "gathered"]);
    expect(ai.requestJson).toHaveBeenCalledTimes(1);

    // The exact race: both runs saw no version, so both try to create version 1; the loser stands down.
    const raced = await org();
    await conversations(raced, 35);
    await prisma.taxonomyVersion.create({ data: { organizationId: raced, version: 1, status: "discovering", snapshot: {} } });
    const lookup = vi.spyOn(prisma.taxonomyVersion, "findFirst").mockResolvedValueOnce(null);
    ai.requestJson.mockReset();
    expect(await runDiscoveryStep(raced)).toBe("busy");
    expect(ai.requestJson).not.toHaveBeenCalled();
    lookup.mockRestore();

    const other = await org();
    await conversations(other, 35);
    ai.requestJson.mockReset().mockRejectedValue(new Error("overloaded"));
    expect(await runDiscoveryStep(other)).toBe("failed");
    ai.requestJson.mockReset();
    expect(await runDiscoveryStep(other)).toBe("failed"); // still waiting out the retry delay
    expect(ai.requestJson).not.toHaveBeenCalled();

    const stuck = await org();
    await conversations(stuck, 35);
    await prisma.taxonomyVersion.create({ data: { organizationId: stuck, version: 1, status: "merging", snapshot: {} } });
    await prisma.$executeRaw`UPDATE "TaxonomyVersion" SET "updatedAt" = (now() AT TIME ZONE 'UTC') - interval '1 hour' WHERE "organizationId" = ${stuck}`;
    await runDiscoveryStep(stuck);
    expect((await prisma.taxonomyVersion.findFirstOrThrow({ where: { organizationId: stuck } })).status).toBe("failed");
  });
});

describe("classification batches", () => {
  it("sends waiting conversations with the org's topics as the allowed keys and the system prompt cached", async () => {
    const orgId = await org();
    await taxonomy(orgId);
    const ids = await conversations(orgId, 3);
    const otherOrg = await org();
    await conversations(otherOrg, 1, "SECRET OTHER ORG");
    ai.createBatch.mockResolvedValue({ id: "msgbatch_1" });

    expect(await submitClassificationBatch(orgId)).toBe(3);
    const [requests] = ai.createBatch.mock.calls[0];
    expect(requests.map((r: { custom_id: string }) => r.custom_id).sort()).toEqual([...ids].sort());
    const params = requests[0].params;
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.output_config.effort).toBe("low");
    expect(params.output_config.format.schema.properties.topics.items.properties.key.enum).toEqual(["damaged_item", "late_delivery", "other"]);
    expect(params.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(JSON.stringify(requests)).not.toContain("SECRET OTHER ORG");

    expect(await prisma.conversation.count({ where: { organizationId: orgId, analysisStatus: "QUEUED" } })).toBe(3);
    expect((await prisma.productSubscription.findFirstOrThrow({ where: { organizationId: orgId } })).analysesUsedThisPeriod).toBe(3);
  });

  it("collects results: applies good ones, fails refusals and errors, re-sends expired or missing ones, ignores foreign ids, and gives back the allowance", async () => {
    const orgId = await org();
    await taxonomy(orgId);
    const [ok, refused, errored, expired, missing] = await conversations(orgId, 5);
    const [foreign] = await conversations(await org(), 1);
    ai.createBatch.mockResolvedValue({ id: "msgbatch_2" });
    await submitClassificationBatch(orgId);

    ai.getBatchStatus.mockResolvedValue("in_progress");
    expect((await collectClassificationBatches(orgId)).collected).toBe(0);

    ai.getBatchStatus.mockResolvedValue("ended");
    ai.batchResults.mockImplementation(
      results([
        succeeded(ok, analysis({ topics: [{ key: "made_up", primary: true, evidence: "x" }, { key: "late_delivery", primary: false, evidence: "late" }], sentiment: 7, predictedCsat: 0 })),
        succeeded(refused, {}, "refusal"),
        { customId: errored, type: "errored", error: "api_error" },
        { customId: expired, type: "expired" },
        succeeded(foreign, analysis()),
      ]),
    );
    expect(await collectClassificationBatches(orgId)).toMatchObject({ collected: 1, analysed: 1, failed: 2 });

    const byId = Object.fromEntries((await prisma.conversation.findMany({ where: { organizationId: orgId } })).map((c) => [c.id, c.analysisStatus]));
    expect([byId[ok], byId[refused], byId[errored], byId[expired], byId[missing]]).toEqual(["DONE", "FAILED", "FAILED", "PENDING", "PENDING"]);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: foreign } })).analysisStatus).toBe("PENDING"); // untouched

    const a = await prisma.conversationAnalysis.findUniqueOrThrow({ where: { conversationId: ok } });
    expect([a.sentiment, a.predictedCsat]).toEqual([1, 1]); // clamped
    expect(a.costUsd).toBeCloseTo((2000 * 4 + 300 * 20) / 1e6 / 2, 6); // batch price
    const topics = await prisma.conversationTopic.findMany({ where: { conversationId: ok }, include: { topic: true } });
    expect(topics.map((t) => [t.topic.key, t.isPrimary])).toEqual([["late_delivery", true]]); // unknown key dropped, primary reassigned

    // 5 claimed, 4 given back (2 failed, 2 to re-send).
    expect((await prisma.productSubscription.findFirstOrThrow({ where: { organizationId: orgId } })).analysesUsedThisPeriod).toBe(1);
    const bucket = await prisma.cxMetricBucket.findFirstOrThrow({ where: { organizationId: orgId, dimension: "all" } });
    expect(bucket).toMatchObject({ conversations: 5, sentimentCount: 1, ratingCount: 1, deflectableCount: 1, highRiskCount: 1 });
  });

  it("stops at the plan's allowance and marks the rest as over it", async () => {
    const orgId = await org("growth", "TRIALING");
    await taxonomy(orgId);
    await conversations(orgId, 5);
    await prisma.productSubscription.updateMany({ where: { organizationId: orgId }, data: { analysesUsedThisPeriod: 998 } });
    ai.createBatch.mockResolvedValue({ id: "msgbatch_3" });

    expect(await submitClassificationBatch(orgId)).toBe(2);
    const counts = Object.fromEntries((await prisma.conversation.groupBy({ by: ["analysisStatus"], where: { organizationId: orgId }, _count: { _all: true } })).map((g) => [g.analysisStatus, g._count._all]));
    expect(counts).toEqual({ QUEUED: 2, SKIPPED_QUOTA: 3 });
    expect((await prisma.productSubscription.findFirstOrThrow({ where: { organizationId: orgId } })).analysesUsedThisPeriod).toBe(1_000);
    expect(await claimAnalysisSlots(orgId, 10)).toBe(0);
  });

  it("concurrent claims never overspend the allowance", async () => {
    const orgId = await org();
    await prisma.productSubscription.updateMany({ where: { organizationId: orgId }, data: { analysesUsedThisPeriod: 24_990 } });
    const granted = await Promise.all(Array.from({ length: 6 }, () => claimAnalysisSlots(orgId, 4)));
    expect(granted.reduce((a, b) => a + b, 0)).toBe(10);
    expect((await prisma.productSubscription.findFirstOrThrow({ where: { organizationId: orgId } })).analysesUsedThisPeriod).toBe(25_000);
  });

  it("re-analysing replaces topics and daily totals instead of adding to them", async () => {
    const orgId = await org();
    await taxonomy(orgId);
    const [id] = await conversations(orgId, 1);
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    const tax = (await activeTopics(orgId))!;
    const meta = { model: "claude-opus-5-5", costUsd: 0, versionId: tax.versionId, topics: tax.topics };
    await applyClassification(c, analysis(), meta);
    await recomputeDays(orgId, ["2026-10-01"]);
    await applyClassification(c, analysis({ topics: [{ key: "damaged_item", primary: true, evidence: "broken" }] }), meta);
    await recomputeDays(orgId, ["2026-10-01"]);
    await recomputeDays(orgId, ["2026-10-01"]);

    expect((await prisma.conversationTopic.findMany({ where: { conversationId: id }, include: { topic: true } })).map((t) => t.topic.key)).toEqual(["damaged_item"]);
    const buckets = await prisma.cxMetricBucket.findMany({ where: { organizationId: orgId } });
    expect(buckets.find((b) => b.dimension === "all")?.conversations).toBe(1);
    expect(buckets.filter((b) => b.dimension === "topic")).toHaveLength(1);
  });
});

describe("the analysis run", () => {
  it("Scale plans analyse in real time; others wait for a topic list first; orgs without CX are skipped", async () => {
    const scale = await org("scale");
    await taxonomy(scale);
    await conversations(scale, 2);
    ai.requestJson.mockResolvedValue({ model: "claude-opus-5-5", usage: { input_tokens: 1000, output_tokens: 200 }, json: analysis() });
    await runAnalysis(60_000, scale);
    expect(ai.createBatch).not.toHaveBeenCalled();
    expect(await prisma.conversation.count({ where: { organizationId: scale, analysisStatus: "DONE" } })).toBe(2);

    const noTopics = await org();
    await conversations(noTopics, 5);
    ai.requestJson.mockReset();
    await runAnalysis(60_000, noTopics);
    expect(ai.createBatch).not.toHaveBeenCalled(); // under 30 conversations: no topic list, nothing sent
    expect(await prisma.conversation.count({ where: { organizationId: noTopics, analysisStatus: "PENDING" } })).toBe(5);

    const { org: lapsed } = await createOrg({ products: [{ product: "CX_INTELLIGENCE", status: "CANCELED", planId: "growth" }] });
    orgs.push(lapsed.id);
    await taxonomy(lapsed.id);
    await conversations(lapsed.id, 2);
    await runAnalysis(60_000, lapsed.id);
    expect(ai.createBatch).not.toHaveBeenCalled();
    expect(ai.requestJson).not.toHaveBeenCalled();
  });
});
