import Stripe from "stripe";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const realStripe = new Stripe("sk_test_dummy");
vi.mock("@/lib/billing/stripe", () => ({ getStripe: () => ({ webhooks: realStripe.webhooks, subscriptions: { retrieve: vi.fn() } }) }));

import { POST as stripeWebhook } from "@/app/api/webhooks/stripe/route";
import { adjustSubscriptionAction } from "@/app/admin/organizations/[id]/actions";
import { startTrialAction } from "@/app/billing/[product]/actions";
import {
  addTeamMappingAction,
  createTeamAction,
  deleteTeamAction,
  removeTeamMappingAction,
  saveCostSettingsAction,
} from "@/app/cx/settings/actions";
import { auth } from "@/lib/auth/config";
import { getProductAccess } from "@/lib/billing/access";
import { aiDraftQuota, launchedProducts, limitsForPlan, PRODUCT_HOME, PRODUCT_LIMIT, trialLimitsFor } from "@/lib/billing/plans";
import { resetMonthlyUsageForAnnualPlans } from "@/lib/billing/usage-reset";
import { cxRealtimeAvailable } from "@/lib/cx/plan-features";
import { getCostSettings, matchTeam, type CostSettingsInput } from "@/lib/cx/settings";
import { asUser, createOrg, createUser, deleteOrgs, isRedirect, prisma } from "../helpers";

const orgs: string[] = [];
afterAll(() => deleteOrgs(...orgs));
afterEach(() => vi.unstubAllEnvs());

const cxOrg = async (opts: { status?: "ACTIVE" | "TRIALING"; planId?: string | null } = {}) => {
  const { org } = await createOrg({
    products: [{ product: "CX_INTELLIGENCE", status: opts.status ?? "ACTIVE", planId: opts.planId ?? "growth", trialEndsAt: new Date(Date.now() + 86_400_000) }],
  });
  orgs.push(org.id);
  return org.id;
};

describe("CX Intelligence plans", () => {
  it("each product carries its own limit, and adding CX didn't change CRM or QA", () => {
    expect(trialLimitsFor("CX_INTELLIGENCE")).toEqual({ analysisQuota: 1_000 });
    expect(limitsForPlan("CX_INTELLIGENCE", "growth")).toEqual({ analysisQuota: 25_000 });
    expect(limitsForPlan("CX_INTELLIGENCE", "enterprise")).toEqual({});
    // Regression: the old "CRM, else QA" logic would have given CX a review quota.
    expect(trialLimitsFor("CRM")).toEqual({ seats: 3 });
    expect(trialLimitsFor("QA_SENTINEL")).toEqual({ reviewQuota: 50 });
    expect(limitsForPlan("QA_SENTINEL", "growth")).toEqual({ reviewQuota: 500 });
    expect(limitsForPlan("CRM", "scale")).toEqual({ seats: 50 });
    expect(aiDraftQuota({ status: "ACTIVE", planId: "growth", seats: 10 })).toBe(2000);
    expect(PRODUCT_LIMIT.CX_INTELLIGENCE.key).toBe("analysisQuota");
    expect(PRODUCT_HOME.CX_INTELLIGENCE).toBe("/cx");
  });

  it("stays hidden until the launch flag is on", () => {
    vi.stubEnv("NEXT_PUBLIC_CX_INTELLIGENCE_ENABLED", "");
    expect(launchedProducts()).toEqual(["QA_SENTINEL", "CRM"]);
    vi.stubEnv("NEXT_PUBLIC_CX_INTELLIGENCE_ENABLED", "true");
    expect(launchedProducts()).toEqual(["QA_SENTINEL", "CRM", "CX_INTELLIGENCE"]);
  });

  it("real-time analysis only on Scale and Enterprise, never on trials", async () => {
    expect(await cxRealtimeAvailable(await cxOrg({ planId: "growth" }))).toBe(false);
    expect(await cxRealtimeAvailable(await cxOrg({ planId: "scale" }))).toBe(true);
    expect(await cxRealtimeAvailable(await cxOrg({ status: "TRIALING", planId: "scale" }))).toBe(false);
  });
});

