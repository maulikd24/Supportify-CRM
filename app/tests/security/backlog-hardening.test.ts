import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as clients from "@/app/(dashboard)/clients/actions";
import { createTaskAction } from "@/app/(dashboard)/tasks/actions";
import { createJourneyAction } from "@/app/(dashboard)/journeys/actions";
import { updateStageAction } from "@/app/(dashboard)/settings/stages/actions";
import { adjustSubscriptionAction } from "@/app/admin/organizations/[id]/actions";
import * as clientsApi from "@/app/api/v1/clients/route";
import { auth } from "@/lib/auth/config";
import { generateApiKey } from "@/lib/security/api-keys";
import { limitsForPlan, trialLimitsFor } from "@/lib/billing/plans";
import type { SubscriptionStatus } from "@/generated/prisma/client";
import { asUser, createClient, createOrg, createUser, deleteOrgs, isRedirect, prisma } from "../helpers";

const orgIds: string[] = [];
afterAll(() => deleteOrgs(...orgIds));

async function org(products: NonNullable<Parameters<typeof createOrg>[0]>["products"]) {
  const { org, stage } = await createOrg({ products });
  orgIds.push(org.id);
  return { orgId: org.id, stageId: stage.id, admin: await createUser(org.id, { role: "ADMIN", orgRole: "OWNER" }) };
}

describe("CRM actions require an active CRM subscription", () => {
  it.each([
    ["a canceled CRM plan", [{ product: "CRM" as const, status: "CANCELED" as SubscriptionStatus, planId: "scale", seats: 50 }]],
    ["a QA-only org", [{ product: "QA_SENTINEL" as const, planId: "scale", reviewQuota: 2000 }]],
  ])("%s is sent to billing instead of reaching CRM data", async (_, products) => {
    const { orgId, stageId, admin } = await org(products);
    const client = await createClient(orgId, stageId);
    asUser(admin);

    const form = (fields: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.append(k, v);
      return f;
    };
    for (const attempt of [
      () => clients.createClientAction(form({ name: "n", mobile: "1", email: "", clientType: "", leadSource: "", referralSource: "", notes: "", assignedToId: "" })),
      () => clients.addClientNoteAction(client.id, "note"),
      () => createTaskAction(form({ clientId: client.id, title: "t", dueAt: "2030-01-01", assignedToId: admin.id })),
      () => createJourneyAction("j"),
      () => updateStageAction(stageId, { name: "x", slaHours: 1, isActive: true, isTerminal: false }),
    ]) {
      const error = await attempt().then(() => null, (e: unknown) => e);
      expect(isRedirect(error, "/billing/CRM")).toBe(true);
    }
    expect(await prisma.activity.count({ where: { clientId: client.id } })).toBe(0);
    expect(await prisma.client.count({ where: { organizationId: orgId } })).toBe(1);
  });
});

describe("API keys stop working while their creator is deactivated", () => {
  it("rejects, then accepts again on reactivation", async () => {
    const { orgId, admin } = await org([{ product: "CRM", planId: "scale", seats: 50 }]);
    const key = generateApiKey();
    await prisma.apiKey.create({ data: { organizationId: orgId, name: "k", keyPrefix: key.keyPrefix, hashedKey: key.hashedKey, createdById: admin.id } });
    const list = () => clientsApi.GET(new Request("https://app.test/api/v1/clients", { headers: { authorization: `Bearer ${key.raw}` } }));

    expect((await list()).status).toBe(200);
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });
    expect((await list()).status).toBe(401);
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: true } });
    expect((await list()).status).toBe(200);
  });
});

describe("platform-admin subscription editor: a blank limit is never accidentally unlimited", () => {
  let orgId: string;

  beforeAll(async () => {
    ({ orgId } = await org([]));
    const staff = await createUser(orgId, { role: "ADMIN", orgRole: "OWNER" });
    // asUser() always sets isPlatformAdmin: false; this editor needs Supportify staff.
    vi.mocked(auth).mockResolvedValue({ user: { ...staff, isPlatformAdmin: true, authMethod: "password" }, expires: new Date(Date.now() + 3_600_000).toISOString() } as never);
  });

  const save = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ organizationId: orgId, ...fields })) f.append(k, v);
    return adjustSubscriptionAction(f);
  };
  const stored = (product: "CRM" | "QA_SENTINEL") =>
    prisma.productSubscription.findUniqueOrThrow({ where: { organizationId_product: { organizationId: orgId, product } } });

  it("blank = the plan's own limit", async () => {
    await save({ product: "CRM", planId: "scale", status: "ACTIVE", seats: "" });
    expect((await stored("CRM")).seats).toBe(limitsForPlan("CRM", "scale").seats);
    await save({ product: "QA_SENTINEL", planId: "starter", status: "ACTIVE", reviewQuota: "" });
    expect((await stored("QA_SENTINEL")).reviewQuota).toBe(limitsForPlan("QA_SENTINEL", "starter").reviewQuota);
  });

  it("blank on a trial without a plan = the trial limit", async () => {
    await save({ product: "CRM", planId: "", status: "TRIALING", seats: "" });
    expect((await stored("CRM")).seats).toBe(trialLimitsFor("CRM").seats);
  });

  it("blank on a contact-sales plan stays unlimited; 'unlimited' is explicit; numbers are kept", async () => {
    await save({ product: "CRM", planId: "enterprise", status: "ACTIVE", seats: "" });
    expect((await stored("CRM")).seats).toBeNull();
    await save({ product: "CRM", planId: "scale", status: "ACTIVE", seats: "unlimited" });
    expect((await stored("CRM")).seats).toBeNull();
    await save({ product: "CRM", planId: "scale", status: "ACTIVE", seats: "7" });
    expect((await stored("CRM")).seats).toBe(7);
  });

  it("blank with no plan and no trial is refused rather than guessed", async () => {
    const before = await stored("CRM");
    expect(await save({ product: "CRM", planId: "", status: "ACTIVE", seats: "" })).toEqual({ __actionError: expect.stringMatching(/unlimited/) });
    expect((await stored("CRM")).seats).toBe(before.seats);
  });
});
