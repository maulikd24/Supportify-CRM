import { afterAll, describe, expect, it } from "vitest";

import { computeImpact, impactFor, impactRows, periodChange, type ImpactRow } from "@/lib/cx/impact";
import { breakdown, dailySeries, rankMovers } from "@/lib/cx/insights";
import { addTopic, archiveTopic, createIssue, mergeTopic, reanalyseProposed, setIssueStatus, updateTopic } from "@/lib/cx/taxonomy";
import { recomputeDays } from "@/lib/cx/ai/rollups";
import type { CostSettings } from "@/lib/cx/settings-shared";
import { createOrg, deleteOrgs, prisma } from "../helpers";

const orgs: string[] = [];
afterAll(() => deleteOrgs(...orgs));

async function org() {
  const { org } = await createOrg({ products: [{ product: "CX_INTELLIGENCE", status: "ACTIVE", planId: "growth" }] });
  orgs.push(org.id);
  return { orgId: org.id, userId: `user_${org.id}` };
}

const settings = (over: Partial<CostSettings> = {}): CostSettings => ({
  currency: "USD",
  costPerContact: { default: 4, email: 5, chat: 3, voice: null, social: null },
  agentHourlyCost: 30,
  averageOrderValue: null,
  customerLifetimeVal: 500,
  churnPropensity: 0.2,
  deflectionRate: 0.5,
  retentionMonths: 13,
  ...over,
});

const row = (over: Partial<ImpactRow>): ImpactRow => ({
  topicId: "t1", channel: "email", conversations: 0, repeats: 0, deflectable: 0, highRisk: 0, handleTimeSum: 0, handleTimeCount: 0, ...over,
});

describe("$ impact formulas", () => {
  it("prices contacts by channel (falling back to the default), repeats, automation and churn, annualised", () => {
    const impact = computeImpact(
      [
        row({ topicId: "t1", channel: "email", conversations: 10, repeats: 2, deflectable: 4, highRisk: 1 }),
        row({ topicId: "t1", channel: "voice", conversations: 5 }), // no voice cost: default 4
        row({ topicId: "t2", channel: "chat", conversations: 20, deflectable: 10, highRisk: 3 }),
      ],
      settings(),
      365, // a year-long window: annualising multiplies by 1
    );
    const t1 = impact.byTopic.find((t) => t.topicId === "t1")!;
    expect(t1.contactCost).toBe(10 * 5 + 5 * 4);
    expect(t1.repeatCost).toBe(2 * 5);
    expect(t1.automationSavings).toBe(4 * 5 * 0.5);
    expect(t1.churnExposure).toBe(1 * 0.2 * 500);
    expect(impact.totals.contactCost).toBe(70 + 20 * 3);
    expect(impact.totals.automationSavings).toBe(10 + 10 * 3 * 0.5);
    expect(impact.totals.churnExposure).toBe(4 * 100);
    expect(impact.conversations).toBe(35);
    expect(impact.missing).toEqual([]);
    // Sorted by total: t2 = 60 + 300 churn beats t1 = 70 + 100.
    expect(impact.byTopic.map((t) => t.topicId)).toEqual(["t2", "t1"]);

    const monthly = computeImpact([row({ conversations: 10 })], settings(), 30);
    expect(monthly.totals.contactCost).toBeCloseTo(10 * 5 * (365 / 30), 6);
  });

  it("charges only handle time above the average, per topic", () => {
    // Average = (10×600 + 10×1200) / 20 = 900 s. t2 runs 300 s over on 10 conversations = 3000 s.
    const impact = computeImpact(
      [row({ topicId: "t1", conversations: 10, handleTimeSum: 6000, handleTimeCount: 10 }), row({ topicId: "t2", conversations: 10, handleTimeSum: 12_000, handleTimeCount: 10 })],
      settings(),
      365,
    );
    expect(impact.byTopic.find((t) => t.topicId === "t1")!.extraHandleCost).toBe(0);
    expect(impact.byTopic.find((t) => t.topicId === "t2")!.extraHandleCost).toBeCloseTo((3000 / 3600) * 30, 6);
    expect(impact.totals.extraHandleHours).toBeCloseTo(3000 / 3600, 6);
  });

  it("leaves a figure empty, and says which input it needs, when that input isn't set", () => {
    const impact = computeImpact(
      [row({ conversations: 10, deflectable: 2, highRisk: 1, handleTimeSum: 100, handleTimeCount: 1 })],
      settings({ costPerContact: { default: null, email: null, chat: null, voice: null, social: null }, agentHourlyCost: null, deflectionRate: null, churnPropensity: null }),
      30,
    );
    expect(impact.totals).toMatchObject({ contactCost: null, repeatCost: null, automationSavings: null, extraHandleCost: null, churnExposure: null });
    expect(impact.missing.map((m) => m.input)).toEqual(["Cost per contact", "Agent hourly cost", "Deflection rate", "Churn propensity and customer lifetime value"]);
    expect(impact.unpricedChannels).toEqual([]);
  });

  it("names channels that have conversations but no cost and no default", () => {
    const impact = computeImpact([row({ channel: "email", conversations: 2 }), row({ channel: "voice", conversations: 3 })], settings({ costPerContact: { default: null, email: 5, chat: null, voice: null, social: null } }), 365);
    expect(impact.totals.contactCost).toBe(10);
    expect(impact.unpricedChannels).toEqual(["voice"]);
  });

  it("compares periods only when there is a base", () => {
    expect(periodChange(150, 100)).toBe(0.5);
    expect(periodChange(50, 100)).toBe(-0.5);
    expect(periodChange(10, 0)).toBeNull();
    expect(periodChange(null, 100)).toBeNull();
  });
});