describe("CX trials and billing", () => {
  it("a trial can only be started once the product is launched, then lands on /cx with the trial quota", async () => {
    const { org } = await createOrg();
    orgs.push(org.id);
    asUser(await createUser(org.id, { role: "ADMIN", orgRole: "OWNER" }));

    vi.stubEnv("NEXT_PUBLIC_CX_INTELLIGENCE_ENABLED", "");
    expect(await startTrialAction("CX_INTELLIGENCE")).toEqual({ __actionError: expect.stringMatching(/Unknown product/) });
    expect(await prisma.productSubscription.count({ where: { organizationId: org.id } })).toBe(0);

    vi.stubEnv("NEXT_PUBLIC_CX_INTELLIGENCE_ENABLED", "true");
    await expect(startTrialAction("CX_INTELLIGENCE")).rejects.toSatisfy((e) => isRedirect(e, "/cx"));
    const sub = await prisma.productSubscription.findUniqueOrThrow({ where: { organizationId_product: { organizationId: org.id, product: "CX_INTELLIGENCE" } } });
    expect(sub).toMatchObject({ status: "TRIALING", analysisQuota: 1_000, reviewQuota: null, seats: null });
    expect((await getProductAccess(org.id, "CX_INTELLIGENCE")).allowed).toBe(true);
    expect((await getProductAccess(org.id, "QA_SENTINEL")).allowed).toBe(false);
  });

  it("Stripe sets the plan's analysis quota and resets analysis usage on a new period; annual plans reset monthly", async () => {
    const orgId = await cxOrg({ status: "TRIALING", planId: null });
    const row = () => prisma.productSubscription.findUniqueOrThrow({ where: { organizationId_product: { organizationId: orgId, product: "CX_INTELLIGENCE" } } });
    await prisma.productSubscription.updateMany({ where: { organizationId: orgId }, data: { analysesUsedThisPeriod: 700 } });

    const sub = (periodEnd: number) => ({
      id: `sub_${orgId}`,
      object: "subscription",
      status: "active",
      metadata: { organizationId: orgId, product: "CX_INTELLIGENCE", planId: "scale" },
      items: { data: [{ id: "si", quantity: 1, price: { id: "price", recurring: { interval: "month", usage_type: "licensed" } }, current_period_end: periodEnd }] },
    });
    const send = async (object: unknown) => {
      const payload = JSON.stringify({ id: `evt_${Math.random()}`, object: "event", type: "customer.subscription.updated", data: { object } });
      const header = realStripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
      return stripeWebhook(new Request("http://test", { method: "POST", headers: { "stripe-signature": header }, body: payload }));
    };
    expect((await send(sub(1_790_000_000))).status).toBe(200);
    expect(await row()).toMatchObject({ status: "ACTIVE", planId: "scale", analysisQuota: 100_000, analysesUsedThisPeriod: 0, reviewQuota: null });

    await prisma.productSubscription.updateMany({
      where: { organizationId: orgId },
      data: { billingInterval: "year", usagePeriodStart: new Date(Date.now() - 40 * 86_400_000), analysesUsedThisPeriod: 900, overageAnalysesThisPeriod: 4 },
    });
    await resetMonthlyUsageForAnnualPlans();
    expect(await row()).toMatchObject({ analysesUsedThisPeriod: 0, overageAnalysesThisPeriod: 0 });
  });

  it("Supportify staff set a CX org's analysis quota in the admin editor", async () => {
    const orgId = await cxOrg();
    const staff = await createUser(orgId, { role: "ADMIN", orgRole: "OWNER" });
    vi.mocked(auth).mockResolvedValue({ user: { ...staff, isPlatformAdmin: true, authMethod: "password" }, expires: new Date(Date.now() + 3_600_000).toISOString() } as never);
    const save = (fields: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ organizationId: orgId, product: "CX_INTELLIGENCE", status: "ACTIVE", ...fields })) f.append(k, v);
      return adjustSubscriptionAction(f);
    };
    await save({ planId: "starter", analysisQuota: "" });
    const stored = () => prisma.productSubscription.findUniqueOrThrow({ where: { organizationId_product: { organizationId: orgId, product: "CX_INTELLIGENCE" } } });
    expect(await stored()).toMatchObject({ analysisQuota: 5_000, reviewQuota: null, seats: null });
    await save({ planId: "starter", analysisQuota: "12000" });
    expect((await stored()).analysisQuota).toBe(12_000);
  });
});

