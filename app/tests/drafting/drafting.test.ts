import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { requestDraft, draftingConfigured } = vi.hoisted(() => ({ requestDraft: vi.fn(), draftingConfigured: vi.fn(() => true) }));
vi.mock("@/lib/drafting/claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/drafting/claude")>()),
  requestDraft,
  draftingConfigured,
}));

import { draftInboxReplyAction } from "@/app/(dashboard)/inbox/actions";
import { updateAiDraftingAction } from "@/app/(dashboard)/settings/templates/actions";
import { aiDraftQuota } from "@/lib/billing/plans";
import { resetMonthlyUsageForAnnualPlans } from "@/lib/billing/usage-reset";
import { PROMPT_VERSION } from "@/lib/drafting/draft";
import { asUser, createClient, createOrg, createUser, deleteOrgs, isRedirect, prisma } from "../helpers";

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms);
type U = Awaited<ReturnType<typeof createUser>>;

let orgId: string;
let admin: U, rmA: U, rmB: U;
let openClient: string, closedClient: string, otherClient: string;
let waTemplate: string, smsTemplate: string, draftTemplate: string;

const reply = (output: unknown) =>
  requestDraft.mockResolvedValueOnce({ output, model: "claude-opus-5-5", inputTokens: 1200, outputTokens: 80, costUsd: 0.0064 });
const used = async () =>
  (await prisma.productSubscription.findFirstOrThrow({ where: { organizationId: orgId, product: "CRM" } })).aiDraftsUsedThisPeriod;
const setUsage = (data: { aiDraftsUsedThisPeriod?: number; status?: "ACTIVE" | "TRIALING"; planId?: string | null; seats?: number | null; trialEndsAt?: Date | null }) =>
  prisma.productSubscription.updateMany({ where: { organizationId: orgId, product: "CRM" }, data });
/** The prompt sent to the model on the n-th call. */
const promptOf = (n = 0) => (requestDraft.mock.calls[n][0] as { prompt: string }).prompt;

beforeAll(async () => {
  const { org, stage } = await createOrg({ products: [{ product: "CRM", planId: "growth", seats: 10 }] });
  orgId = org.id;
  admin = await createUser(orgId, { role: "ADMIN", orgRole: "OWNER" });
  rmA = await createUser(orgId, { role: "RM", orgRole: "MEMBER" });
  rmB = await createUser(orgId, { role: "RM", orgRole: "MEMBER" });

  const client = async (name: string, rm: string) => {
    const c = await createClient(orgId, stage.id, name);
    await prisma.client.update({ where: { id: c.id }, data: { assignedToId: rm, email: `${name.split(" ")[0].toLowerCase()}@private.example` } });
    return c.id;
  };
  openClient = await client("Priya Sharma", rmA.id);
  closedClient = await client("Rahul Mehta", rmA.id);
  otherClient = await client("Someone Else", rmB.id);

  const msg = (clientId: string, direction: "INBOUND" | "OUTBOUND", body: string, createdAt: Date) =>
    prisma.message.create({ data: { organizationId: orgId, clientId, channel: "whatsapp", provider: "whatsapp_meta", direction, body, status: "DELIVERED", createdAt } });
  await msg(openClient, "OUTBOUND", "Welcome aboard!", ago(5 * HOUR));
  await msg(openClient, "INBOUND", "क्या मुझे PAN कार्ड अपलोड करना होगा?", ago(1 * HOUR));
  await msg(closedClient, "INBOUND", "Any update?", ago(40 * HOUR));
  await msg(otherClient, "INBOUND", "SECRET-OTHER-CLIENT", ago(1 * HOUR));

  const tpl = (name: string, channel: string, approved: boolean) =>
    prisma.messageTemplate.create({ data: { organizationId: orgId, channel, provider: "meta", name, body: "Hi {{name}}, {{update}}", approved, variables: ["name", "update"] } });
  waTemplate = (await tpl("Follow-up", "whatsapp", true)).id;
  smsTemplate = (await tpl("SMS ping", "sms", true)).id;
  draftTemplate = (await tpl("Unapproved", "whatsapp", false)).id;
});
afterAll(async () => {
  await prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: "aiDraftByUser:" } } });
  await deleteOrgs(orgId);
});
beforeEach(async () => {
  requestDraft.mockReset();
  draftingConfigured.mockReturnValue(true);
  await setUsage({ aiDraftsUsedThisPeriod: 0, status: "ACTIVE", planId: "growth", seats: 10, trialEndsAt: null });
  await prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: "aiDraftByUser:" } } });
});

