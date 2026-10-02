import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { setUserActiveAction, setUserRoleAction, resetUserPasswordAction, signOutUserAction } from "@/app/(dashboard)/settings/users/actions";
import { deleteWebhookAction, revokeApiKeyAction } from "@/app/(dashboard)/settings/developers/actions";
import { saveAuditorCommentAction } from "@/app/qa/reviews/actions";
import { GET as exportAuditLog } from "@/app/org/audit-log/export/route";
import { asUser, createOrg, createUser, deleteOrgs, prisma } from "../helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let orgA: string, orgB: string, adminA: U, userB: U, webhookB: string, keyB: string, reviewB: string;

beforeAll(async () => {
  const products = [
    { product: "CRM" as const, planId: "scale", seats: 50 },
    { product: "QA_SENTINEL" as const, planId: "scale", reviewQuota: 2000 },
  ];
  orgA = (await createOrg({ products })).org.id;
  orgB = (await createOrg({ products })).org.id;
  adminA = await createUser(orgA);
  const ownerB = await createUser(orgB);
  userB = await createUser(orgB, { role: "RM", orgRole: "MEMBER" });
  webhookB = (await prisma.webhookEndpoint.create({ data: { organizationId: orgB, url: "https://b.example/hook", encryptedSecret: "x", events: ["client.created"] } })).id;
  keyB = (await prisma.apiKey.create({ data: { organizationId: orgB, name: "b", keyPrefix: "sk_live_b", hashedKey: "hash_b_isolation", createdById: ownerB.id } })).id;
  reviewB = (await prisma.ticketReview.create({ data: { organizationId: orgB, ticketId: "B-9" } })).id;
  await prisma.auditLog.create({ data: { organizationId: orgB, entity: "Client", entityId: "secret-b", action: "created" } });
  await prisma.auditLog.create({ data: { organizationId: orgA, entity: "Client", entityId: "visible-a", action: "created" } });
});
beforeEach(() => asUser(adminA));
afterAll(() => deleteOrgs(orgA, orgB));

describe("server actions can't reach another organization", () => {
  it("can't change another org's user role, status, password or sessions", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userB.id } });
    await expect(setUserRoleAction(userB.id, "ADMIN")).rejects.toThrow();
    await expect(setUserActiveAction(userB.id, false)).rejects.toThrow();
    await expect(resetUserPasswordAction(userB.id, "attacker-password")).rejects.toThrow();
    await expect(signOutUserAction(userB.id)).rejects.toThrow();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: userB.id } });
    expect([after.role, after.isActive, after.passwordHash, after.sessionsRevokedAt]).toEqual([before.role, before.isActive, before.passwordHash, null]);
  });

  it("can't revoke another org's API key or delete its webhook", async () => {
    await expect(revokeApiKeyAction(keyB)).rejects.toThrow();
    await expect(deleteWebhookAction(webhookB)).rejects.toThrow();
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: keyB } })).revokedAt).toBeNull();
    expect(await prisma.webhookEndpoint.count({ where: { id: webhookB } })).toBe(1);
  });

  it("can't comment on another org's QA review", async () => {
    await expect(saveAuditorCommentAction(reviewB, "overwritten")).rejects.toThrow();
    expect((await prisma.ticketReview.findUniqueOrThrow({ where: { id: reviewB } })).auditorComment).toBeNull();
  });

  it("exports only its own audit log", async () => {
    const res = await exportAuditLog(new Request("http://test/org/audit-log/export"));
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("visible-a");
    expect(csv).not.toContain("secret-b");
  });
});