describe("$ impact from conversations", () => {
  const T0 = new Date("2026-09-10T10:00:00.000Z");
  const at = (days: number) => new Date(T0.getTime() + days * 86_400_000);
  let n = 0;
  async function conv(organizationId: string, startedAt: Date, over: { customerKey?: string; channel?: string; handleTimeSec?: number } = {}) {
    return prisma.conversation.create({
      data: {
        organizationId, sourceType: "HELPDESK", provider: "zendesk", externalId: `imp-${++n}`, channel: over.channel ?? "email",
        startedAt, turns: [], textHash: `h${n}`, redactionVersion: 1, customerKey: over.customerKey ?? null, handleTimeSec: over.handleTimeSec ?? null,
        analysisStatus: "DONE",
      },
    });
  }

  it("counts repeats within 7 days, attributes to the primary topic, and never mixes organisations", async () => {
    const { orgId } = await org();
    const { orgId: otherId } = await org();
    const theme = await prisma.topic.create({ data: { organizationId: orgId, key: "delivery", name: "Delivery" } });
    const late = await prisma.topic.create({ data: { organizationId: orgId, key: "late", name: "Late", parentId: theme.id } });
    const damaged = await prisma.topic.create({ data: { organizationId: orgId, key: "damaged", name: "Damaged", parentId: theme.id } });

    const first = await conv(orgId, at(0), { customerKey: "cust-a" });
    const repeat = await conv(orgId, at(6), { customerKey: "cust-a" }); // within 7 days
    await conv(orgId, at(14), { customerKey: "cust-a" }); // 8 days after the previous one: not a repeat
    await conv(orgId, at(1), { customerKey: "cust-b", channel: "chat" });
    // The other org has the same customer key the day before: it must not make cust-a's first contact a repeat.
    await conv(otherId, at(-1), { customerKey: "cust-a" });
    await conv(otherId, at(2), { customerKey: "cust-z" });

    for (const [c, topicId, isPrimary] of [[first, late.id, true], [first, damaged.id, false], [repeat, damaged.id, true]] as const) {
      await prisma.conversationTopic.create({ data: { conversationId: c.id, topicId, organizationId: orgId, startedAt: c.startedAt, isPrimary } });
    }
    await prisma.conversationAnalysis.create({ data: { conversationId: repeat.id, deflectable: true, churnRisk: 0.9, model: "m", promptVersion: "v", costUsd: 0 } });

    const rows = await impactRows(orgId, at(-5), at(30));
    const total = (pick: (r: ImpactRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
    expect(total((r) => r.conversations)).toBe(4);
    expect(total((r) => r.repeats)).toBe(1);
    expect(rows.find((r) => r.topicId === late.id)).toMatchObject({ conversations: 1, repeats: 0 });
    expect(rows.find((r) => r.topicId === damaged.id)).toMatchObject({ conversations: 1, repeats: 1, deflectable: 1, highRisk: 1 });
    expect(rows.filter((r) => r.topicId === null).reduce((s, r) => s + r.conversations, 0)).toBe(2);

    const impact = await impactFor(orgId, settings(), at(-5), at(30));
    expect(impact.conversations).toBe(4);
    expect((await impactRows(otherId, at(-5), at(30))).reduce((s, r) => s + r.conversations, 0)).toBe(2);
  });
});

describe("dashboard reads", () => {
  it("fills empty days with zeros and keeps each org's totals to itself", async () => {
    const { orgId } = await org();
    const { orgId: otherId } = await org();
    for (const [organizationId, day, channel] of [[orgId, "2026-09-02", "email"], [orgId, "2026-09-02", "chat"], [otherId, "2026-09-02", "email"]] as const) {
      await prisma.conversation.create({
        data: { organizationId, sourceType: "HELPDESK", provider: "zendesk", externalId: `d-${organizationId}-${channel}`, channel, startedAt: new Date(`${day}T08:00:00Z`), turns: [], textHash: "x", redactionVersion: 1 },
      });
    }
    await recomputeDays(orgId, ["2026-09-02"]);
    await recomputeDays(otherId, ["2026-09-02"]);

    const series = await dailySeries(orgId, "all", "", new Date("2026-09-01T00:00:00Z"), 3);
    expect(series.map((p) => p.conversations)).toEqual([0, 2, 0]);
    expect(series[0].sentiment).toBeNull();

    const channels = await breakdown(orgId, "channel", new Date("2026-09-01T00:00:00Z"), new Date("2026-09-04T00:00:00Z"));
    expect(channels.map((c) => [c.id, c.conversations]).sort()).toEqual([["chat", 1], ["email", 1]]);
  });

  it("ranks movers by absolute change and ignores tiny topics", () => {
    const current = new Map([["a", 30], ["b", 4], ["c", 2], ["d", 10]]);
    const previous = new Map([["a", 10], ["b", 1], ["d", 25], ["e", 6]]);
    const { rising, falling } = rankMovers(current, previous);
    expect(rising.map((m) => m.topicId)).toEqual(["a"]); // b and c never reach 5 conversations
    expect(falling.map((m) => [m.topicId, m.change])).toEqual([["d", -15], ["e", -6]]);
  });
});

describe("editing the topic list", () => {
  async function setup() {
    const { orgId, userId } = await org();
    const theme = await prisma.topic.create({ data: { organizationId: orgId, key: "delivery", name: "Delivery" } });
    const late = await prisma.topic.create({ data: { organizationId: orgId, key: "late", name: "Late", parentId: theme.id } });
    const slow = await prisma.topic.create({ data: { organizationId: orgId, key: "slow", name: "Slow", parentId: theme.id } });
    return { orgId, userId, theme, late, slow };
  }
  let m = 0;
  const conversation = (organizationId: string, startedAt = new Date("2026-09-03T10:00:00Z")) =>
    prisma.conversation.create({ data: { organizationId, sourceType: "HELPDESK", provider: "zendesk", externalId: `m-${++m}`, startedAt, turns: [], textHash: "x", redactionVersion: 1 } });

  it("merges conversations (keeping one row, primary if either was), issues and earlier merges into the target", async () => {
    const { orgId, userId, late, slow, theme } = await setup();
    const both = await conversation(orgId);
    const onlySlow = await conversation(orgId, new Date("2026-09-05T10:00:00Z"));
    await prisma.conversationTopic.createMany({
      data: [
        { conversationId: both.id, topicId: late.id, organizationId: orgId, startedAt: both.startedAt, isPrimary: false },
        { conversationId: both.id, topicId: slow.id, organizationId: orgId, startedAt: both.startedAt, isPrimary: true },
        { conversationId: onlySlow.id, topicId: slow.id, organizationId: orgId, startedAt: onlySlow.startedAt, isPrimary: true },
      ],
    });
    const issue = await createIssue(orgId, userId, { topicId: slow.id, title: "Courier X" });
    const older = await prisma.topic.create({ data: { organizationId: orgId, key: "older", name: "Older", parentId: theme.id, status: "MERGED", mergedIntoId: slow.id } });

    const days = await mergeTopic(orgId, slow.id, late.id);
    expect(days.sort()).toEqual(["2026-09-03", "2026-09-05"]);
    const rows = await prisma.conversationTopic.findMany({ where: { organizationId: orgId }, orderBy: { startedAt: "asc" } });
    expect(rows.map((r) => [r.conversationId, r.topicId, r.isPrimary])).toEqual([
      [both.id, late.id, true],
      [onlySlow.id, late.id, true],
    ]);
    expect(await prisma.topic.findUnique({ where: { id: slow.id } })).toMatchObject({ status: "MERGED", mergedIntoId: late.id });
    expect((await prisma.topicIssue.findUnique({ where: { id: issue.id } }))!.topicId).toBe(late.id);
    expect((await prisma.topic.findUnique({ where: { id: older.id } }))!.mergedIntoId).toBe(late.id);
  });

  it("refuses other organisations' topics, themes and merging a topic into itself", async () => {
    const { orgId, late, slow, theme } = await setup();
    const other = await setup();
    await expect(mergeTopic(orgId, slow.id, other.late.id)).rejects.toThrow("Topic not found");
    await expect(mergeTopic(other.orgId, slow.id, other.late.id)).rejects.toThrow("Topic not found");
    await expect(mergeTopic(orgId, theme.id, late.id)).rejects.toThrow("Only topics can be merged");
    await expect(mergeTopic(orgId, late.id, late.id)).rejects.toThrow("different topic");
    await expect(updateTopic(orgId, late.id, { ownerTeamId: (await prisma.team.create({ data: { organizationId: other.orgId, name: "Ops", kind: "OWNER" } })).id })).rejects.toThrow("Team not found");
    await expect(updateTopic(orgId, late.id, { parentId: other.theme.id })).rejects.toThrow("Topic not found");
    await expect(createIssue(other.orgId, "u", { topicId: late.id, title: "x" })).rejects.toThrow("Topic not found");
    expect(await prisma.topic.findUnique({ where: { id: slow.id } })).toMatchObject({ status: "ACTIVE" });
  });

  it("adds topics with a unique key, refuses duplicates in a theme, and archives a theme only once it is empty", async () => {
    const { orgId, theme, late, slow } = await setup();
    const a = await addTopic(orgId, { name: "Late!", parentId: theme.id, origin: "manual" });
    expect(a.key).toBe("late_2");
    await expect(addTopic(orgId, { name: "late", parentId: theme.id, origin: "manual" })).rejects.toThrow("already exists");
    await expect(archiveTopic(orgId, theme.id)).rejects.toThrow("Move or archive");
    for (const t of [late, slow, a]) await archiveTopic(orgId, t.id);
    expect((await archiveTopic(orgId, theme.id)).status).toBe("ARCHIVED");
  });

  it("re-analyses only this org's analysed conversations that suggested the topic, within the window", async () => {
    const { orgId } = await setup();
    const other = await setup();
    const make = async (organizationId: string, proposed: string | null, startedAt: Date, status: "DONE" | "QUEUED" = "DONE") => {
      const c = await conversation(organizationId, startedAt);
      await prisma.conversation.update({ where: { id: c.id }, data: { analysisStatus: status } });
      await prisma.conversationAnalysis.create({ data: { conversationId: c.id, proposedTopic: proposed, model: "m", promptVersion: "v", costUsd: 0 } });
      return c.id;
    };
    const since = new Date("2026-09-01T00:00:00Z");
    const hit = await make(orgId, "Gift wrap", new Date("2026-09-10T00:00:00Z"));
    await make(orgId, "gift WRAP", new Date("2026-08-01T00:00:00Z")); // before the window
    await make(orgId, "Something else", new Date("2026-09-10T00:00:00Z"));
    // Already in a batch: sending it back to PENDING would analyse (and charge for) it twice.
    const queued = await make(orgId, "Gift wrap", new Date("2026-09-11T00:00:00Z"), "QUEUED");
    await make(other.orgId, "Gift wrap", new Date("2026-09-10T00:00:00Z"));

    expect(await reanalyseProposed(orgId, "gift wrap", since)).toBe(1);
    expect((await prisma.conversation.findUnique({ where: { id: hit } }))!.analysisStatus).toBe("PENDING");
    expect((await prisma.conversation.findUnique({ where: { id: queued } }))!.analysisStatus).toBe("QUEUED");
    expect(await prisma.conversation.count({ where: { organizationId: other.orgId, analysisStatus: "PENDING" } })).toBe(0);
  });

  it("tracks an issue to resolution, keeping the first resolved date, and only within its org", async () => {
    const { orgId, userId, late } = await setup();
    const other = await setup();
    const issue = await createIssue(orgId, userId, { topicId: late.id, title: "  Courier misses slots  " });
    expect(issue.title).toBe("Courier misses slots");
    const resolved = await setIssueStatus(orgId, issue.id, "RESOLVED");
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    expect((await setIssueStatus(orgId, issue.id, "RESOLVED")).resolvedAt).toEqual(resolved.resolvedAt);
    expect((await setIssueStatus(orgId, issue.id, "OPEN")).resolvedAt).toBeNull();
    await expect(setIssueStatus(other.orgId, issue.id, "RESOLVED")).rejects.toThrow("Issue not found");
  });
});
