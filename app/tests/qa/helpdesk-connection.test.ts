import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { connectHelpdeskAction, disconnectHelpdeskAction } from "@/app/qa/settings/actions";
import { decryptJson } from "@/lib/security/crypto";
import { asUser, createOrg, createUser, deleteOrgs, isRedirect, prisma } from "../helpers";

let org: string;
let owner: Awaited<ReturnType<typeof createUser>>, member: Awaited<ReturnType<typeof createUser>>;

function stubFetch(status: number) {
  vi.stubGlobal("fetch", async () => new Response(status === 200 ? "{}" : null, { status, headers: { "content-type": "application/json" } }));
}

beforeAll(async () => {
  org = (await createOrg({ products: [{ product: "QA_SENTINEL", planId: "starter", reviewQuota: 100 }] })).org.id;
  owner = await createUser(org);
  member = await createUser(org, { role: "RM", orgRole: "MEMBER" });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => deleteOrgs(org));

describe("connecting a helpdesk", () => {
  it("is for owners and admins only", async () => {
    asUser(member);
    const error = await connectHelpdeskAction("freshdesk", { domain: "acme", apiKey: "k" }).then(() => null, (e: unknown) => e);
    expect(isRedirect(error)).toBe(true);
  });

  it("tests credentials before saving, and never saves failing ones", async () => {
    asUser(owner);
    stubFetch(401);
    expect(await connectHelpdeskAction("freshdesk", { domain: "acme", apiKey: "bad" })).toEqual({ __actionError: expect.stringMatching(/Freshdesk rejected/) });
    expect(await prisma.helpdeskConnection.count({ where: { organizationId: org } })).toBe(0);

    stubFetch(200);
    expect(await connectHelpdeskAction("freshdesk", { domain: "https://Acme.freshdesk.com", apiKey: "good" })).toEqual({ accountLabel: "acme.freshdesk.com" });
    const saved = await prisma.helpdeskConnection.findUniqueOrThrow({ where: { organizationId: org } });
    expect([saved.provider, saved.isValid]).toEqual(["freshdesk", true]);
    expect(saved.encryptedCredentials).not.toContain("good");
    expect(decryptJson(saved.encryptedCredentials)).toEqual({ domain: "acme", apiKey: "good" });
  });

  it("switching helpdesks skips jobs queued for the old one", async () => {
    asUser(owner);
    await prisma.autoReviewConfig.create({ data: { organizationId: org, enabled: true, lastPolledAt: new Date(), includeTags: [], excludeTags: [] } });
    await prisma.autoReviewJob.create({ data: { organizationId: org, helpdesk: "freshdesk", ticketId: "1", reason: "sample" } });
    stubFetch(200);
    await connectHelpdeskAction("intercom", { accessToken: "tok", region: "us" });
    expect((await prisma.autoReviewJob.findFirstOrThrow({ where: { organizationId: org } })).status).toBe("SKIPPED");
    expect((await prisma.autoReviewConfig.findUniqueOrThrow({ where: { organizationId: org } })).lastPolledAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { organizationId: org, action: "helpdesk.connected" } })).toBe(2);
  });

  it("rejects unknown providers and can disconnect", async () => {
    asUser(owner);
    expect(await connectHelpdeskAction("myspace", {})).toEqual({ __actionError: "Pick a helpdesk to connect" });
    await disconnectHelpdeskAction();
    expect(await prisma.helpdeskConnection.count({ where: { organizationId: org } })).toBe(0);
  });
});