describe("drafting a reply", () => {
  it("inside the window: a free-text draft from this client's conversation, logged and metered, never sent", async () => {
    asUser(rmA);
    reply({ reply: "  जी हाँ, कृपया PAN कार्ड अपलोड करें।  " });
    const messagesBefore = await prisma.message.count({ where: { clientId: openClient } });

    expect(await draftInboxReplyAction(openClient)).toEqual({ mode: "text", text: "जी हाँ, कृपया PAN कार्ड अपलोड करें।" });

    const prompt = promptOf();
    expect(prompt).toContain("Client: क्या मुझे PAN कार्ड अपलोड करना होगा?");
    expect(prompt).toContain("Business: Welcome aboard!");
    expect(prompt).toContain(`RM: ${rmA.name}`);
    expect(prompt).not.toContain("SECRET-OTHER-CLIENT"); // only this client's messages
    expect(prompt).not.toContain("9999999999"); // no contact details
    expect(prompt).not.toContain("@private.example");
    expect(prompt).not.toContain("<templates>");

    expect(await prisma.message.count({ where: { clientId: openClient } })).toBe(messagesBefore);
    expect(await used()).toBe(1);
    expect(await prisma.aiDraft.findFirstOrThrow({ where: { clientId: openClient } })).toMatchObject({
      organizationId: orgId,
      userId: rmA.id,
      mode: "text",
      channel: "whatsapp",
      model: "claude-opus-5-5",
      promptVersion: PROMPT_VERSION,
      inputTokens: 1200,
      outputTokens: 80,
      costUsd: 0.0064,
    });
  });

  it("outside the window: only an offered approved template, with exactly its variables", async () => {
    asUser(rmA);
    reply({ templateId: waTemplate, variables: [{ name: "name", value: "Rahul" }, { name: "injected", value: "x" }] });
    expect(await draftInboxReplyAction(closedClient)).toEqual({
      mode: "template",
      templateId: waTemplate,
      variables: { name: "Rahul", update: "" },
    });
    const prompt = promptOf();
    expect(prompt).toContain(`id: ${waTemplate}`);
    expect(prompt).not.toContain(smsTemplate); // other channel
    expect(prompt).not.toContain(draftTemplate); // not approved

    // A template id the model made up (or one we didn't offer) never reaches the composer.
    reply({ templateId: draftTemplate, variables: [] });
    expect(await draftInboxReplyAction(closedClient)).toEqual({ mode: "template", templateId: null, variables: {} });
  });

  it("can't draft for a client the user can't see: no model call, no quota used", async () => {
    asUser(rmA);
    expect(await draftInboxReplyAction(otherClient)).toEqual({ __actionError: "Client not found" });
    expect(requestDraft).not.toHaveBeenCalled();
    expect(await used()).toBe(0);
  });

  it("respects the org switch and missing setup", async () => {
    asUser(rmA);
    await prisma.organization.update({ where: { id: orgId }, data: { aiDraftingEnabled: false } });
    expect(await draftInboxReplyAction(openClient)).toEqual({ __actionError: expect.stringMatching(/turned off/) });
    await prisma.organization.update({ where: { id: orgId }, data: { aiDraftingEnabled: true } });

    draftingConfigured.mockReturnValue(false);
    expect(await draftInboxReplyAction(openClient)).toEqual({ __actionError: expect.stringMatching(/isn't set up/) });
    expect(requestDraft).not.toHaveBeenCalled();
  });

  it("stops at the plan's allowance (per seat) and the trial allowance", async () => {
    expect(aiDraftQuota({ status: "ACTIVE", planId: "growth", seats: 10 })).toBe(2000);
    expect(aiDraftQuota({ status: "ACTIVE", planId: "enterprise", seats: null })).toBeNull();
    expect(aiDraftQuota({ status: "TRIALING", planId: null, seats: 3 })).toBe(50);

    asUser(rmA);
    await setUsage({ aiDraftsUsedThisPeriod: 2000 });
    expect(await draftInboxReplyAction(openClient)).toEqual({ __actionError: expect.stringMatching(/used all 2,?000 AI drafts/) });
    await setUsage({ status: "TRIALING", trialEndsAt: new Date(Date.now() + 7 * 24 * HOUR), aiDraftsUsedThisPeriod: 50 });
    expect(await draftInboxReplyAction(openClient)).toEqual({ __actionError: expect.stringMatching(/trial includes 50 AI drafts/) });
    expect(requestDraft).not.toHaveBeenCalled();
  });

  it("a failed model call gives the draft back and logs nothing", async () => {
    asUser(rmA);
    const before = await prisma.aiDraft.count({ where: { organizationId: orgId } });
    requestDraft.mockRejectedValueOnce(new Error("overloaded"));
    expect(await draftInboxReplyAction(openClient)).toEqual({ __actionError: expect.stringMatching(/Couldn't draft a reply/) });
    expect(await used()).toBe(0);
    expect(await prisma.aiDraft.count({ where: { organizationId: orgId } })).toBe(before);
  });

  it("is rate-limited per user", async () => {
    asUser(rmA);
    for (let i = 0; i < 20; i++) reply({ reply: `draft ${i}` });
    for (let i = 0; i < 20; i++) expect(await draftInboxReplyAction(openClient)).toMatchObject({ mode: "text" });
    expect(await draftInboxReplyAction(openClient)).toEqual({ __actionError: expect.stringMatching(/Too many drafts/) });
    expect(requestDraft).toHaveBeenCalledTimes(20);
  });

  it("monthly usage resets for annual plans clear the draft count too", async () => {
    await prisma.productSubscription.updateMany({
      where: { organizationId: orgId, product: "CRM" },
      data: { billingInterval: "year", usagePeriodStart: ago(40 * 24 * HOUR), aiDraftsUsedThisPeriod: 17 },
    });
    await resetMonthlyUsageForAnnualPlans();
    expect(await used()).toBe(0);
    await prisma.productSubscription.updateMany({ where: { organizationId: orgId, product: "CRM" }, data: { billingInterval: null } });
  });
});

describe("AI drafting settings", () => {
  it("admins set tone and things to avoid, which reach the prompt; the change is audit-logged", async () => {
    asUser(admin);
    expect(await updateAiDraftingAction({ enabled: true, tone: "Warm, first names", avoid: "Guaranteed returns" })).toBeUndefined();
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "settings.ai_drafting_updated" } });
    expect(audit.newValue).toMatchObject({ aiDraftTone: "Warm, first names", aiDraftAvoid: "Guaranteed returns" });

    asUser(rmA);
    reply({ reply: "Hi Priya" });
    await draftInboxReplyAction(openClient);
    expect(promptOf()).toContain("Tone: Warm, first names");
    expect(promptOf()).toContain("Avoid:\nGuaranteed returns");
  });

  it("RMs can't change them", async () => {
    asUser(rmA);
    await expect(updateAiDraftingAction({ enabled: false, tone: "", avoid: "" })).rejects.toSatisfy((e) => isRedirect(e));
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).aiDraftingEnabled).toBe(true);
  });
});