describe("CX settings", () => {
  let orgId: string, otherOrgId: string;
  let admin: Awaited<ReturnType<typeof createUser>>, member: Awaited<ReturnType<typeof createUser>>, otherAdmin: Awaited<ReturnType<typeof createUser>>;
  const costs: CostSettingsInput = {
    currency: "inr",
    costPerContact: { default: 120, email: 90, chat: 60, voice: 200, social: null },
    agentHourlyCost: 450,
    averageOrderValue: 1800,
    customerLifetimeVal: 24000,
    churnPropensity: 0.2,
    deflectionRate: 0.35,
    retentionMonths: 13,
  };

  beforeAll(async () => {
    orgId = await cxOrg();
    otherOrgId = await cxOrg();
    admin = await createUser(orgId, { role: "ADMIN", orgRole: "ADMIN" });
    member = await createUser(orgId, { role: "RM", orgRole: "MEMBER" });
    otherAdmin = await createUser(otherOrgId, { role: "ADMIN", orgRole: "OWNER" });
  });

  it("admins save cost inputs (validated and audit-logged); blank defaults before then", async () => {
    expect(await getCostSettings(orgId)).toMatchObject({ currency: "USD", retentionMonths: 13, agentHourlyCost: null });
    asUser(admin);
    expect(await saveCostSettingsAction({ ...costs, currency: "rupees" })).toEqual({ __actionError: expect.stringMatching(/3-letter currency/) });
    expect(await saveCostSettingsAction({ ...costs, churnPropensity: 1.5 })).toMatchObject({ __actionError: expect.any(String) });
    expect(await saveCostSettingsAction({ ...costs, retentionMonths: 60 })).toMatchObject({ __actionError: expect.any(String) });
    expect(await saveCostSettingsAction(costs)).toBeUndefined();
    expect(await getCostSettings(orgId)).toEqual({ ...costs, currency: "INR" });
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "cx.cost_settings_updated" } })).toBe(1);
  });

  it("members can't change settings", async () => {
    asUser(member);
    await expect(saveCostSettingsAction(costs)).rejects.toSatisfy((e) => isRedirect(e));
    await expect(createTeamAction({ name: "X", kind: "SUPPORT" })).rejects.toSatisfy((e) => isRedirect(e));
  });

  it("teams, BPO benchmarks and agent mappings stay inside the org", async () => {
    asUser(admin);
    expect(await createTeamAction({ name: "Care India", kind: "SUPPORT" })).toBeUndefined();
    const inHouse = await prisma.team.findFirstOrThrow({ where: { organizationId: orgId, name: "Care India" } });
    expect(await createTeamAction({ name: "Care India", kind: "SUPPORT" })).toEqual({ __actionError: expect.stringMatching(/already exists/) });

    asUser(otherAdmin);
    expect(await createTeamAction({ name: "Ops", kind: "SUPPORT" })).toBeUndefined();
    const otherTeam = await prisma.team.findFirstOrThrow({ where: { organizationId: otherOrgId } });
    // Org B can't benchmark against, map agents to, or delete org A's team.
    expect(await createTeamAction({ name: "Vendor", kind: "BPO", benchmarkTeamId: inHouse.id })).toEqual({ __actionError: "Team not found" });
    expect(await addTeamMappingAction({ teamId: inHouse.id, matchType: "domain", value: "x.com" })).toEqual({ __actionError: "Team not found" });
    expect(await deleteTeamAction(inHouse.id)).toEqual({ __actionError: "Team not found" });

    asUser(admin);
    expect(await createTeamAction({ name: "Acme BPO", kind: "BPO", benchmarkTeamId: otherTeam.id })).toEqual({ __actionError: "Team not found" });
    expect(await createTeamAction({ name: "Logistics", kind: "OWNER" })).toBeUndefined();
    const owner = await prisma.team.findFirstOrThrow({ where: { organizationId: orgId, name: "Logistics" } });
    expect(await createTeamAction({ name: "Acme BPO", kind: "BPO", benchmarkTeamId: owner.id })).toEqual({
      __actionError: expect.stringMatching(/in-house support team/),
    });
    expect(await createTeamAction({ name: "Acme BPO", kind: "BPO", benchmarkTeamId: inHouse.id })).toBeUndefined();
    const bpo = await prisma.team.findFirstOrThrow({ where: { organizationId: orgId, name: "Acme BPO" } });
    expect(bpo.benchmarkTeamId).toBe(inHouse.id);

    expect(await addTeamMappingAction({ teamId: bpo.id, matchType: "domain", value: "@AcmeBPO.com " })).toBeUndefined();
    expect(await addTeamMappingAction({ teamId: inHouse.id, matchType: "domain", value: "acmebpo.com" })).toEqual({ __actionError: "Already mapped to Acme BPO" });
    expect(await addTeamMappingAction({ teamId: inHouse.id, matchType: "email", value: "not-an-email" })).toEqual({ __actionError: expect.stringMatching(/full agent email/) });
    expect(await addTeamMappingAction({ teamId: inHouse.id, matchType: "email", value: "Lead@AcmeBPO.com" })).toBeUndefined();

    const mappings = await prisma.agentTeamMapping.findMany({ where: { organizationId: orgId } });
    expect(mappings.map((m) => m.value).sort()).toEqual(["acmebpo.com", "lead@acmebpo.com"]);
    // An exact email beats a domain rule; a helpdesk group is the last resort.
    expect(matchTeam(mappings, { email: "lead@acmebpo.com" })).toBe(inHouse.id);
    expect(matchTeam(mappings, { email: "Asha@AcmeBPO.com" })).toBe(bpo.id);
    expect(matchTeam(mappings, { email: "someone@else.com", group: "tier 2" })).toBeNull();

    asUser(otherAdmin);
    expect(await removeTeamMappingAction(mappings[0].id)).toEqual({ __actionError: "Mapping not found" });
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: { startsWith: "cx.team" } } })).toBe(5);
  });

  it("deleting an organization removes all its CX data", async () => {
    const id = await cxOrg();
    const team = await prisma.team.create({ data: { organizationId: id, name: "T", kind: "SUPPORT" } });
    const topic = await prisma.topic.create({ data: { organizationId: id, key: "late_delivery", name: "Late delivery" } });
    const conversation = await prisma.conversation.create({
      data: { organizationId: id, sourceType: "HELPDESK", provider: "zendesk", externalId: "1", startedAt: new Date(), turns: [], textHash: "h", redactionVersion: 1, teamId: team.id },
    });
    await prisma.conversationTopic.create({ data: { conversationId: conversation.id, topicId: topic.id, organizationId: id, startedAt: conversation.startedAt } });
    await prisma.conversationAnalysis.create({ data: { conversationId: conversation.id, model: "m", promptVersion: "v", costUsd: 0 } });
    await prisma.cxCostSettings.create({ data: { organizationId: id } });

    await deleteOrgs(id);
    expect(await prisma.conversation.count({ where: { organizationId: id } })).toBe(0);
    expect(await prisma.conversationAnalysis.count({ where: { conversationId: conversation.id } })).toBe(0);
    expect(await prisma.topic.count({ where: { organizationId: id } })).toBe(0);
    expect(await prisma.team.count({ where: { organizationId: id } })).toBe(0);
    expect(await prisma.cxCostSettings.count({ where: { organizationId: id } })).toBe(0);
  });
});
